import Foundation

/// Persists the in-progress stitch draft (clips + overlays + title) to disk so the user's
/// work survives app reinstalls. Stored as a small JSON file in Application Support;
/// individual clip files live under Documents/stitch-drafts/<clip-id>.mp4 (Documents is
/// preserved across reinstalls and visible in the iOS Files app).
public struct StitchDraft: Codable, Equatable {
    public var clips: [StitchClip]
    public var textOverlays: [TextOverlay]
    public var cutoutOverlay: CutoutOverlay?
    public var layout: StitchLayout
    public var title: String
    /// Server-side `Composition` id created the first time a clip is added (or the
    /// editor opens with existing clips). Persisting it on the draft means a draft
    /// re-opened in a new session can keep adding tracks to the SAME composition,
    /// rather than orphaning the previously-uploaded tracks.
    public var serverCompositionId: String?
    /// Composition style preset. Defaults to `.freeform` so old drafts written before
    /// the field existed decode unchanged.
    public var style: StitchStyle

    public init(
        clips: [StitchClip] = [],
        textOverlays: [TextOverlay] = [],
        cutoutOverlay: CutoutOverlay? = nil,
        layout: StitchLayout = .mobile,
        title: String = "",
        serverCompositionId: String? = nil,
        style: StitchStyle = .freeform
    ) {
        self.clips = clips
        self.textOverlays = textOverlays
        self.cutoutOverlay = cutoutOverlay
        self.layout = layout
        self.title = title
        self.serverCompositionId = serverCompositionId
        self.style = style
    }

    public var isEmpty: Bool {
        clips.isEmpty && textOverlays.isEmpty && cutoutOverlay == nil && title.isEmpty
    }

    // Custom Decodable so drafts written before a field existed still decode (the new
    // field falls back to its default). Drops the silent "old draft is lost on upgrade"
    // failure mode the auto-synthesized decoder has on schema changes.
    private enum CodingKeys: String, CodingKey {
        case clips, textOverlays, cutoutOverlay, layout, title, serverCompositionId, style
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.clips = try c.decodeIfPresent([StitchClip].self, forKey: .clips) ?? []
        self.textOverlays = try c.decodeIfPresent([TextOverlay].self, forKey: .textOverlays) ?? []
        self.cutoutOverlay = try c.decodeIfPresent(CutoutOverlay.self, forKey: .cutoutOverlay)
        self.layout = try c.decodeIfPresent(StitchLayout.self, forKey: .layout) ?? .mobile
        self.title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        self.serverCompositionId = try c.decodeIfPresent(String.self, forKey: .serverCompositionId)
        self.style = try c.decodeIfPresent(StitchStyle.self, forKey: .style) ?? .freeform
    }
}

public enum StitchDraftStore {
    /// Persistent directory for stitch-draft clip files. Survives reinstalls.
    public static var clipsDir: URL {
        let dir = FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask).first!
            .appendingPathComponent("stitch-drafts", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static var draftJSONURL: URL {
        let appSupport = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        return appSupport.appendingPathComponent("stitch-draft.json")
    }

    public static func load() -> StitchDraft? {
        guard let data = try? Data(contentsOf: draftJSONURL),
              let draft = try? JSONDecoder().decode(StitchDraft.self, from: data) else {
            return nil
        }
        // The draft on disk stores filenames; remap to absolute paths under the current
        // app container (the path can change between reinstalls).
        let remapped = StitchDraft(
            clips: draft.clips.map { clip in
                var c = clip
                if let url = clip.sourceURL {
                    c.sourceURL = clipsDir.appendingPathComponent(url.lastPathComponent)
                }
                return c
            },
            textOverlays: draft.textOverlays,
            cutoutOverlay: {
                guard var co = draft.cutoutOverlay else { return nil }
                co.sourceURL = clipsDir.appendingPathComponent(co.sourceURL.lastPathComponent)
                return co
            }(),
            layout: draft.layout,
            title: draft.title,
            serverCompositionId: draft.serverCompositionId
        )
        return remapped
    }

    public static func save(_ draft: StitchDraft) {
        // Persist filenames only — the absolute path changes between installs, but the
        // filename + clipsDir is enough to reconstruct.
        let normalized = StitchDraft(
            clips: draft.clips.map { clip in
                var c = clip
                if let url = clip.sourceURL {
                    c.sourceURL = URL(fileURLWithPath: url.lastPathComponent)
                }
                return c
            },
            textOverlays: draft.textOverlays,
            cutoutOverlay: {
                guard var co = draft.cutoutOverlay else { return nil }
                co.sourceURL = URL(fileURLWithPath: co.sourceURL.lastPathComponent)
                return co
            }(),
            layout: draft.layout,
            title: draft.title,
            serverCompositionId: draft.serverCompositionId
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(normalized) else { return }
        try? data.write(to: draftJSONURL, options: .atomic)
    }

    /// Full nuke — JSON manifest AND every clip file. Use only when you're sure no
    /// in-flight render is still pointing at the clip files. The editor's dispatch path
    /// uses `clearManifestOnly()` instead so the detached renderer can still read the
    /// clips it captured in its snapshot.
    public static func clear() {
        try? FileManager.default.removeItem(at: draftJSONURL)
        if let files = try? FileManager.default.contentsOfDirectory(at: clipsDir, includingPropertiesForKeys: nil) {
            for f in files { try? FileManager.default.removeItem(at: f) }
        }
    }

    /// Clear just the JSON draft, leave the clip files alone. The renderer is detached
    /// and still holds URLs to those files via its snapshot — deleting them out from
    /// under it was the cause of the -11800/-17913 export crash. Files are cleaned up
    /// after Phase 1 of `runRenderPipeline` completes (or after the user dismisses a
    /// failed render).
    public static func clearManifestOnly() {
        try? FileManager.default.removeItem(at: draftJSONURL)
    }

    /// Delete the specific files referenced by a finished render's snapshot. Safe to
    /// call after the renderer has read them.
    public static func removeFiles(urls: [URL]) {
        for url in urls {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
