import Foundation
import SwiftUI

@MainActor
public final class StitchTimeline: ObservableObject {
    @Published public var clips: [StitchClip] = []
    @Published public var textOverlays: [TextOverlay] = []
    @Published public var cutoutOverlay: CutoutOverlay?  // v1: at most one cutout
    @Published public var layout: StitchLayout = .mobile

    public init() {}

    public var totalDurationS: Double {
        clips.reduce(0) { $0 + $1.effectiveDurationS }
    }

    // MARK: - Clip operations

    public func addClip(_ clip: StitchClip) {
        clips.append(clip)
    }

    public func removeClip(id: UUID) {
        clips.removeAll { $0.id == id }
        // Drop any overlays that now extend past the end.
        textOverlays = textOverlays.map { overlay in
            var o = overlay
            o.endS = min(o.endS, totalDurationS)
            o.startS = min(o.startS, max(0, totalDurationS - 0.1))
            return o
        }
        .filter { $0.durationS > 0.1 }
        if let cutout = cutoutOverlay, cutout.startS >= totalDurationS {
            cutoutOverlay = nil
        }
    }

    public func moveClip(from source: IndexSet, to destination: Int) {
        clips.move(fromOffsets: source, toOffset: destination)
    }

    // MARK: - Text overlay operations

    public func addTextOverlay(_ overlay: TextOverlay) {
        textOverlays.append(overlay)
    }

    public func updateTextOverlay(_ overlay: TextOverlay) {
        guard let idx = textOverlays.firstIndex(where: { $0.id == overlay.id }) else { return }
        textOverlays[idx] = overlay
    }

    public func removeTextOverlay(id: UUID) {
        textOverlays.removeAll { $0.id == id }
    }

    // MARK: - Cutout overlay operations

    public func setCutout(_ overlay: CutoutOverlay?) {
        cutoutOverlay = overlay
    }

    public func updateCutout(_ overlay: CutoutOverlay) {
        cutoutOverlay = overlay
    }

    // MARK: - Validation

    public var canRender: Bool {
        clips.count >= 1 && totalDurationS > 0.1
    }

    public func snapshot() -> StitchTimelineSnapshot {
        StitchTimelineSnapshot(
            clips: clips,
            textOverlays: textOverlays,
            cutoutOverlay: cutoutOverlay,
            layout: layout
        )
    }
}

/// Sendable snapshot of a timeline at a point in time. Used to hand state off to the renderer
/// without crossing the @MainActor boundary on every property access.
public struct StitchTimelineSnapshot: Sendable {
    public let clips: [StitchClip]
    public let textOverlays: [TextOverlay]
    public let cutoutOverlay: CutoutOverlay?
    public let layout: StitchLayout
}
