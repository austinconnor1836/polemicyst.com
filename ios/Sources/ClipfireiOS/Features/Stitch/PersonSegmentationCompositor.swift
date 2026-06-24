import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
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
    /// Absolute stitch-timeline start time (seconds) of the cutout's clip.
    public static var activeCutoutStartS: Double = 0
    /// Absolute stitch-timeline end time (seconds) of the cutout's clip.
    public static var activeCutoutEndS: Double = 0
    /// Final render canvas size (e.g. 1080×1920).
    public static var activeRenderSize: CGSize = CGSize(width: 1080, height: 1920)
    /// Per-clip transforms for the base track, indexed by absolute composition time range.
    public static var baseTransforms: [BaseTransform] = []
    /// Composition track ID of the base (concatenated clips) video track.
    public static var baseTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid
    /// Composition track ID of the cutout-source video track (only valid if activeCutout != nil).
    public static var cutoutTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid
    /// Pre-rendered background image used during the cutout time range when the base track has
    /// no frame at that time (e.g. `freezeReveal` style — the reference video has ended, but
    /// we want its last frame held as a still background while the segmented creator plays).
    /// Expected to be already aspect-filled to `activeRenderSize`. Nil disables the freeze
    /// behaviour and the compositor falls back to base-track-or-black, matching the
    /// `freeform` cutout-over-clip flow.
    public static var frozenBackgroundImage: CIImage?
    /// When false, the cutout track is rendered as a raw rectangular PIP (scaled to
    /// `cutout.scale` × frame height, positioned at `cutout.position`) — no person mask.
    /// Defaults to true to preserve the original "always segment the cutout" behaviour.
    public static var removeBackgroundForCutout: Bool = true
    /// Composition-time ranges over which the BASE track should be person-segmented
    /// (used for per-clip BG removal — each clip with `removeBackground=true` contributes
    /// its time range here, and the compositor masks just that span over black).
    public static var segmentedBaseRanges: [CMTimeRange] = []
    /// `freezeReveal` puts both ref and creator on a single base track (avoids the
    /// sparse-track export failure — OSStatus -17913 from AVAssetExportSession). When this
    /// range is set the compositor enters its special "creator over frozen backdrop"
    /// compositing path for any frame inside it: backdrop = `frozenBackgroundImage`, the
    /// raw base frame at that time IS the creator (we drew creator into the base track),
    /// and we scale/position it per `activeCutout` (with optional segmentation per
    /// `removeBackgroundForCutout`) on top of the backdrop.
    public static var freezeRevealCreatorRange: CMTimeRange?
    /// Creator clip's display orientation. Applied via `CIImage.oriented(_:)` instead of
    /// applying the raw `preferredTransform` directly — that AVFoundation transform is
    /// defined in y-down image space and applying it in Core Image's y-up space flips
    /// the result (creator video rendered upside-down).
    public static var freezeRevealCreatorOrientation: CGImagePropertyOrientation = .up

    /// Text overlays drawn by the compositor itself instead of via
    /// `AVVideoCompositionCoreAnimationTool` — animationTool combined with a custom
    /// video compositor on iOS 17+ trips an export bug (-17913 / -11800). Each entry
    /// is a pre-rendered CIImage plus its composition-time range and pixel-space rect.
    public struct TextOverlayRender: Sendable {
        public let timeRange: CMTimeRange
        public let image: CIImage
        /// Pixel-space origin (bottom-left in Core Image's y-up coords) for the overlay
        /// inside the render canvas. Pre-computed at install time so compose() just does
        /// a translate + composite.
        public let originBottomLeft: CGPoint
    }
    public static var textOverlayRenders: [TextOverlayRender] = []

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
            // `autoreleasepool` is critical when rendering thousands of frames — without it,
            // every per-frame `CIImage`, mask `CVPixelBuffer`, and Vision intermediate
            // accumulates until the run-loop drain, which doesn't happen on background
            // queues until the queue idles. For a 77-second video that means iOS OOM-kills
            // the app before the export reaches even 30% (confirmed by `task_vm_info`
            // memory tracking during the 2026-06-24 -17913 / crash investigation).
            autoreleasepool {
                do {
                    let output = try self.compose(request: request)
                    request.finish(withComposedVideoFrame: output)
                } catch {
                    request.finish(with: error)
                }
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
        let renderRect = CGRect(origin: .zero, size: renderSize)

        // Special case: `freezeReveal` creator range. The base track holds the creator
        // video here (both ref and creator are concatenated on the same base track to
        // avoid the sparse-track export failure). We composite a positioned + optionally
        // segmented copy of the creator over the cached frozen-ref backdrop, ignoring
        // the per-clip aspect-fill transform entirely (we use cutout.scale / position).
        if let creatorRange = Self.freezeRevealCreatorRange, creatorRange.containsTime(time) {
            let backdrop = Self.frozenBackgroundImage
                ?? CIImage(color: .black).cropped(to: renderRect)
            var composite = backdrop
            if let basePB = request.sourceFrame(byTrackID: Self.baseTrackID),
               let cutout = Self.activeCutout {
                // 1. Source CIImage from the pixel buffer (optionally segmented).
                let raw: CIImage
                if Self.removeBackgroundForCutout,
                   let segmented = try? segmentPerson(pixelBuffer: basePB) {
                    raw = segmented
                } else {
                    raw = CIImage(cvPixelBuffer: basePB)
                }
                // 2. Apply display orientation via `.oriented(_:)`. We can't use the
                //    AVFoundation preferredTransform directly here — it's defined in
                //    y-down image space and applying it in CI's y-up space lands the
                //    image upside-down.
                let oriented = raw.oriented(Self.freezeRevealCreatorOrientation)
                // 3. Scale so the creator's HEIGHT matches cutout.scale × canvas height,
                //    preserving aspect ratio. A scale=1.0 cutout exactly fills the canvas
                //    height; a portrait source matches portrait canvas and is letterboxed
                //    on the sides; a landscape source extends beyond the canvas sides
                //    (visible as cropping).
                let targetH = renderSize.height * cutout.scale
                let s = targetH / oriented.extent.height
                let scaled = oriented.transformed(by: CGAffineTransform(scaleX: s, y: s))
                // 4. Center it on cutout.position. `.position.y` is SwiftUI-style
                //    (0 = top, 1 = bottom); flip for Core Image's y-up coords.
                let targetCenterX = cutout.position.x * renderSize.width
                let targetCenterY = (1 - cutout.position.y) * renderSize.height
                let dx = targetCenterX - scaled.extent.midX
                let dy = targetCenterY - scaled.extent.midY
                let positioned = scaled.transformed(by: CGAffineTransform(translationX: dx, y: dy))
                composite = positioned.composited(over: backdrop)
            }
            composite = applyTextOverlays(composite, at: time)
            ciContext.render(composite, to: outBuffer)
            return outBuffer
        }

        // 1. Base track frame, transformed to fit the render canvas.
        // If the current time falls in a per-clip segmented range, run the person mask on
        // the raw frame BEFORE applying the aspect-fill transform — the resulting alpha
        // travels through the affine transform cleanly and the person ends up positioned
        // correctly in the render canvas.
        var baseImage: CIImage?
        if let basePB = request.sourceFrame(byTrackID: Self.baseTrackID) {
            let transform = transformForBase(at: time)
            let shouldSegmentBase = Self.isInSegmentedBaseRange(time: time)
            let source: CIImage
            if shouldSegmentBase, let segmented = try? segmentPerson(pixelBuffer: basePB) {
                source = segmented
            } else {
                source = CIImage(cvPixelBuffer: basePB)
            }
            baseImage = source.transformed(by: transform).cropped(to: renderRect)
        }

        // 2. Backdrop selection. Order of preference:
        //    - If the base track has a frame (possibly segmented), it's the backdrop.
        //    - Else inside the cutout time range, use the cached frozen last frame.
        //    - Else fall back to black.
        var composite: CIImage
        let inCutoutRange = timeS >= Self.activeCutoutStartS && timeS <= Self.activeCutoutEndS
        if let baseImage {
            // Segmented base has transparent regions; composite over black so the MP4 output
            // ends up with a defined background instead of undefined alpha.
            if Self.isInSegmentedBaseRange(time: time) {
                let backdrop = CIImage(color: .black).cropped(to: renderRect)
                composite = baseImage.composited(over: backdrop)
            } else {
                composite = baseImage
            }
        } else if inCutoutRange, let frozen = Self.frozenBackgroundImage {
            composite = frozen
        } else {
            composite = CIImage(color: .black).cropped(to: renderRect)
        }

        // 3. Cutout overlay (PIP). With `removeBackgroundForCutout = false` we render the
        // raw frame as a rectangular PIP — same scale + position semantics, no person mask.
        if let cutout = Self.activeCutout,
           inCutoutRange,
           let cutoutPB = request.sourceFrame(byTrackID: Self.cutoutTrackID) {

            let cutoutImage: CIImage?
            if Self.removeBackgroundForCutout {
                cutoutImage = try? segmentPerson(pixelBuffer: cutoutPB)
            } else {
                cutoutImage = CIImage(cvPixelBuffer: cutoutPB)
            }

            if let cutoutImage {
                let subjectExtent = cutoutImage.extent
                let targetH = renderSize.height * cutout.scale
                let scale = targetH / subjectExtent.height
                let scaled = cutoutImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                let scaledSize = CGSize(width: scaled.extent.width, height: scaled.extent.height)
                let centerX = cutout.position.x * renderSize.width
                let centerY = (1 - cutout.position.y) * renderSize.height
                let positioned = scaled.transformed(by: CGAffineTransform(
                    translationX: centerX - scaledSize.width / 2,
                    y: centerY - scaledSize.height / 2
                ))
                composite = positioned.composited(over: composite)
            }
        }

        composite = applyTextOverlays(composite, at: time)
        ciContext.render(composite, to: outBuffer)
        return outBuffer
    }

    /// Composite every text overlay whose time range contains `time` on top of `composite`.
    /// No-op when `textOverlayRenders` is empty (freeform without text, or text being
    /// handled by animationTool — caller decides which path to use).
    private func applyTextOverlays(_ composite: CIImage, at time: CMTime) -> CIImage {
        guard !Self.textOverlayRenders.isEmpty else { return composite }
        var out = composite
        for entry in Self.textOverlayRenders {
            guard entry.timeRange.containsTime(time) else { continue }
            let positioned = entry.image.transformed(by: CGAffineTransform(
                translationX: entry.originBottomLeft.x,
                y: entry.originBottomLeft.y
            ))
            out = positioned.composited(over: out)
        }
        return out
    }

    private static func isInSegmentedBaseRange(time: CMTime) -> Bool {
        for range in segmentedBaseRanges {
            if range.containsTime(time) { return true }
        }
        return false
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

    /// Reused across frames — the request object holds the segmentation model. Re-creating
    /// one per frame burns memory until iOS OOM-kills the app on long renders. `.balanced`
    /// uses Apple's middle-tier model which gives noticeably cleaner contours (especially
    /// around hair and shoulders) than `.fast`. We tolerate the higher per-frame cost
    /// because we dropped the render canvas to 720×1280 — net workload is lower than
    /// `.fast` at 1080×1920 was.
    private static let personSegmentationRequest: VNGeneratePersonSegmentationRequest = {
        let r = VNGeneratePersonSegmentationRequest()
        r.qualityLevel = .balanced
        r.outputPixelFormat = kCVPixelFormatType_OneComponent8
        return r
    }()

    private func segmentPerson(pixelBuffer: CVPixelBuffer) throws -> CIImage? {
        let request = Self.personSegmentationRequest
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        try handler.perform([request])

        guard let mask = request.results?.first?.pixelBuffer else { return nil }

        let source = CIImage(cvPixelBuffer: pixelBuffer)
        let maskImage = CIImage(cvPixelBuffer: mask)

        // Vision masks come back at the model's native resolution — scale to match source.
        let scaleX = source.extent.width / maskImage.extent.width
        let scaleY = source.extent.height / maskImage.extent.height
        let scaledMask = maskImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        // Feather the mask. Without this the alpha transition is one pixel wide and the
        // cutout edge looks "stamped on." A small Gaussian blur turns it into a smooth
        // falloff that reads as a real composited person.
        let blur = CIFilter(name: "CIGaussianBlur")
        blur?.setValue(scaledMask, forKey: kCIInputImageKey)
        blur?.setValue(2.5, forKey: kCIInputRadiusKey)
        let featheredMask = blur?.outputImage?.cropped(to: source.extent) ?? scaledMask

        // Apply mask as alpha: keep source RGB where mask is 1, transparent where mask is 0.
        let blend = CIFilter(name: "CIBlendWithMask")
        blend?.setValue(source, forKey: kCIInputImageKey)
        blend?.setValue(CIImage(color: .clear).cropped(to: source.extent), forKey: kCIInputBackgroundImageKey)
        blend?.setValue(featheredMask, forKey: kCIInputMaskImageKey)
        return blend?.outputImage
    }
}
