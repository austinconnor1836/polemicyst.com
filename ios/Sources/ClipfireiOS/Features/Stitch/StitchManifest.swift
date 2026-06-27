import CoreGraphics
import Foundation

/// Stitch render manifest — Swift mirror of `shared/lib/stitch/manifest.ts`.
///
/// This is the payload iOS POSTs to `/api/compositions/<id>/stitch-render`. The
/// server worker reads it back off `Composition.renderConfig` to know what
/// tracks to download, which to segment, where to position the freezeReveal
/// cutout, and what text overlays to draw.
///
/// JSON keys MUST stay byte-identical to the TS interface so the validator on
/// the server route accepts them. If you add a field, add it both here and in
/// `shared/lib/stitch/manifest.ts` in the same commit.
public struct StitchManifest: Codable, Equatable {
    public enum Style: String, Codable {
        case freeform
        case freezeReveal
    }

    public enum Layout: String, Codable {
        case mobile
        case landscape
    }

    /// 0..1 sRGB color. Matches `ManifestColor` in the TS module.
    public struct Color: Codable, Equatable {
        public let r: Double
        public let g: Double
        public let b: Double
        public let a: Double

        public init(r: Double, g: Double, b: Double, a: Double) {
            self.r = r
            self.g = g
            self.b = b
            self.a = a
        }
    }

    public struct Point: Codable, Equatable {
        public let x: Double
        public let y: Double

        public init(x: Double, y: Double) {
            self.x = x
            self.y = y
        }
    }

    public struct ClipRef: Codable, Equatable {
        public let trackId: String
        public let trimStartS: Double
        public let trimEndS: Double
        public let removeBackground: Bool

        public init(trackId: String, trimStartS: Double, trimEndS: Double, removeBackground: Bool) {
            self.trackId = trackId
            self.trimStartS = trimStartS
            self.trimEndS = trimEndS
            self.removeBackground = removeBackground
        }
    }

    public struct TextOverlayManifest: Codable, Equatable {
        public let text: String
        public let attachedToClipIndex: Int
        public let position: Point
        public let fontSize: Double
        public let textColor: Color
        public let backgroundColor: Color?

        public init(
            text: String,
            attachedToClipIndex: Int,
            position: Point,
            fontSize: Double,
            textColor: Color,
            backgroundColor: Color?
        ) {
            self.text = text
            self.attachedToClipIndex = attachedToClipIndex
            self.position = position
            self.fontSize = fontSize
            self.textColor = textColor
            self.backgroundColor = backgroundColor
        }
    }

    public struct CutoutManifest: Codable, Equatable {
        public let position: Point
        public let scale: Double

        public init(position: Point, scale: Double) {
            self.position = position
            self.scale = scale
        }
    }

    public let style: Style
    public let layout: Layout
    public let clips: [ClipRef]
    public let textOverlays: [TextOverlayManifest]
    public let cutout: CutoutManifest?
    public let title: String?

    public init(
        style: Style,
        layout: Layout,
        clips: [ClipRef],
        textOverlays: [TextOverlayManifest],
        cutout: CutoutManifest?,
        title: String?
    ) {
        self.style = style
        self.layout = layout
        self.clips = clips
        self.textOverlays = textOverlays
        self.cutout = cutout
        self.title = title
    }
}

// MARK: - CodableColor -> manifest color

extension CodableColor {
    /// Convert the persisted-on-disk `CodableColor` to the manifest's normalized 0..1 sRGB
    /// shape. `CodableColor` already stores 0..1 sRGB so this is a 1:1 field copy.
    public func toManifestColor() -> StitchManifest.Color {
        StitchManifest.Color(r: red, g: green, b: blue, a: opacity)
    }
}

// MARK: - Manifest builder

public enum StitchManifestBuilderError: Error, LocalizedError, Equatable {
    case missingTrackId(clipId: UUID)
    case freezeRevealNeedsTwoClips(actualCount: Int)
    case freezeRevealMissingCutout

    public var errorDescription: String? {
        switch self {
        case .missingTrackId(let clipId):
            return "Clip \(clipId) has not been uploaded yet (no server track id)."
        case .freezeRevealNeedsTwoClips(let count):
            return "freezeReveal requires exactly 2 clips (got \(count))."
        case .freezeRevealMissingCutout:
            return "freezeReveal requires a cutout position."
        }
    }
}

public enum StitchManifestBuilder {
    /// Build a server-bound manifest from the editor's in-memory snapshot.
    /// Throws if a clip is missing its server-side track id — the caller MUST upload
    /// every clip and have the resulting track id mapped before calling this.
    public static func build(
        snapshot: StitchTimelineSnapshot,
        trackIdForClip: [UUID: String],
        title: String?
    ) throws -> StitchManifest {
        let style: StitchManifest.Style = {
            switch snapshot.style {
            case .freeform: return .freeform
            case .freezeReveal: return .freezeReveal
            }
        }()
        let layout: StitchManifest.Layout = {
            switch snapshot.layout {
            case .mobile: return .mobile
            case .landscape: return .landscape
            }
        }()

        // freezeReveal must have exactly two clips per server contract.
        if style == .freezeReveal, snapshot.clips.count != 2 {
            throw StitchManifestBuilderError.freezeRevealNeedsTwoClips(actualCount: snapshot.clips.count)
        }

        let clips: [StitchManifest.ClipRef] = try snapshot.clips.map { clip in
            guard let trackId = trackIdForClip[clip.id], !trackId.isEmpty else {
                throw StitchManifestBuilderError.missingTrackId(clipId: clip.id)
            }
            return StitchManifest.ClipRef(
                trackId: trackId,
                trimStartS: clip.trimStartS,
                trimEndS: clip.trimEndS,
                removeBackground: clip.removeBackground
            )
        }

        // Build a clipId -> index map so text overlays carry the right server index.
        var clipIndex: [UUID: Int] = [:]
        for (i, clip) in snapshot.clips.enumerated() {
            clipIndex[clip.id] = i
        }

        let overlays: [StitchManifest.TextOverlayManifest] = snapshot.textOverlays.compactMap { overlay in
            guard let idx = clipIndex[overlay.clipId] else { return nil }
            return StitchManifest.TextOverlayManifest(
                text: overlay.text,
                attachedToClipIndex: idx,
                position: StitchManifest.Point(
                    x: Double(overlay.position.x),
                    y: Double(overlay.position.y)
                ),
                fontSize: Double(overlay.fontSize),
                textColor: overlay.textColorCodable.toManifestColor(),
                backgroundColor: overlay.backgroundColorCodable?.toManifestColor()
            )
        }

        // freezeReveal cutout. For freeform we leave it nil per the server contract
        // (the server validator only requires it on freezeReveal). The editor's
        // ensureFreezeRevealCutout() seeds a CutoutOverlay on style switch, so by
        // render-tap time there always IS one in freezeReveal mode.
        var cutout: StitchManifest.CutoutManifest? = nil
        if style == .freezeReveal {
            guard let co = snapshot.cutoutOverlay else {
                throw StitchManifestBuilderError.freezeRevealMissingCutout
            }
            cutout = StitchManifest.CutoutManifest(
                position: StitchManifest.Point(
                    x: Double(co.position.x),
                    y: Double(co.position.y)
                ),
                scale: Double(co.scale)
            )
        }

        return StitchManifest(
            style: style,
            layout: layout,
            clips: clips,
            textOverlays: overlays,
            cutout: cutout,
            title: title?.isEmpty == true ? nil : title
        )
    }
}
