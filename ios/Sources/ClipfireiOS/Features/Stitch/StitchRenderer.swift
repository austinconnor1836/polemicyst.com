import AVFoundation
import CoreGraphics
import CoreImage
import Foundation
import QuartzCore
import SwiftUI
import UIKit

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

        for clip in clips {
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

        let totalDuration = currentTime

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.instructions = instructions

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
        }

        // Text overlays → CALayer hierarchy via animationTool.
        if !textOverlays.isEmpty {
            let parentLayer = CALayer()
            let videoLayer = CALayer()
            parentLayer.frame = CGRect(origin: .zero, size: renderSize)
            videoLayer.frame = parentLayer.frame
            parentLayer.addSublayer(videoLayer)

            let clipRanges = clipTimeRanges(clips: clips)
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

        progress?(.init(phase: .exporting, fraction: 0))

        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("stitch-\(UUID().uuidString).mp4")

        guard let exporter = AVAssetExportSession(
            asset: mixComposition,
            presetName: AVAssetExportPreset1920x1080
        ) else {
            throw StitchRenderError.exportFailed("Could not create export session")
        }
        exporter.outputURL = outputURL
        exporter.outputFileType = .mp4
        exporter.videoComposition = videoComposition
        exporter.shouldOptimizeForNetworkUse = true

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

        await exporter.export()

        switch exporter.status {
        case .completed:
            progress?(.init(phase: .completed, fraction: 1))
            return outputURL
        case .cancelled:
            throw StitchRenderError.cancelled
        case .failed:
            throw StitchRenderError.exportFailed(exporter.error?.localizedDescription ?? "unknown")
        default:
            throw StitchRenderError.exportFailed("status: \(exporter.status.rawValue)")
        }
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
}
