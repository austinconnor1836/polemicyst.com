import AVFoundation
import CoreImage
import SwiftUI
import UIKit
import Vision

/// Instagram-style positioning editor for a cutout overlay. Drag to move, pinch to resize.
/// The preview shows the reference clip's last frame as the static background (matching what
/// the freeze-reveal render will produce) with the creator's first-frame thumbnail drawn
/// over it at the cutout's normalized position + scale.
///
/// Modeled on `TextOverlayEditorView` — all gestures commit normalized values (0..1) into
/// `cutout`, so the render path doesn't care how they were chosen.
struct CutoutPositionEditorView: View {
    /// Reference clip — its last frame is the background the cutout sits on top of.
    let referenceClip: StitchClip
    let referenceCachedPreview: UIImage?
    let layout: StitchLayout
    @Binding var cutout: CutoutOverlay
    @Environment(\.dismiss) private var dismiss

    @State private var dragOffset: CGSize = .zero
    @State private var liveScale: CGFloat = 1.0
    @State private var referenceLastFrame: UIImage?
    @State private var creatorFirstFrame: UIImage?

    private let minScale: CGFloat = 0.2
    private let maxScale: CGFloat = 1.0

    var body: some View {
        NavigationStack {
            GeometryReader { outer in
                let canvasAspect = layout.renderSize.width / layout.renderSize.height
                let canvasHeight = min(outer.size.height - 60, outer.size.width / canvasAspect)
                let canvasWidth = canvasHeight * canvasAspect
                let canvasSize = CGSize(width: canvasWidth, height: canvasHeight)

                VStack {
                    Spacer()
                    ZStack {
                        // Background: reference last frame (or its thumbnail as a fallback).
                        referenceBackground
                            .frame(width: canvasWidth, height: canvasHeight)
                            .clipped()

                        // Cutout marker: creator thumbnail at the chosen position/scale.
                        cutoutMarker(canvasSize: canvasSize)
                    }
                    .frame(width: canvasWidth, height: canvasHeight)
                    .background(Color.black)
                    .cornerRadius(12)
                    Spacer()
                    Text("Drag to position · Pinch to resize")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                        .padding(.bottom, 8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.ignoresSafeArea())
            }
            .navigationTitle("Position Creator")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dragOffset = .zero
                        liveScale = 1.0
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .task { await loadFrames() }
        }
    }

    @ViewBuilder
    private var referenceBackground: some View {
        if let img = referenceLastFrame ?? referenceCachedPreview {
            Image(uiImage: img)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                Color.black
                ProgressView().tint(.white.opacity(0.6))
            }
        }
    }

    @ViewBuilder
    private func cutoutMarker(canvasSize: CGSize) -> some View {
        // Mirror the renderer: position.y has SwiftUI semantics (0 = top, 1 = bottom)
        // both in the editor preview and stored model — only the renderer flips for Core Animation.
        let centerX = cutout.position.x * canvasSize.width + dragOffset.width
        let centerY = cutout.position.y * canvasSize.height + dragOffset.height
        let displayedHeight = cutout.scale * canvasSize.height * liveScale
        // Keep the marker's aspect roughly portrait (~3:4) so the on-screen size matches
        // a person-shaped subject. The real segmented mask will replace this at render time.
        let displayedWidth = displayedHeight * 0.6

        Group {
            if let img = creatorFirstFrame {
                // Segmented (background-removed) preview — no clip mask or border because the
                // person has alpha around them; a rounded rect would slice into their shoulders.
                Image(uiImage: img)
                    .resizable()
                    .scaledToFit()
                    .frame(width: displayedWidth, height: displayedHeight)
            } else {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.white.opacity(0.15))
                    .frame(width: displayedWidth, height: displayedHeight)
                    .overlay(
                        VStack(spacing: 6) {
                            Image(systemName: "person.crop.rectangle")
                                .font(.title2)
                                .foregroundStyle(.white.opacity(0.85))
                            Text("Creator")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.85))
                        }
                    )
            }
        }
        .shadow(color: .black.opacity(0.3), radius: 6, x: 0, y: 2)
        .position(x: centerX, y: centerY)
        .gesture(combinedGesture(canvasSize: canvasSize))
    }

    private func combinedGesture(canvasSize: CGSize) -> some Gesture {
        let drag = DragGesture()
            .onChanged { value in dragOffset = value.translation }
            .onEnded { value in
                let newX = cutout.position.x + value.translation.width / canvasSize.width
                let newY = cutout.position.y + value.translation.height / canvasSize.height
                cutout.position = CGPoint(
                    x: clamp(newX, lower: 0.05, upper: 0.95),
                    y: clamp(newY, lower: 0.05, upper: 0.95)
                )
                dragOffset = .zero
            }

        let pinch = MagnificationGesture()
            .onChanged { value in liveScale = value }
            .onEnded { _ in
                let newScale = cutout.scale * liveScale
                cutout.scale = clamp(newScale, lower: minScale, upper: maxScale)
                liveScale = 1.0
            }

        return drag.simultaneously(with: pinch)
    }

    private func clamp(_ value: CGFloat, lower: CGFloat, upper: CGFloat) -> CGFloat {
        min(max(value, lower), upper)
    }

    private func loadFrames() async {
        async let last = Self.frame(at: max(0, referenceClip.trimEndS - 0.05), of: referenceClip.sourceURL)
        async let firstSegmented = Self.segmentedFrame(at: 0.05, of: cutout.sourceURL)
        let (l, f) = await (last, firstSegmented)
        await MainActor.run {
            if let l { self.referenceLastFrame = l }
            if let f { self.creatorFirstFrame = f }
        }
    }

    private static func frame(at seconds: Double, of url: URL?) async -> UIImage? {
        guard let url else { return nil }
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 720, height: 720)
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        do {
            let (cg, _) = try await generator.image(at: time)
            return UIImage(cgImage: cg)
        } catch {
            return nil
        }
    }

    /// Extract a frame AND run person segmentation on it so the editor preview shows the
    /// same "background removed" cutout the renderer will produce. Falls back to the raw
    /// frame if Vision can't find a person (e.g. landscape scene with no subject).
    private static func segmentedFrame(at seconds: Double, of url: URL?) async -> UIImage? {
        guard let raw = await frame(at: seconds, of: url), let cg = raw.cgImage else { return nil }
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .fast
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return raw }
        guard let mask = request.results?.first?.pixelBuffer else { return raw }

        let source = CIImage(cgImage: cg)
        let maskImage = CIImage(cvPixelBuffer: mask)
        let sx = source.extent.width / maskImage.extent.width
        let sy = source.extent.height / maskImage.extent.height
        let scaledMask = maskImage.transformed(by: CGAffineTransform(scaleX: sx, y: sy))

        let blend = CIFilter(name: "CIBlendWithMask")
        blend?.setValue(source, forKey: kCIInputImageKey)
        blend?.setValue(CIImage(color: .clear).cropped(to: source.extent), forKey: kCIInputBackgroundImageKey)
        blend?.setValue(scaledMask, forKey: kCIInputMaskImageKey)
        guard let masked = blend?.outputImage else { return raw }

        let ctx = CIContext()
        guard let outputCG = ctx.createCGImage(masked, from: source.extent) else { return raw }
        return UIImage(cgImage: outputCG)
    }
}
