import Foundation
import SwiftUI

/// Where a `LocalStitch` is in the fire-and-forget pipeline that runs AFTER the
/// user taps "Render Stitch" in the editor.
///
/// The editor dismisses immediately when render is dispatched (W025), so the
/// stitch row appears in `MyStitchesView` while the pipeline below is still
/// running in the background. The card binds to this state to show a generic
/// "Processing…" pill until everything resolves to `.ready`.
public enum ProcessingState: Codable, Equatable {
    case rendering(Double)
    case uploadingFinal
    case awaitingTranscripts
    case generatingMeta
    case ready
    case failed(String)

    public var isReady: Bool {
        if case .ready = self { return true }
        return false
    }

    public var failureMessage: String? {
        if case .failed(let m) = self { return m }
        return nil
    }

    // MARK: Codable
    //
    // Hand-rolled so persisted JSON survives enum-shape changes and so old
    // records (with no processingState field at all) decode to `.ready`.

    private enum CodingKeys: String, CodingKey {
        case type
        case progress
        case message
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .rendering(let p):
            try c.encode("rendering", forKey: .type)
            try c.encode(p, forKey: .progress)
        case .uploadingFinal:
            try c.encode("uploadingFinal", forKey: .type)
        case .awaitingTranscripts:
            try c.encode("awaitingTranscripts", forKey: .type)
        case .generatingMeta:
            try c.encode("generatingMeta", forKey: .type)
        case .ready:
            try c.encode("ready", forKey: .type)
        case .failed(let m):
            try c.encode("failed", forKey: .type)
            try c.encode(m, forKey: .message)
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "rendering":
            let p = try c.decodeIfPresent(Double.self, forKey: .progress) ?? 0
            self = .rendering(p)
        case "uploadingFinal":
            self = .uploadingFinal
        case "awaitingTranscripts":
            self = .awaitingTranscripts
        case "generatingMeta":
            self = .generatingMeta
        case "ready":
            self = .ready
        case "failed":
            let m = try c.decodeIfPresent(String.self, forKey: .message) ?? "Unknown error"
            self = .failed(m)
        default:
            self = .ready
        }
    }
}

/// A stitch that has been rendered on-device and saved to the app's Documents directory.
/// The local file is the source of truth for the user; S3 upload state is invisible to them.
public struct LocalStitch: Identifiable, Codable, Equatable {
    public let id: UUID
    public var title: String
    public var caption: String?
    public var layoutKey: String   // "mobile" | "landscape"
    public var durationS: Double
    public var localFilename: String
    public var createdAt: Date
    /// Set once the silent background upload + composition creation completes.
    /// The user never sees this — it's only used so that taking other actions (publish, share)
    /// can quietly resolve to the server-side composition.
    public var serverCompositionId: String?
    /// Where this stitch is in the post-render pipeline. Defaults to `.ready`
    /// when missing from persisted JSON so previously-rendered stitches that
    /// predate W025 don't appear stuck.
    public var processingState: ProcessingState

    public init(
        id: UUID = UUID(),
        title: String,
        caption: String? = nil,
        layoutKey: String,
        durationS: Double,
        localFilename: String,
        createdAt: Date = Date(),
        serverCompositionId: String? = nil,
        processingState: ProcessingState = .ready
    ) {
        self.id = id
        self.title = title
        self.caption = caption
        self.layoutKey = layoutKey
        self.durationS = durationS
        self.localFilename = localFilename
        self.createdAt = createdAt
        self.serverCompositionId = serverCompositionId
        self.processingState = processingState
    }

    // MARK: Codable — custom decoder defaults missing fields for old persisted JSON.

    private enum CodingKeys: String, CodingKey {
        case id, title, caption, layoutKey, durationS, localFilename, createdAt, serverCompositionId, processingState
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(UUID.self, forKey: .id)
        self.title = try c.decode(String.self, forKey: .title)
        self.caption = try c.decodeIfPresent(String.self, forKey: .caption)
        self.layoutKey = try c.decode(String.self, forKey: .layoutKey)
        self.durationS = try c.decode(Double.self, forKey: .durationS)
        self.localFilename = try c.decode(String.self, forKey: .localFilename)
        self.createdAt = try c.decode(Date.self, forKey: .createdAt)
        self.serverCompositionId = try c.decodeIfPresent(String.self, forKey: .serverCompositionId)
        // Old persisted rows have no processingState — treat them as ready.
        self.processingState = try c.decodeIfPresent(ProcessingState.self, forKey: .processingState) ?? .ready
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(caption, forKey: .caption)
        try c.encode(layoutKey, forKey: .layoutKey)
        try c.encode(durationS, forKey: .durationS)
        try c.encode(localFilename, forKey: .localFilename)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(serverCompositionId, forKey: .serverCompositionId)
        try c.encode(processingState, forKey: .processingState)
    }
}

@MainActor
public final class LocalStitchStore: ObservableObject {
    public static let shared = LocalStitchStore()

    @Published public private(set) var stitches: [LocalStitch] = []

    private init() {
        try? FileManager.default.createDirectory(
            at: Self.stitchesDir,
            withIntermediateDirectories: true
        )
        load()
    }

    // MARK: - Paths

    public static var stitchesDir: URL {
        FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask).first!
            .appendingPathComponent("stitches", isDirectory: true)
    }

    private static var metadataURL: URL {
        let appSupport = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        return appSupport.appendingPathComponent("local-stitches.json")
    }

    public func localURL(for stitch: LocalStitch) -> URL {
        Self.stitchesDir.appendingPathComponent(stitch.localFilename)
    }

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: Self.metadataURL),
              let decoded = try? JSONDecoder().decode([LocalStitch].self, from: data) else {
            return
        }
        stitches = decoded.sorted { $0.createdAt > $1.createdAt }
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(stitches) else { return }
        try? data.write(to: Self.metadataURL, options: .atomic)
    }

    // MARK: - Mutations

    public func add(_ stitch: LocalStitch) {
        stitches.insert(stitch, at: 0)
        persist()
    }

    public func update(_ stitch: LocalStitch) {
        guard let idx = stitches.firstIndex(where: { $0.id == stitch.id }) else { return }
        stitches[idx] = stitch
        persist()
    }

    public func remove(id: UUID) {
        if let stitch = stitches.first(where: { $0.id == id }) {
            try? FileManager.default.removeItem(at: localURL(for: stitch))
        }
        stitches.removeAll { $0.id == id }
        persist()
    }

    /// Advance a stitch's processing-state in place. No-op if the id isn't known.
    public func setProcessingState(id: UUID, _ state: ProcessingState) {
        guard let idx = stitches.firstIndex(where: { $0.id == id }) else { return }
        stitches[idx].processingState = state
        persist()
    }

    /// Update the AI-generated title + caption on an existing stitch and mark it ready.
    public func setTitleAndCaption(id: UUID, title: String, caption: String) {
        guard let idx = stitches.firstIndex(where: { $0.id == id }) else { return }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCaption = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTitle.isEmpty {
            stitches[idx].title = trimmedTitle
        }
        if !trimmedCaption.isEmpty {
            stitches[idx].caption = trimmedCaption
        }
        stitches[idx].processingState = .ready
        persist()
    }

    /// Record the server composition id once the side-channel upload finishes.
    public func setServerCompositionId(id: UUID, compositionId: String) {
        guard let idx = stitches.firstIndex(where: { $0.id == id }) else { return }
        stitches[idx].serverCompositionId = compositionId
        persist()
    }

    /// Stitches that haven't yet been uploaded to S3 — used by the silent retry loop on app launch.
    public var pendingUploads: [LocalStitch] {
        stitches.filter { $0.serverCompositionId == nil }
    }
}
