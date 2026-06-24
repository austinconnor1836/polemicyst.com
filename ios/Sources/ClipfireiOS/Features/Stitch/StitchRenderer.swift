import AVFoundation
import CoreGraphics
import CoreImage
import Foundation
import QuartzCore
import SwiftUI
import UIKit
import Vision

public struct StitchRenderProgress: Sendable {
    public let phase: Phase
    public let fraction: Double  // 0..1

    public enum Phase: Sendable {
        case composing
        case exporting
        case completed
        case failed
    }
}

public enum StitchRenderError: LocalizedError {
    case noClips
    case sourceLoadFailed(URL)
    case noVideoTrack(URL)
    case exportFailed(String)
    case cancelled

    public var errorDescription: String? {
        switch self {
        case .noClips: return "Add at least one clip before rendering"
        case .sourceLoadFailed(let url): return "Could not load \(url.lastPathComponent)"
        case .noVideoTrack(let url): return "\(url.lastPathComponent) has no video track"
        case .exportFailed(let message): return "Export failed: \(message)"
        case .cancelled: return "Render cancelled"
        }
    }
}

public final class StitchRenderer {
    public init() {}

    /// Render the stitch to a temp MP4 file. Returns the output URL.
    public func render(
        snapshot: StitchTimelineSnapshot,
        progress: (@Sendable (StitchRenderProgress) -> Void)? = nil
    ) async throws -> URL {
        let clips = snapshot.clips
        let textOverlays = snapshot.textOverlays
        let cutout = snapshot.cutoutOverlay
        let renderSize = snapshot.layout.renderSize

        guard !clips.isEmpty else { throw StitchRenderError.noClips }

        // Diagnostic: probe each source clip for codec / resolution / framerate / color.
        // Uses synchronous AVURLAsset APIs because the modern `await asset.load(...)` was
        // observed to silently fail under iOS 26 (returns nil with no thrown error) for
        // sandboxed file URLs picked up via PHPicker.
        var clipProbes: [[String: Any]] = []
        for (i, clip) in clips.enumerated() {
            var probe: [String: Any] = ["index": i]
            guard let url = clip.sourceURL else {
                probe["error"] = "sourceURL=nil"
                clipProbes.append(probe)
                continue
            }
            probe["filename"] = url.lastPathComponent
            probe["fileExists"] = FileManager.default.fileExists(atPath: url.path)
            let asset = AVURLAsset(url: url)
            let videoTracks = asset.tracks(withMediaType: .video)
            probe["videoTrackCount"] = videoTracks.count
            probe["assetDurationS"] = CMTimeGetSeconds(asset.duration)
            if let track = videoTracks.first {
                let natural = track.naturalSize
                let pt = track.preferredTransform
                let oriented = natural.applying(pt)
                probe["naturalSize"] = "\(Int(natural.width))x\(Int(natural.height))"
                probe["orientedSize"] = "\(Int(abs(oriented.width)))x\(Int(abs(oriented.height)))"
                probe["fps"] = track.nominalFrameRate
                let fds = track.formatDescriptions as? [CMFormatDescription] ?? []
                if let fd = fds.first {
                    let codecType = CMFormatDescriptionGetMediaSubType(fd)
                    let bytes = [
                        UInt8((codecType >> 24) & 0xFF),
                        UInt8((codecType >> 16) & 0xFF),
                        UInt8((codecType >> 8) & 0xFF),
                        UInt8(codecType & 0xFF),
                    ]
                    probe["codec"] = String(bytes: bytes, encoding: .ascii) ?? "?"
                    if let ext = CMFormatDescriptionGetExtensions(fd) as? [String: Any] {
                        probe["colorPrimaries"] = (ext["CVImageBufferColorPrimaries"] as? String) ?? "?"
                        probe["transferFunc"] = (ext["CVImageBufferTransferFunction"] as? String) ?? "?"
                        probe["range"] = (ext["FullRangeVideo"] as? Bool) == true ? "full" : "video"
                    }
                }
            }
            let audioTracks = asset.tracks(withMediaType: .audio)
            probe["audioTrackCount"] = audioTracks.count
            if let at = audioTracks.first {
                let afds = at.formatDescriptions as? [CMFormatDescription] ?? []
                if let afd = afds.first,
                   let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(afd)?.pointee {
                    probe["audioSampleRate"] = asbd.mSampleRate
                    probe["audioChannels"] = Int(asbd.mChannelsPerFrame)
                }
            }
            clipProbes.append(probe)
        }
        StitchRemoteLogger.log("render-attempt-probes", payload: [
            "style": snapshot.style.rawValue,
            "renderSize": "\(Int(renderSize.width))x\(Int(renderSize.height))",
            "clipCount": clips.count,
            "probes": clipProbes,
        ])

        // Phase heartbeats so a crash mid-render tells us WHERE it died (no render-failed
        // event fires from a process crash). Each heartbeat is fire-and-forget POST that
        // lands in tmp/stitch-debug.log; absence of the next one in the chain = the
        // crash happened during the previous phase's work.
        func heartbeat(_ phase: String, _ extra: [String: Any] = [:]) {
            var payload: [String: Any] = ["phase": phase]
            payload.merge(extra) { _, new in new }
            StitchRemoteLogger.log("render-phase", payload: payload)
        }
        heartbeat("renderer-start")

        // Reset compositor static state so stale config from a previous render
        // can't leak into this one (the static fields are process-wide).
        PersonSegmentationCompositor.frozenBackgroundImage = nil
        PersonSegmentationCompositor.activeCutout = nil
        PersonSegmentationCompositor.removeBackgroundForCutout = true
        PersonSegmentationCompositor.segmentedBaseRanges = []
        PersonSegmentationCompositor.freezeRevealCreatorRange = nil
        PersonSegmentationCompositor.textOverlayRenders = []

        // For `freezeReveal` the first clip plays through the base track and the second
        // clip is inserted on a separate cutout track at `refDuration` — its segmented
        // form draws over the reference's frozen last frame.
        let isFreezeReveal = snapshot.style == .freezeReveal && clips.count >= 2

        progress?(.init(phase: .composing, fraction: 0))

        let mixComposition = AVMutableComposition()
        guard let videoTrack = mixComposition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw StitchRenderError.exportFailed("Could not create video track")
        }
        let audioTrack = mixComposition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        )

        var instructions: [AVMutableVideoCompositionInstruction] = []
        var baseTransforms: [PersonSegmentationCompositor.BaseTransform] = []
        var currentTime = CMTime.zero

        // FreezeReveal now uses a single base track for both ref and creator (the prior
        // sparse cutout-track layout caused AVAssetExportSession to fail with OSStatus
        // -17913 — "the operation could not be completed"). Compositor switches into
        // its special "creator over frozen backdrop" path during the creator time range
        // via `freezeRevealCreatorRange`.

        let clipsForBaseTrack = clips

        heartbeat("clip-insert-loop-start", ["clipsInLoop": clipsForBaseTrack.count])
        for clip in clipsForBaseTrack {
            guard let sourceURL = clip.sourceURL else {
                throw StitchRenderError.exportFailed("A clip is still copying — please wait and try again.")
            }
            let asset = AVURLAsset(url: sourceURL)
            let sourceTracks = try await asset.loadTracks(withMediaType: .video)
            guard let sourceVideo = sourceTracks.first else {
                throw StitchRenderError.noVideoTrack(sourceURL)
            }

            let timescale: Int32 = 600
            let start = CMTime(seconds: clip.trimStartS, preferredTimescale: timescale)
            let duration = CMTime(seconds: clip.effectiveDurationS, preferredTimescale: timescale)
            let range = CMTimeRange(start: start, duration: duration)

            try videoTrack.insertTimeRange(range, of: sourceVideo, at: currentTime)

            if let audioTrack,
               let sourceAudio = try await asset.loadTracks(withMediaType: .audio).first {
                // Clamp insertion to the time range actually present in the source audio —
                // some recordings have video and audio of slightly different durations.
                let audioTimeRange = try await sourceAudio.load(.timeRange)
                let safeStart = CMTimeMaximum(range.start, audioTimeRange.start)
                let safeEnd = CMTimeMinimum(range.end, audioTimeRange.end)
                if safeEnd > safeStart {
                    let safeRange = CMTimeRange(start: safeStart, end: safeEnd)
                    do {
                        try audioTrack.insertTimeRange(safeRange, of: sourceAudio, at: currentTime)
                        NSLog("[Stitch] Audio inserted for %@ (%.2fs)",
                              sourceURL.lastPathComponent,
                              CMTimeGetSeconds(safeRange.duration))
                    } catch {
                        NSLog("[Stitch] Audio insert failed for %@: %@",
                              sourceURL.lastPathComponent, error.localizedDescription)
                        // Don't bail the whole render — just lose audio for this clip.
                    }
                } else {
                    NSLog("[Stitch] Audio source has no overlap with desired range for %@",
                          sourceURL.lastPathComponent)
                }
            } else if audioTrack != nil {
                NSLog("[Stitch] Source has no audio track: %@", sourceURL.lastPathComponent)
            }

            // Per-clip transform: aspect-fill into render canvas, honoring source preferredTransform.
            let preferred = try await sourceVideo.load(.preferredTransform)
            let naturalSize = try await sourceVideo.load(.naturalSize)
            let transform = aspectFillTransform(
                naturalSize: naturalSize,
                preferred: preferred,
                renderSize: renderSize
            )

            let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
            layerInstruction.setTransform(transform, at: currentTime)

            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = CMTimeRange(start: currentTime, duration: duration)
            instruction.layerInstructions = [layerInstruction]
            instructions.append(instruction)

            baseTransforms.append(.init(
                timeRange: CMTimeRange(start: currentTime, duration: duration),
                transform: transform
            ))

            currentTime = CMTimeAdd(currentTime, duration)
        }

        heartbeat("clip-insert-loop-done")

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

        let totalDuration: CMTime
        if isFreezeReveal {
            let referenceClip = clips[0]
            let creatorClip = clips[1]
            // Main loop has already concatenated ref + creator on the base track. We pass
            // their individual durations so the compositor knows where the boundary is.
            let timescale: Int32 = 600
            let refTimeline = CMTime(seconds: referenceClip.effectiveDurationS, preferredTimescale: timescale)
            let creatorTimeline = CMTime(seconds: creatorClip.effectiveDurationS, preferredTimescale: timescale)
            totalDuration = try await installFreezeReveal(
                referenceClip: referenceClip,
                creatorClip: creatorClip,
                referenceTimelineDuration: refTimeline,
                creatorTimelineDuration: creatorTimeline,
                userCutout: cutout,
                baseVideoTrack: videoTrack,
                baseTransforms: baseTransforms,
                renderSize: renderSize,
                videoComposition: videoComposition
            )
        } else {
            totalDuration = currentTime
            videoComposition.instructions = instructions

            // Per-clip background removal in freeform: each clip whose `removeBackground`
            // is true gets its base-track time range added so the compositor segments it
            // for the duration of that clip.
            let segmentedRanges = baseSegmentationRanges(clips: clipsForBaseTrack)

            // Cutout overlay → install custom compositor + insert cutout source as a second track.
            if let cutout, let clipRange = clipTimeRanges(clips: clips)[cutout.clipId] {
                try await installCutout(
                    cutout: cutout,
                    clipStartS: clipRange.startS,
                    clipEndS: clipRange.endS,
                    mixComposition: mixComposition,
                    baseVideoTrack: videoTrack,
                    baseTransforms: baseTransforms,
                    totalDuration: totalDuration,
                    renderSize: renderSize,
                    videoComposition: videoComposition
                )
                PersonSegmentationCompositor.segmentedBaseRanges = segmentedRanges
            } else if !segmentedRanges.isEmpty {
                // No cutout, but at least one clip has BG removal. Install the custom
                // compositor with a spanning instruction over just the base track so the
                // segmented slots render correctly. Compositor's cutout fields stay nil/invalid.
                installBaseOnlySegmentation(
                    baseVideoTrack: videoTrack,
                    baseTransforms: baseTransforms,
                    totalDuration: totalDuration,
                    renderSize: renderSize,
                    videoComposition: videoComposition
                )
                PersonSegmentationCompositor.segmentedBaseRanges = segmentedRanges
            }
        }

        heartbeat("compositor-installed", ["totalDurationS": CMTimeGetSeconds(totalDuration), "isFreezeReveal": isFreezeReveal])

        // Text overlays. Two render paths:
        //  - When a CUSTOM compositor is active (freezeReveal or freeform+cutout), we
        //    pre-render each overlay to a CIImage and hand it to the compositor — the
        //    `AVVideoCompositionCoreAnimationTool` + custom-compositor combination trips
        //    a known iOS 17+ encoder bug that surfaces as -11800 / OSStatus -17913.
        //  - When the export is plain-AVAssetExport (no custom compositor), animationTool
        //    is fine and we keep using it (cheaper / supports CA animations).
        if !textOverlays.isEmpty {
            let clipRanges = clipTimeRanges(clips: clips)
            let usingCustomCompositor = videoComposition.customVideoCompositorClass != nil
            if usingCustomCompositor {
                var renders: [PersonSegmentationCompositor.TextOverlayRender] = []
                let timescale: Int32 = 600
                for overlay in textOverlays {
                    guard let range = clipRanges[overlay.clipId] else { continue }
                    guard let render = renderTextOverlayToCIImage(
                        overlay: overlay,
                        renderSize: renderSize
                    ) else { continue }
                    let timeRange = CMTimeRange(
                        start: CMTime(seconds: range.startS, preferredTimescale: timescale),
                        duration: CMTime(seconds: max(0, range.endS - range.startS), preferredTimescale: timescale)
                    )
                    renders.append(.init(
                        timeRange: timeRange,
                        image: render.image,
                        originBottomLeft: render.originBottomLeft
                    ))
                }
                PersonSegmentationCompositor.textOverlayRenders = renders
            } else {
                let parentLayer = CALayer()
                let videoLayer = CALayer()
                parentLayer.frame = CGRect(origin: .zero, size: renderSize)
                videoLayer.frame = parentLayer.frame
                parentLayer.addSublayer(videoLayer)

                for overlay in textOverlays {
                    guard let range = clipRanges[overlay.clipId] else { continue }
                    let layer = makeTextOverlayLayer(
                        overlay: overlay,
                        startS: range.startS,
                        endS: range.endS,
                        renderSize: renderSize
                    )
                    parentLayer.addSublayer(layer)
                }

                videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
                    postProcessingAsVideoLayer: videoLayer,
                    in: parentLayer
                )
            }
        }

        progress?(.init(phase: .exporting, fraction: 0))

        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("stitch-\(UUID().uuidString).mp4")

        // DEBUG (2026-06-24): MediumQuality is more permissive than HighestQuality
        // about heterogeneous input formats. Stick with this while diagnosing -17913;
        // promote back to HighestQuality once root cause is identified + fixed.
        heartbeat("text-overlays-done", ["textOverlayCount": textOverlays.count])

        guard let exporter = AVAssetExportSession(
            asset: mixComposition,
            presetName: AVAssetExportPresetMediumQuality
        ) else {
            throw StitchRenderError.exportFailed("Could not create export session")
        }
        exporter.outputURL = outputURL
        exporter.outputFileType = .mp4
        exporter.videoComposition = videoComposition
        exporter.shouldOptimizeForNetworkUse = true
        NSLog("[Stitch] export start: renderSize=%.0fx%.0f, totalDuration=%.2fs, tracks=%d, instructions=%d",
              videoComposition.renderSize.width,
              videoComposition.renderSize.height,
              CMTimeGetSeconds(totalDuration),
              mixComposition.tracks.count,
              videoComposition.instructions.count)

        // Force audio at unity gain. Without an explicit audioMix, some pipelines (especially
        // when a custom video compositor or animationTool is present) silently drop audio.
        if let audioTrack = mixComposition.tracks(withMediaType: .audio).first {
            let audioMix = AVMutableAudioMix()
            let params = AVMutableAudioMixInputParameters(track: audioTrack)
            params.setVolume(1.0, at: .zero)
            audioMix.inputParameters = [params]
            exporter.audioMix = audioMix
            NSLog("[Stitch] Audio track present (%.2fs), audioMix set", CMTimeGetSeconds(audioTrack.timeRange.duration))
        } else {
            NSLog("[Stitch] No audio track in composition")
        }

        let progressTask = Task { @MainActor in
            while !Task.isCancelled, exporter.status == .waiting || exporter.status == .exporting {
                progress?(.init(phase: .exporting, fraction: Double(exporter.progress)))
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        defer { progressTask.cancel() }

        heartbeat("export-start")
        await exporter.export()
        heartbeat("export-end", ["status": exporter.status.rawValue])

        switch exporter.status {
        case .completed:
            progress?(.init(phase: .completed, fraction: 1))
            return outputURL
        case .cancelled:
            throw StitchRenderError.cancelled
        case .failed:
            let detail = describeExportError(exporter.error)
            NSLog("[Stitch] export failed: %@", detail)
            throw StitchRenderError.exportFailed(detail)
        default:
            throw StitchRenderError.exportFailed("status: \(exporter.status.rawValue)")
        }
    }

    /// AVFoundation export errors usually surface as the generic "The operation could not
    /// be completed" string. The real diagnostic info lives in `userInfo` — the underlying
    /// error, the failure reason, and the domain+code. Stitch them into a single line so
    /// the in-app alert (and the Xcode console) reports something actionable.
    private func describeExportError(_ error: Error?) -> String {
        guard let error else { return "Export failed: unknown error" }
        let ns = error as NSError
        var parts: [String] = []
        parts.append("\(ns.domain) code=\(ns.code)")
        let primary = ns.localizedDescription
        if !primary.isEmpty { parts.append(primary) }
        if let reason = ns.localizedFailureReason, !reason.isEmpty {
            parts.append("reason: \(reason)")
        }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            parts.append("underlying: \(underlying.domain) code=\(underlying.code) — \(underlying.localizedDescription)")
        }
        return parts.joined(separator: " | ")
    }

    // MARK: - Helpers

    private func aspectFillTransform(
        naturalSize: CGSize,
        preferred: CGAffineTransform,
        renderSize: CGSize
    ) -> CGAffineTransform {
        // Apply preferred transform first to get oriented size.
        let oriented = naturalSize.applying(preferred)
        let orientedSize = CGSize(width: abs(oriented.width), height: abs(oriented.height))

        let scale = max(renderSize.width / orientedSize.width, renderSize.height / orientedSize.height)
        let scaledW = orientedSize.width * scale
        let scaledH = orientedSize.height * scale
        let tx = (renderSize.width - scaledW) / 2.0
        let ty = (renderSize.height - scaledH) / 2.0

        return preferred
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: tx, y: ty))
    }

    private func clipTimeRanges(clips: [StitchClip]) -> [UUID: (startS: Double, endS: Double)] {
        var t: Double = 0
        var out: [UUID: (Double, Double)] = [:]
        for clip in clips {
            let d = clip.effectiveDurationS
            out[clip.id] = (t, t + d)
            t += d
        }
        return out
    }

    private func makeTextOverlayLayer(
        overlay: TextOverlay,
        startS: Double,
        endS: Double,
        renderSize: CGSize
    ) -> CALayer {
        let container = CALayer()
        container.frame = CGRect(origin: .zero, size: renderSize)
        container.opacity = 0  // animated below

        // Measure text.
        let font = UIFont.systemFont(ofSize: overlay.fontSize, weight: .semibold)
        let attrs: [NSAttributedString.Key: Any] = [.font: font]
        let nsString = overlay.text as NSString
        let measured = nsString.size(withAttributes: attrs)
        let padding: CGFloat = overlay.backgroundColor == nil ? 0 : 24
        let boxW = measured.width + padding * 2
        let boxH = measured.height + padding * 2
        let centerX = overlay.position.x * renderSize.width
        let centerY = (1 - overlay.position.y) * renderSize.height  // flip: SwiftUI y-down → Core Animation y-up
        let frame = CGRect(
            x: centerX - boxW / 2,
            y: centerY - boxH / 2,
            width: boxW,
            height: boxH
        )

        if let bg = overlay.backgroundColor {
            let bgLayer = CALayer()
            bgLayer.frame = frame
            bgLayer.cornerRadius = 12
            bgLayer.backgroundColor = UIColor(bg).cgColor
            container.addSublayer(bgLayer)
        }

        let textLayer = CATextLayer()
        textLayer.string = overlay.text
        textLayer.font = font
        textLayer.fontSize = overlay.fontSize
        textLayer.foregroundColor = UIColor(overlay.textColor).cgColor
        textLayer.alignmentMode = .center
        textLayer.contentsScale = UIScreen.main.scale
        textLayer.frame = CGRect(
            x: frame.minX + padding,
            y: frame.minY + padding,
            width: measured.width,
            height: measured.height
        )
        container.addSublayer(textLayer)

        // Discrete on/off opacity animation across the export timeline.
        let anim = CAKeyframeAnimation(keyPath: "opacity")
        anim.values = [0, 1, 1, 0]
        let total = max(0.001, endS) + 1  // pad so endS keyframe is in-range
        anim.keyTimes = [
            0,
            NSNumber(value: startS / total),
            NSNumber(value: endS / total),
            1,
        ]
        anim.duration = total
        anim.beginTime = AVCoreAnimationBeginTimeAtZero
        anim.fillMode = .both
        anim.isRemovedOnCompletion = false
        anim.calculationMode = .discrete
        container.add(anim, forKey: "opacity")

        return container
    }

    private func installCutout(
        cutout: CutoutOverlay,
        clipStartS: Double,
        clipEndS: Double,
        mixComposition: AVMutableComposition,
        baseVideoTrack: AVMutableCompositionTrack,
        baseTransforms: [PersonSegmentationCompositor.BaseTransform],
        totalDuration: CMTime,
        renderSize: CGSize,
        videoComposition: AVMutableVideoComposition
    ) async throws {
        // Add a second video track for the cutout source.
        guard let cutoutTrack = mixComposition.addMutableTrack(
            withMediaType: .video,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw StitchRenderError.exportFailed("Could not create cutout track")
        }

        // Insert the cutout source clipped to the target clip's duration (or the source duration,
        // whichever is shorter).
        let cutoutAsset = AVURLAsset(url: cutout.sourceURL)
        let cutoutSourceTracks = try await cutoutAsset.loadTracks(withMediaType: .video)
        guard let cutoutSource = cutoutSourceTracks.first else {
            throw StitchRenderError.noVideoTrack(cutout.sourceURL)
        }
        let timescale: Int32 = 600
        let clipDurationS = max(0, clipEndS - clipStartS)
        let displayDuration = min(clipDurationS, cutout.sourceDurationS)
        let cutoutRange = CMTimeRange(
            start: .zero,
            duration: CMTime(seconds: displayDuration, preferredTimescale: timescale)
        )
        try cutoutTrack.insertTimeRange(
            cutoutRange,
            of: cutoutSource,
            at: CMTime(seconds: clipStartS, preferredTimescale: timescale)
        )

        // Replace per-clip instructions with one spanning instruction that uses the custom compositor.
        let baseLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: baseVideoTrack)
        let cutoutLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: cutoutTrack)
        // We don't set transforms here — the custom compositor reads baseTransforms directly.

        let spanning = AVMutableVideoCompositionInstruction()
        spanning.timeRange = CMTimeRange(start: .zero, duration: totalDuration)
        spanning.layerInstructions = [baseLayer, cutoutLayer]

        videoComposition.customVideoCompositorClass = PersonSegmentationCompositor.self
        videoComposition.instructions = [spanning]

        // Configure the compositor's static state.
        PersonSegmentationCompositor.activeCutout = cutout
        PersonSegmentationCompositor.activeCutoutStartS = clipStartS
        PersonSegmentationCompositor.activeCutoutEndS = clipEndS
        PersonSegmentationCompositor.activeRenderSize = renderSize
        PersonSegmentationCompositor.baseTransforms = baseTransforms
        PersonSegmentationCompositor.baseTrackID = baseVideoTrack.trackID
        PersonSegmentationCompositor.cutoutTrackID = cutoutTrack.trackID
    }

    /// Freeze + Reveal preset (single-track layout). The MAIN loop has already inserted
    /// BOTH the reference and creator video+audio sequentially into `baseVideoTrack` and
    /// `audioTrack`, with per-clip transforms in `baseTransforms`. This function just:
    ///   - extracts the reference's last frame and caches it as the freeze backdrop
    ///   - builds the spanning instruction (one layer = the base track)
    ///   - configures the compositor's freezeReveal range so its special compose path
    ///     fires for any time inside the creator's slot
    ///
    /// Crucially we do NOT create a second video track here — a sparse cutout track is
    /// what made AVAssetExportSession fail with OSStatus -17913.
    private func installFreezeReveal(
        referenceClip: StitchClip,
        creatorClip: StitchClip,
        referenceTimelineDuration: CMTime,
        creatorTimelineDuration: CMTime,
        userCutout: CutoutOverlay?,
        baseVideoTrack: AVMutableCompositionTrack,
        baseTransforms: [PersonSegmentationCompositor.BaseTransform],
        renderSize: CGSize,
        videoComposition: AVMutableVideoComposition
    ) async throws -> CMTime {
        guard let referenceURL = referenceClip.sourceURL else {
            throw StitchRenderError.exportFailed("Reference clip is still copying — please wait and try again.")
        }
        guard let creatorURL = creatorClip.sourceURL else {
            throw StitchRenderError.exportFailed("Creator clip is still copying — please wait and try again.")
        }

        // Extract the reference's last frame. Stored statically as the freeze backdrop —
        // the compositor uses it during the creator time range when the base track frame
        // is the creator video (not the ref any more).
        let frozen = try await freezeLastFrame(
            sourceURL: referenceURL,
            trimEndS: referenceClip.trimEndS,
            renderSize: renderSize,
            segmentPerson: referenceClip.removeBackground
        )

        // Single spanning instruction, single video track. No sparseness.
        let totalDuration = CMTimeAdd(referenceTimelineDuration, creatorTimelineDuration)
        let baseLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: baseVideoTrack)
        let spanning = AVMutableVideoCompositionInstruction()
        spanning.timeRange = CMTimeRange(start: .zero, duration: totalDuration)
        spanning.layerInstructions = [baseLayer]

        videoComposition.customVideoCompositorClass = PersonSegmentationCompositor.self
        videoComposition.instructions = [spanning]

        // The "virtual" cutout the compositor's freezeReveal path reads — sourceURL is
        // creatorURL purely for downstream display code; the compositor uses base-track
        // frames, not this URL, since the creator IS on the base track now.
        let virtualCutout = CutoutOverlay(
            clipId: referenceClip.id,
            sourceURL: creatorURL,
            sourceDurationS: creatorClip.effectiveDurationS,
            position: userCutout?.position ?? CGPoint(x: 0.5, y: 0.5),
            scale: userCutout?.scale ?? 0.9
        )

        let refDurationS = CMTimeGetSeconds(referenceTimelineDuration)
        let creatorDurationS = CMTimeGetSeconds(creatorTimelineDuration)
        PersonSegmentationCompositor.activeCutout = virtualCutout
        PersonSegmentationCompositor.activeRenderSize = renderSize
        PersonSegmentationCompositor.baseTransforms = baseTransforms
        PersonSegmentationCompositor.baseTrackID = baseVideoTrack.trackID
        PersonSegmentationCompositor.cutoutTrackID = kCMPersistentTrackID_Invalid
        PersonSegmentationCompositor.frozenBackgroundImage = frozen
        PersonSegmentationCompositor.removeBackgroundForCutout = creatorClip.removeBackground
        PersonSegmentationCompositor.freezeRevealCreatorRange = CMTimeRange(
            start: referenceTimelineDuration,
            duration: creatorTimelineDuration
        )
        // Reference BG → mask the ref's base-track playback for its full slot.
        if referenceClip.removeBackground {
            PersonSegmentationCompositor.segmentedBaseRanges = [
                CMTimeRange(start: .zero, duration: referenceTimelineDuration),
            ]
        }

        NSLog("[Stitch] freezeReveal installed (single-track): refDur=%.2fs creatorDur=%.2fs total=%.2fs cutoutScale=%.2f cutoutPos=(%.2f,%.2f) refBG=%d creatorBG=%d frozen=%.0fx%.0f baseTrackID=%d",
              refDurationS,
              creatorDurationS,
              CMTimeGetSeconds(totalDuration),
              virtualCutout.scale,
              virtualCutout.position.x, virtualCutout.position.y,
              referenceClip.removeBackground ? 1 : 0,
              creatorClip.removeBackground ? 1 : 0,
              frozen.extent.width, frozen.extent.height,
              baseVideoTrack.trackID)

        return totalDuration
    }

    /// Spans the whole timeline with the custom compositor on the base track only — used
    /// in freeform when one or more clips have `removeBackground` on but there's no cutout
    /// overlay. The compositor's cutout fields stay invalid so its cutout codepath stays off.
    private func installBaseOnlySegmentation(
        baseVideoTrack: AVMutableCompositionTrack,
        baseTransforms: [PersonSegmentationCompositor.BaseTransform],
        totalDuration: CMTime,
        renderSize: CGSize,
        videoComposition: AVMutableVideoComposition
    ) {
        let baseLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: baseVideoTrack)
        let spanning = AVMutableVideoCompositionInstruction()
        spanning.timeRange = CMTimeRange(start: .zero, duration: totalDuration)
        spanning.layerInstructions = [baseLayer]

        videoComposition.customVideoCompositorClass = PersonSegmentationCompositor.self
        videoComposition.instructions = [spanning]

        PersonSegmentationCompositor.activeCutout = nil
        PersonSegmentationCompositor.activeRenderSize = renderSize
        PersonSegmentationCompositor.baseTransforms = baseTransforms
        PersonSegmentationCompositor.baseTrackID = baseVideoTrack.trackID
        PersonSegmentationCompositor.cutoutTrackID = kCMPersistentTrackID_Invalid
    }

    /// Walk the clips array tracking cumulative composition time, return one CMTimeRange
    /// per clip that has BG removal turned on. Empty for an all-normal stitch.
    private func baseSegmentationRanges(clips: [StitchClip]) -> [CMTimeRange] {
        var ranges: [CMTimeRange] = []
        var cursor = CMTime.zero
        let timescale: Int32 = 600
        for clip in clips {
            let duration = CMTime(seconds: clip.effectiveDurationS, preferredTimescale: timescale)
            if clip.removeBackground {
                ranges.append(CMTimeRange(start: cursor, duration: duration))
            }
            cursor = CMTimeAdd(cursor, duration)
        }
        return ranges
    }

    /// Extracts the last frame of a video at `trimEndS` and returns a CIImage already
    /// aspect-filled into `renderSize`. Used by `installFreezeReveal` to cache the
    /// background the segmented creator plays over.
    /// When `segmentPerson` is true the frame is run through `VNGeneratePersonSegmentationRequest`
    /// before scaling — the result is the masked person composited over black so the freeze
    /// frame ends up as "just the person, on a black backdrop".
    private func freezeLastFrame(
        sourceURL: URL,
        trimEndS: Double,
        renderSize: CGSize,
        segmentPerson: Bool
    ) async throws -> CIImage {
        let asset = AVURLAsset(url: sourceURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        // Generate at 2× the canvas so any sub-pixel positioning still looks sharp.
        generator.maximumSize = CGSize(width: renderSize.width * 2, height: renderSize.height * 2)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
        // Aim slightly inside the trim end so the generator finds a valid sample.
        let lastTime = CMTime(seconds: max(0, trimEndS - 0.05), preferredTimescale: 600)
        let cgImage: CGImage
        do {
            (cgImage, _) = try await generator.image(at: lastTime)
        } catch {
            let ns = error as NSError
            throw StitchRenderError.exportFailed(
                "freezeLastFrame.copyCGImage (at=\(lastTime.seconds)s for \(sourceURL.lastPathComponent)): \(ns.domain) code=\(ns.code) — \(ns.localizedDescription)"
            )
        }
        let source: CIImage
        if segmentPerson, let masked = try? Self.segmentCGImage(cgImage) {
            // Composite over black so the freeze ends up with a defined backdrop instead
            // of transparent regions where the bg used to be.
            let backdrop = CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: CGSize(width: cgImage.width, height: cgImage.height)))
            source = masked.composited(over: backdrop)
        } else {
            source = CIImage(cgImage: cgImage)
        }
        let orientedSize = CGSize(width: source.extent.width, height: source.extent.height)
        let scale = max(renderSize.width / orientedSize.width, renderSize.height / orientedSize.height)
        let scaledW = orientedSize.width * scale
        let scaledH = orientedSize.height * scale
        let tx = (renderSize.width - scaledW) / 2.0
        let ty = (renderSize.height - scaledH) / 2.0
        return source
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: tx, y: ty))
            .cropped(to: CGRect(origin: .zero, size: renderSize))
    }

    /// Pre-render a text overlay to a CIImage + bottom-left origin in render-canvas
    /// pixel space. Pre-rendering at install time means the compositor's per-frame work
    /// is just a translate + composite (no font measurement, no allocation).
    private func renderTextOverlayToCIImage(
        overlay: TextOverlay,
        renderSize: CGSize
    ) -> (image: CIImage, originBottomLeft: CGPoint)? {
        let font = UIFont.systemFont(ofSize: overlay.fontSize, weight: .semibold)
        let textAttrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor(overlay.textColor),
        ]
        let nsString = overlay.text as NSString
        let measured = nsString.size(withAttributes: textAttrs)
        let padding: CGFloat = overlay.hasBackground ? 24 : 0
        let boxW = measured.width + padding * 2
        let boxH = measured.height + padding * 2

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: boxW, height: boxH))
        let uiImage = renderer.image { ctx in
            if let bg = overlay.backgroundColor {
                ctx.cgContext.setFillColor(UIColor(bg).cgColor)
                let path = UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: boxW, height: boxH), cornerRadius: 12)
                path.fill()
            }
            nsString.draw(at: CGPoint(x: padding, y: padding), withAttributes: textAttrs)
        }
        guard let cgImage = uiImage.cgImage else { return nil }
        let image = CIImage(cgImage: cgImage)
        // Position. Render-canvas y-up (Core Image) — flip overlay.position.y same way the
        // animationTool path does. centerY in CA = (1 - normalized.y) * renderH.
        let centerX = overlay.position.x * renderSize.width
        let centerYCA = (1 - overlay.position.y) * renderSize.height
        let origin = CGPoint(x: centerX - boxW / 2, y: centerYCA - boxH / 2)
        return (image, origin)
    }

    /// Standalone person segmentation that accepts a CGImage (the compositor's helper takes
    /// a CVPixelBuffer). Returns the source masked to the person on transparent background,
    /// or nil if Vision didn't find anyone. Used for the static freeze frame.
    private static func segmentCGImage(_ cgImage: CGImage) throws -> CIImage? {
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try handler.perform([request])
        guard let mask = request.results?.first?.pixelBuffer else { return nil }
        let source = CIImage(cgImage: cgImage)
        let maskImage = CIImage(cvPixelBuffer: mask)
        let scaleX = source.extent.width / maskImage.extent.width
        let scaleY = source.extent.height / maskImage.extent.height
        let scaledMask = maskImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        let blend = CIFilter(name: "CIBlendWithMask")
        blend?.setValue(source, forKey: kCIInputImageKey)
        blend?.setValue(CIImage(color: .clear).cropped(to: source.extent), forKey: kCIInputBackgroundImageKey)
        blend?.setValue(scaledMask, forKey: kCIInputMaskImageKey)
        return blend?.outputImage
    }
}
