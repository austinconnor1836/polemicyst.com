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

    public var effectiveDurationS: Double { max(0, trimEndS - trimStartS) }
    public var isFileReady: Bool { sourceURL != nil }

    public init(
        id: UUID = UUID(),
        sourceURL: URL? = nil,
        photoAssetIdentifier: String? = nil,
        durationS: Double,
        trimStartS: Double = 0,
        trimEndS: Double? = nil
    ) {
        self.id = id
        self.sourceURL = sourceURL
        self.photoAssetIdentifier = photoAssetIdentifier
        self.durationS = durationS
        self.trimStartS = trimStartS
        self.trimEndS = trimEndS ?? durationS
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

public enum StitchLayout: String, CaseIterable, Identifiable, Codable {
    case mobile     // 1080x1920 (9:16)
    case landscape  // 1920x1080 (16:9)

    public var id: String { rawValue }

    public var renderSize: CGSize {
        switch self {
        case .mobile: return CGSize(width: 1080, height: 1920)
        case .landscape: return CGSize(width: 1920, height: 1080)
        }
    }

    public var label: String {
        switch self {
        case .mobile: return "Mobile (9:16)"
        case .landscape: return "Landscape (16:9)"
        }
    }
}
