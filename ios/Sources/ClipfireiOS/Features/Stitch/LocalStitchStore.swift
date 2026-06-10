import Foundation
import SwiftUI

/// A stitch that has been rendered on-device and saved to the app's Documents directory.
/// The local file is the source of truth for the user; S3 upload state is invisible to them.
public struct LocalStitch: Identifiable, Codable, Equatable {
    public let id: UUID
    public var title: String
    public var layoutKey: String   // "mobile" | "landscape"
    public var durationS: Double
    public var localFilename: String
    public var createdAt: Date
    /// Set once the silent background upload + composition creation completes.
    /// The user never sees this — it's only used so that taking other actions (publish, share)
    /// can quietly resolve to the server-side composition.
    public var serverCompositionId: String?

    public init(
        id: UUID = UUID(),
        title: String,
        layoutKey: String,
        durationS: Double,
        localFilename: String,
        createdAt: Date = Date(),
        serverCompositionId: String? = nil
    ) {
        self.id = id
        self.title = title
        self.layoutKey = layoutKey
        self.durationS = durationS
        self.localFilename = localFilename
        self.createdAt = createdAt
        self.serverCompositionId = serverCompositionId
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

    /// Stitches that haven't yet been uploaded to S3 — used by the silent retry loop on app launch.
    public var pendingUploads: [LocalStitch] {
        stitches.filter { $0.serverCompositionId == nil }
    }
}
