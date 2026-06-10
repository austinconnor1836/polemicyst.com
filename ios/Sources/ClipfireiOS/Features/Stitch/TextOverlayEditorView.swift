import SwiftUI

/// Instagram-style positioning editor for a single text overlay over a clip thumbnail.
/// Drag to move, pinch to resize. The clip's aspect determines the canvas ratio (9:16
/// mobile, 16:9 landscape). All position/scale changes are normalized so they translate
/// 1:1 to the final 1080×1920 (or 1920×1080) render canvas.
struct TextOverlayEditorView: View {
    let clip: StitchClip
    let cachedPreview: UIImage?
    let layout: StitchLayout
    @Binding var overlay: TextOverlay
    @Environment(\.dismiss) private var dismiss

    // Live gesture state (commits to `overlay` on gesture end).
    @State private var dragOffset: CGSize = .zero
    @State private var liveScale: CGFloat = 1.0

    private let minFontSize: CGFloat = 18
    private let maxFontSize: CGFloat = 200
    private let renderCanvasHeight: CGFloat = 1920

    var body: some View {
        NavigationStack {
            GeometryReader { outer in
                let canvasAspect = layout.renderSize.width / layout.renderSize.height
                let canvasHeight = min(outer.size.height - 40, outer.size.width / canvasAspect)
                let canvasWidth = canvasHeight * canvasAspect
                let canvasSize = CGSize(width: canvasWidth, height: canvasHeight)

                VStack {
                    Spacer()
                    ZStack {
                        // Clip background.
                        StitchThumbnail(clip: clip, cachedPreview: cachedPreview)
                            .frame(width: canvasWidth, height: canvasHeight)
                            .clipped()

                        // Text floating on top.
                        textNode(canvasSize: canvasSize)
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
            .navigationTitle("Position Text")
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
        }
    }

    @ViewBuilder
    private func textNode(canvasSize: CGSize) -> some View {
        // Translate the stored normalized position (0..1) into canvas points, then add
        // the in-flight drag offset.
        let centerX = overlay.position.x * canvasSize.width + dragOffset.width
        let centerY = overlay.position.y * canvasSize.height + dragOffset.height

        // Render at the model's fontSize scaled to this canvas. Multiplying by liveScale
        // gives instant feedback during the pinch.
        let canvasScale = canvasSize.height / renderCanvasHeight
        let displayedFontSize = overlay.fontSize * canvasScale * liveScale

        Text(overlay.text.isEmpty ? "Text" : overlay.text)
            .font(.system(size: displayedFontSize, weight: .semibold))
            .foregroundStyle(overlay.textColor)
            .padding(.horizontal, overlay.hasBackground ? 12 : 0)
            .padding(.vertical, overlay.hasBackground ? 8 : 0)
            .background(overlay.backgroundColor ?? .clear)
            .clipShape(RoundedRectangle(cornerRadius: overlay.hasBackground ? 8 : 0))
            .position(x: centerX, y: centerY)
            .gesture(combinedGesture(canvasSize: canvasSize))
    }

    private func combinedGesture(canvasSize: CGSize) -> some Gesture {
        let drag = DragGesture()
            .onChanged { value in dragOffset = value.translation }
            .onEnded { value in
                let newX = overlay.position.x + value.translation.width / canvasSize.width
                let newY = overlay.position.y + value.translation.height / canvasSize.height
                overlay.position = CGPoint(
                    x: clamp(newX, lower: 0.05, upper: 0.95),
                    y: clamp(newY, lower: 0.05, upper: 0.95)
                )
                dragOffset = .zero
            }

        let pinch = MagnificationGesture()
            .onChanged { value in liveScale = value }
            .onEnded { _ in
                let newSize = overlay.fontSize * liveScale
                overlay.fontSize = clamp(newSize, lower: minFontSize, upper: maxFontSize)
                liveScale = 1.0
            }

        return drag.simultaneously(with: pinch)
    }

    private func clamp(_ value: CGFloat, lower: CGFloat, upper: CGFloat) -> CGFloat {
        min(max(value, lower), upper)
    }
}
