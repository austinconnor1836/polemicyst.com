import Foundation
import SwiftUI

/// Where a `LocalStitch` is in the server-side render pipeline that runs AFTER
/// the user taps "Render Stitch" in the editor.
///
/// The editor dismisses immediately when render is dispatched, so the stitch
/// row appears in `MyStitchesView` while the pipeline below runs in the
/// background — first the local→S3 upload of every source clip, then the
/// server worker doing the actual render. The card binds to this state to
/// show what phase the user is waiting on.
public enum ProcessingState: Codable, Equatable {
    /// Uploading source clip files to S3 so the server worker can render them.
    /// `progress` is 0..1 across all clips.
    case uploadingClips(progress: Double)
    /// Manifest POSTed, server worker hasn't picked the job up yet.
    case queued
    /// Server worker is actively rendering. `progress` is nil — the server
    /// doesn't currently stream a progress signal back, so the UI shows
    /// indeterminate.
    case renderingOnServer(progress: Double?)
    /// Output S3 URL is present (and the local MP4 has been downloaded).
    case ready
    /// Terminal failure. `message` is user-facing.
    case failed(String)

    public var isReady: Bool {
        if case .ready = self { return true }
        return false
    }

    public var failureMessage: String? {
        if case .failed(let m) = self { return m }
        return nil
    }

    public var isWaitingOnServer: Bool {
        switch self {
        case .queued, .renderingOnServer:
            return true
        default:
            return false
        }
    }

    // MARK: Codable
    //
    // Hand-rolled so persisted JSON survives enum-shape changes and so previously
    // persisted entries (which used the OLD on-device-render state names like
    // `rendering` / `uploadingFinal` / `awaitingTranscripts` / `generatingMeta`)
    // degrade gracefully:
    //   - if the row had a serverCompositionId (graceful handler reads it from the
    //     parent LocalStitch decoder, not here), we land on .ready
    //   - otherwise we land on .failed("Migrate: old render flow no longer supported")
    // The fallback handling lives in `LocalStitch.init(from:)` because only the
    // parent decoder can correlate processingState with serverCompositionId.

    private enum CodingKeys: String, CodingKey {
        case type
        case progress
        case message
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .uploadingClips(let p):
            try c.encode("uploadingClips", forKey: .type)
            try c.encode(p, forKey: .progress)
        case .queued:
            try c.encode("queued", forKey: .type)
        case .renderingOnServer(let p):
            try c.encode("renderingOnServer", forKey: .type)
            if let p { try c.encode(p, forKey: .progress) }
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
        case "uploadingClips":
            let p = try c.decodeIfPresent(Double.self, forKey: .progress) ?? 0
            self = .uploadingClips(progress: p)
        case "queued":
            self = .queued
        case "renderingOnServer":
            let p = try c.decodeIfPresent(Double.self, forKey: .progress)
            self = .renderingOnServer(progress: p)
        case "ready":
            self = .ready
        case "failed":
            let m = try c.decodeIfPresent(String.self, forKey: .message) ?? "Unknown error"
            self = .failed(m)

        // Backward-compat: previous on-device-render state names. Treat them all as
        // "we can't recover from here" — these rows predate server-side rendering and
        // the actual local MP4 may not even exist on this device install. The parent
        // `LocalStitch` decoder will upgrade these to `.ready` if a serverCompositionId
        // is present (the local file made it to S3 at some point).
        case "rendering", "uploadingFinal", "awaitingTranscripts", "generatingMeta":
            self = .failed("Stitch was rendered with the previous build — please retry")

        default:
            self = .ready
        }
    }
}

/// A stitch the user kicked off. The actual render runs on the server; this row holds
/// the local placeholder + the result MP4 URL once it's downloaded.
public struct LocalStitch: Identifiable, Codable, Equatable {
    public let id: UUID
    public var title: String
    public var caption: String?
    public var layoutKey: String   // "mobile" | "landscape"
    public var durationS: Double
    public var localFilename: String
    public var createdAt: Date
    /// Set once the server-side Composition has been created (which happens before
    /// the manifest POST in the new flow). Required for the publish sheet to resolve
    /// to the right server-side composition.
    public var serverCompositionId: String?
    /// S3 URL of the server-rendered MP4 output. Populated once the render completes
    /// — useful if the local file gets evicted (re-download from S3).
    public var outputS3Url: String?
    /// Where this stitch is in the post-dispatch pipeline.
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
        outputS3Url: String? = nil,
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
        self.outputS3Url = outputS3Url
        self.processingState = processingState
    }

    // MARK: Codable — custom decoder defaults missing fields for old persisted JSON.

    private enum CodingKeys: String, CodingKey {
        case id, title, caption, layoutKey, durationS, localFilename, createdAt,
             serverCompositionId, outputS3Url, processingState
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
        self.outputS3Url = try c.decodeIfPresent(String.self, forKey: .outputS3Url)
        let decoded = try c.decodeIfPresent(ProcessingState.self, forKey: .processingState) ?? .ready

        // Backward-compat: old on-device-render entries that ProcessingState's decoder
        // downgraded to a generic "previous build" failure. If we have a server
        // composition id, the user can still publish from the server side — surface
        // the row as ready rather than red. (If the local mp4 is missing playback
        // will fail at tap time, but the row at least isn't permanently broken.)
        if case .failed = decoded, self.serverCompositionId != nil {
            self.processingState = .ready
        } else {
            self.processingState = decoded
        }
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
        try c.encodeIfPresent(outputS3Url, forKey: .outputS3Url)
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

    /// Record the S3 URL of the server-rendered MP4 output. Stored so a future
    /// install / cache-evicted run can re-download the file from S3.
    public func setOutputS3Url(id: UUID, url: String) {
        guard let idx = stitches.firstIndex(where: { $0.id == id }) else { return }
        stitches[idx].outputS3Url = url
        persist()
    }

    /// Stitches still in any pre-ready state — used by the resume-on-foreground
    /// polling loop in MyStitchesView so a user who backgrounds during render comes
    /// back to a live updating row.
    public var inFlight: [LocalStitch] {
        stitches.filter { !$0.processingState.isReady && $0.processingState.failureMessage == nil }
    }
}
