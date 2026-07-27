import Foundation
import SwiftUI

/// The in-progress draft the user is building in the Split-Frame editor.
///
/// Draft state is kept only in the view-model (no on-disk persistence — a
/// Split-Frame render is a single-shot flow: pick video, pick image, tap
/// Render, dismiss). If the user backgrounds the app mid-composition,
/// they'll get a fresh sheet on return. The list of PAST renders lives on
/// the server (`GET /api/split-frame`) so we don't lose completed work.
public struct SplitFrameDraft: Equatable {
    /// Local sandbox URL for the picked video file. `nil` while the picker's
    /// `loadFileRepresentation` copy is still in flight.
    public var videoLocalURL: URL?
    public var videoDurationS: Double

    /// Local sandbox URL for the picked image file.
    public var imageLocalURL: URL?

    /// Optional caption burned into the composed output. Bounded — the
    /// server-side compositor doesn't line-wrap, so extremely long captions
    /// clip off the edge of the canvas.
    public var caption: String

    public init(
        videoLocalURL: URL? = nil,
        videoDurationS: Double = 0,
        imageLocalURL: URL? = nil,
        caption: String = ""
    ) {
        self.videoLocalURL = videoLocalURL
        self.videoDurationS = videoDurationS
        self.imageLocalURL = imageLocalURL
        self.caption = caption
    }

    /// True when both assets have been picked (URLs may still be non-nil even
    /// if the copy is racing — that's fine, the render dispatcher awaits any
    /// pending in-flight tasks separately).
    public var isReadyToRender: Bool {
        videoLocalURL != nil && imageLocalURL != nil
    }
}

/// Payload the iOS composer sends to `POST /api/split-frame/render`. Mirrors
/// `SplitFrameManifest` in `shared/lib/split-frame/manifest.ts` — the server
/// validates the shape and returns a 400 with a `errors: [...]` list if any
/// field is wrong. If you add a field here, mirror it in the TS module.
public struct SplitFrameRenderRequest: Encodable, Equatable {
    public let videoUrl: String
    public let imageUrl: String
    public let caption: String?
    public let title: String?

    public init(
        videoUrl: String,
        imageUrl: String,
        caption: String? = nil,
        title: String? = nil
    ) {
        self.videoUrl = videoUrl
        self.imageUrl = imageUrl
        self.caption = caption
        self.title = title
    }
}

public struct SplitFrameRenderResponse: Decodable, Equatable {
    public let status: String   // "queued"
    public let compositionId: String
    public let outputId: String
    public let layout: String   // "split-frame"
}

/// Response from `POST /api/split-frame/upload-image` — the S3 URL the client
/// hands back to `POST /api/split-frame/render` inside the manifest.
public struct SplitFrameImageUploadResponse: Decodable, Equatable {
    public let imageUrl: String
    public let s3Key: String
}

// MARK: - Server-side row (list + polling shape)

public struct SplitFrameComposition: Identifiable, Decodable, Equatable {
    public let id: String
    public let title: String
    public let status: String
    public let mode: String
    public let createdAt: Date
    public let updatedAt: Date
    public let outputs: [SplitFrameOutput]

    public var latestOutput: SplitFrameOutput? {
        outputs.first
    }

    public var isReady: Bool {
        latestOutput?.status == "completed"
    }

    public var isFailed: Bool {
        latestOutput?.status == "failed" || status == "failed"
    }
}

public struct SplitFrameOutput: Decodable, Equatable {
    public let id: String
    public let layout: String
    public let status: String
    public let s3Url: String?
    public let s3Key: String?
    public let renderError: String?
    public let durationMs: Int?
    public let createdAt: Date
    public let updatedAt: Date
}
