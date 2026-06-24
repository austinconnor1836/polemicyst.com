import CoreGraphics
import Foundation
import SwiftUI
import UIKit

/// Codable wrapper for `Color` — stores sRGB components so SwiftUI Color values can be
/// persisted in the stitch draft on disk.
public struct CodableColor: Codable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double
    public let opacity: Double

    public init(_ color: Color) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        self.red = Double(r); self.green = Double(g)
        self.blue = Double(b); self.opacity = Double(a)
    }

    public var color: Color {
        Color(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }
}

public struct StitchClip: Identifiable, Equatable, Codable {
    public let id: UUID
    /// Stable sandbox file URL once `loadTransferable` has copied the video out of Photos.
    /// `nil` while the copy is still in flight. The thumbnail can render from `photoAssetIdentifier`
    /// before this is populated, so the user never sees a "Loading" cell.
    public var sourceURL: URL?
    /// Photos library local identifier used by `PHImageManager` for instant thumbnail loads.
    public var photoAssetIdentifier: String?
    public var durationS: Double
    public var trimStartS: Double
    public var trimEndS: Double
    /// Server-side `CompositionTrack` id assigned once the side-channel upload that
    /// kicks off transcription has completed. Nil while the upload is in flight (or
    /// failed silently). Used by the editor to fire `DELETE /tracks/<id>` when the
    /// user removes this clip from the stitch. Local-only — the renderer ignores it.
    public var serverTrackId: String?
    /// If true, the renderer runs `VNGeneratePersonSegmentationRequest` on this clip's
    /// frames — for a base-track clip the video plays segmented over black for its slot;
    /// for the freezeReveal creator (cutout track) the segmented person is composited
    /// over the frozen reference frame. Default false so old drafts decode unchanged.
    public var removeBackground: Bool

    public var effectiveDurationS: Double { max(0, trimEndS - trimStartS) }
    public var isFileReady: Bool { sourceURL != nil }

    public init(
        id: UUID = UUID(),
        sourceURL: URL? = nil,
        photoAssetIdentifier: String? = nil,
        durationS: Double,
        trimStartS: Double = 0,
        trimEndS: Double? = nil,
        serverTrackId: String? = nil,
        removeBackground: Bool = false
    ) {
        self.id = id
        self.sourceURL = sourceURL
        self.photoAssetIdentifier = photoAssetIdentifier
        self.durationS = durationS
        self.trimStartS = trimStartS
        self.trimEndS = trimEndS ?? durationS
        self.serverTrackId = serverTrackId
        self.removeBackground = removeBackground
    }

    // Custom Decodable so drafts written before `removeBackground` existed still decode
    // — the field defaults to false. Encode stays synthesized.
    private enum CodingKeys: String, CodingKey {
        case id, sourceURL, photoAssetIdentifier, durationS, trimStartS, trimEndS, serverTrackId, removeBackground
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(UUID.self, forKey: .id)
        self.sourceURL = try c.decodeIfPresent(URL.self, forKey: .sourceURL)
        self.photoAssetIdentifier = try c.decodeIfPresent(String.self, forKey: .photoAssetIdentifier)
        self.durationS = try c.decode(Double.self, forKey: .durationS)
        self.trimStartS = try c.decode(Double.self, forKey: .trimStartS)
        self.trimEndS = try c.decode(Double.self, forKey: .trimEndS)
        self.serverTrackId = try c.decodeIfPresent(String.self, forKey: .serverTrackId)
        self.removeBackground = try c.decodeIfPresent(Bool.self, forKey: .removeBackground) ?? false
    }
}

public struct TextOverlay: Identifiable, Equatable, Codable {
    public let id: UUID
    /// The clip this overlay is attached to. Overlay appears for the full duration of that clip.
    public var clipId: UUID
    public var text: String
    public var backgroundColorCodable: CodableColor?
    public var textColorCodable: CodableColor
    public var fontSize: CGFloat
    public var position: CGPoint   // normalized 0..1 in render canvas

    public var hasBackground: Bool { backgroundColorCodable != nil }

    public var backgroundColor: Color? {
        get { backgroundColorCodable?.color }
        set { backgroundColorCodable = newValue.map(CodableColor.init) }
    }

    public var textColor: Color {
        get { textColorCodable.color }
        set { textColorCodable = CodableColor(newValue) }
    }

    public init(
        id: UUID = UUID(),
        clipId: UUID,
        text: String,
        backgroundColor: Color? = nil,
        textColor: Color = .white,
        fontSize: CGFloat = 48,
        position: CGPoint = CGPoint(x: 0.5, y: 0.85)
    ) {
        self.id = id
        self.clipId = clipId
        self.text = text
        self.backgroundColorCodable = backgroundColor.map(CodableColor.init)
        self.textColorCodable = CodableColor(textColor)
        self.fontSize = fontSize
        self.position = position
    }
}

public struct CutoutOverlay: Identifiable, Equatable, Codable {
    public let id: UUID
    /// The clip this cutout is laid over. Cutout appears for the duration of that clip.
    public var clipId: UUID
    public var sourceURL: URL
    public var sourceDurationS: Double
    public var position: CGPoint   // normalized 0..1 — center of the cutout in the render canvas
    public var scale: CGFloat      // 0..1 — fraction of render height

    public init(
        id: UUID = UUID(),
        clipId: UUID,
        sourceURL: URL,
        sourceDurationS: Double,
        position: CGPoint = CGPoint(x: 0.5, y: 0.5),
        scale: CGFloat = 0.6
    ) {
        self.id = id
        self.clipId = clipId
        self.sourceURL = sourceURL
        self.sourceDurationS = sourceDurationS
        self.position = position
        self.scale = scale
    }
}

/// Composition style. `freeform` (default) is the original "concatenate N clips with
/// optional per-clip text + one segmented cutout overlay" flow. `freezeReveal` is a
/// preset: clip 1 plays through, its last frame freezes, and clip 2 plays segmented
/// (background-removed) over that frozen frame.
public enum StitchStyle: String, CaseIterable, Identifiable, Codable {
    case freeform
    case freezeReveal

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .freeform: return "Freeform"
        case .freezeReveal: return "Freeze + Reveal"
        }
    }

    public var summary: String {
        switch self {
        case .freeform:
            return "Stack clips in order with optional text and one cutout overlay."
        case .freezeReveal:
            return "Reference plays, its last frame freezes, then your creator video appears over it with the background removed."
        }
    }

    /// Maximum number of base-track clips the style supports.
    public var maxClips: Int {
        switch self {
        case .freeform: return Int.max
        case .freezeReveal: return 2
        }
    }
}

public enum StitchLayout: String, CaseIterable, Identifiable, Codable {
    case mobile     // 1080x1920 (9:16)
    case landscape  // 1920x1080 (16:9)

    public var id: String { rawValue }

    public var renderSize: CGSize {
        // 720p — full 1080×1920 + custom compositor + Vision per-frame + HEVC over
        // long (90s+) renders thermal-throttled the iPhone 14 encoder and iOS killed
        // the app silently. 720p portrait still looks sharp on the phone, and the
        // encoder has 2.25× more headroom. Bump back up once we move per-frame Vision
        // off the export's critical path.
        switch self {
        case .mobile: return CGSize(width: 720, height: 1280)
        case .landscape: return CGSize(width: 1280, height: 720)
        }
    }

    public var label: String {
        switch self {
        case .mobile: return "Mobile (9:16)"
        case .landscape: return "Landscape (16:9)"
        }
    }
}
