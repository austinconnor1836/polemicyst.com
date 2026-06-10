import Foundation
import SwiftUI
import UIKit

@MainActor
public final class StitchTimeline: ObservableObject {
    @Published public var clips: [StitchClip] = []
    @Published public var textOverlays: [TextOverlay] = []
    @Published public var cutoutOverlay: CutoutOverlay?  // v1: at most one cutout
    @Published public var layout: StitchLayout = .mobile
    /// Number of clips currently mid-load from Photos. Drives placeholder cells in the grid.
    @Published public var pendingClipCount: Int = 0
    /// Cached preview thumbnails per clip id, populated by NSItemProvider.loadPreviewImage
    /// the moment the picker closes. Excluded from `StitchTimelineSnapshot` — it's UI-only.
    @Published public var previewImages: [UUID: UIImage] = [:]

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
        // Drop any overlays whose target clip no longer exists.
        textOverlays.removeAll { $0.clipId == id }
        if cutoutOverlay?.clipId == id {
            cutoutOverlay = nil
        }
    }

    public func moveClip(from source: IndexSet, to destination: Int) {
        clips.move(fromOffsets: source, toOffset: destination)
    }

    /// Set the sandbox file URL on a clip once the background `loadTransferable` copy finishes.
    public func updateClipSourceURL(id: UUID, url: URL) {
        guard let idx = clips.firstIndex(where: { $0.id == id }) else { return }
        clips[idx].sourceURL = url
    }

    /// Patch a clip's duration once we can read it from the file. Resets trimEndS to match
    /// the new duration unless the user has manually trimmed.
    public func updateClipDuration(id: UUID, durationS: Double) {
        guard let idx = clips.firstIndex(where: { $0.id == id }) else { return }
        let wasFullDuration = clips[idx].trimEndS == clips[idx].durationS || clips[idx].durationS == 0
        clips[idx].durationS = durationS
        if wasFullDuration {
            clips[idx].trimEndS = durationS
        }
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

    // MARK: - Draft persistence

    public func currentDraft(title: String) -> StitchDraft {
        StitchDraft(
            clips: clips,
            textOverlays: textOverlays,
            cutoutOverlay: cutoutOverlay,
            layout: layout,
            title: title
        )
    }

    public func applyDraft(_ draft: StitchDraft) {
        clips = draft.clips
        textOverlays = draft.textOverlays
        cutoutOverlay = draft.cutoutOverlay
        layout = draft.layout
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
