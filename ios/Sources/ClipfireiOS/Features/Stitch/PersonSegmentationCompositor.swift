import AVFoundation
import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import Vision

public final class PersonSegmentationCompositor: NSObject, AVVideoCompositing {
    // MARK: - Static config (set by StitchRenderer before export)

    public struct BaseTransform: Sendable {
        public let timeRange: CMTimeRange
        public let transform: CGAffineTransform
    }

    /// Cutout overlay placement + source.
    public static var activeCutout: CutoutOverlay?
    /// Final render canvas size (e.g. 1080×1920).
    public static var activeRenderSize: CGSize = CGSize(width: 1080, height: 1920)
    /// Per-clip transforms for the base track, indexed by absolute composition time range.
    public static var baseTransforms: [BaseTransform] = []
    /// Composition track ID of the base (concatenated clips) video track.
    public static var baseTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid
    /// Composition track ID of the cutout-source video track (only valid if activeCutout != nil).
    public static var cutoutTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid

    // MARK: - AVVideoCompositing

    public var sourcePixelBufferAttributes: [String: any Sendable]? = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]

    public var requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]

    private let ciContext = CIContext(options: nil)
    private let renderQueue = DispatchQueue(label: "stitch.personseg.render")
    private var renderContext: AVVideoCompositionRenderContext?

    public func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {
        renderQueue.sync { self.renderContext = newRenderContext }
    }

    public func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        renderQueue.async { [weak self] in
            guard let self else { return }
            do {
                let output = try self.compose(request: request)
                request.finish(withComposedVideoFrame: output)
            } catch {
                request.finish(with: error)
            }
        }
    }

    public func cancelAllPendingVideoCompositionRequests() {
        renderQueue.sync(flags: .barrier) {}
    }

    // MARK: - Compose one frame

    private func compose(request: AVAsynchronousVideoCompositionRequest) throws -> CVPixelBuffer {
        guard let outBuffer = request.renderContext.newPixelBuffer() else {
            throw NSError(domain: "PersonSegmentationCompositor", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "No pixel buffer from render context",
            ])
        }

        let renderSize = Self.activeRenderSize
        let time = request.compositionTime
        let timeS = CMTimeGetSeconds(time)

        // 1. Base track frame, transformed to fit the render canvas.
        var baseImage: CIImage?
        if let basePB = request.sourceFrame(byTrackID: Self.baseTrackID) {
            let raw = CIImage(cvPixelBuffer: basePB)
            let transform = transformForBase(at: time)
            baseImage = raw.transformed(by: transform).cropped(to: CGRect(origin: .zero, size: renderSize))
        }

        // 2. If we're in the cutout's time range, segment the cutout-source frame and composite.
        var composite = baseImage ?? CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: renderSize))

        if let cutout = Self.activeCutout,
           timeS >= cutout.startS, timeS <= cutout.endS,
           let cutoutPB = request.sourceFrame(byTrackID: Self.cutoutTrackID),
           let segmented = try? segmentPerson(pixelBuffer: cutoutPB) {

            // Resize + position the masked subject in the render canvas.
            let subjectExtent = segmented.extent
            let targetH = renderSize.height * cutout.scale
            let scale = targetH / subjectExtent.height
            let scaled = segmented.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            let scaledSize = CGSize(width: scaled.extent.width, height: scaled.extent.height)
            let centerX = cutout.position.x * renderSize.width
            let centerY = (1 - cutout.position.y) * renderSize.height
            let positioned = scaled.transformed(by: CGAffineTransform(
                translationX: centerX - scaledSize.width / 2,
                y: centerY - scaledSize.height / 2
            ))
            composite = positioned.composited(over: composite)
        }

        ciContext.render(composite, to: outBuffer)
        return outBuffer
    }

    private func transformForBase(at time: CMTime) -> CGAffineTransform {
        for entry in Self.baseTransforms {
            if entry.timeRange.containsTime(time) {
                return entry.transform
            }
        }
        return .identity
    }

    // MARK: - Vision person segmentation

    private func segmentPerson(pixelBuffer: CVPixelBuffer) throws -> CIImage? {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .balanced
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        try handler.perform([request])

        guard let mask = request.results?.first?.pixelBuffer else { return nil }

        let source = CIImage(cvPixelBuffer: pixelBuffer)
        let maskImage = CIImage(cvPixelBuffer: mask)

        // Vision masks come back at the model's native resolution — scale to match source.
        let scaleX = source.extent.width / maskImage.extent.width
        let scaleY = source.extent.height / maskImage.extent.height
        let scaledMask = maskImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        // Apply mask as alpha: keep source RGB where mask is 1, transparent where mask is 0.
        let blend = CIFilter(name: "CIBlendWithMask")
        blend?.setValue(source, forKey: kCIInputImageKey)
        blend?.setValue(CIImage(color: .clear).cropped(to: source.extent), forKey: kCIInputBackgroundImageKey)
        blend?.setValue(scaledMask, forKey: kCIInputMaskImageKey)
        return blend?.outputImage
    }
}
