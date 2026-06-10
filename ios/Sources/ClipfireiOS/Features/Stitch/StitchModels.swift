import CoreGraphics
import Foundation
import SwiftUI

public struct StitchClip: Identifiable, Equatable {
    public let id: UUID
    public var sourceURL: URL
    public var durationS: Double
    public var trimStartS: Double
    public var trimEndS: Double

    public var effectiveDurationS: Double { max(0, trimEndS - trimStartS) }

    public init(
        id: UUID = UUID(),
        sourceURL: URL,
        durationS: Double,
        trimStartS: Double = 0,
        trimEndS: Double? = nil
    ) {
        self.id = id
        self.sourceURL = sourceURL
        self.durationS = durationS
        self.trimStartS = trimStartS
        self.trimEndS = trimEndS ?? durationS
    }
}

public struct TextOverlay: Identifiable, Equatable {
    public let id: UUID
    public var text: String
    public var backgroundColor: Color?
    public var textColor: Color
    public var fontSize: CGFloat
    public var position: CGPoint   // normalized 0..1 in render canvas
    public var startS: Double      // seconds into final stitch timeline
    public var endS: Double

    public var hasBackground: Bool { backgroundColor != nil }
    public var durationS: Double { max(0, endS - startS) }

    public init(
        id: UUID = UUID(),
        text: String,
        backgroundColor: Color? = nil,
        textColor: Color = .white,
        fontSize: CGFloat = 48,
        position: CGPoint = CGPoint(x: 0.5, y: 0.85),
        startS: Double,
        endS: Double
    ) {
        self.id = id
        self.text = text
        self.backgroundColor = backgroundColor
        self.textColor = textColor
        self.fontSize = fontSize
        self.position = position
        self.startS = startS
        self.endS = endS
    }
}

public struct CutoutOverlay: Identifiable, Equatable {
    public let id: UUID
    public var sourceURL: URL
    public var sourceDurationS: Double
    public var startS: Double      // seconds into final stitch timeline (when to begin showing cutout)
    public var endS: Double        // seconds into final stitch timeline (when to stop)
    public var position: CGPoint   // normalized 0..1 — center of the cutout in the render canvas
    public var scale: CGFloat      // 0..1 — fraction of render height

    public var durationS: Double { max(0, endS - startS) }

    public init(
        id: UUID = UUID(),
        sourceURL: URL,
        sourceDurationS: Double,
        startS: Double,
        endS: Double,
        position: CGPoint = CGPoint(x: 0.5, y: 0.5),
        scale: CGFloat = 0.6
    ) {
        self.id = id
        self.sourceURL = sourceURL
        self.sourceDurationS = sourceDurationS
        self.startS = startS
        self.endS = endS
        self.position = position
        self.scale = scale
    }
}

public enum StitchLayout: String, CaseIterable, Identifiable {
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
