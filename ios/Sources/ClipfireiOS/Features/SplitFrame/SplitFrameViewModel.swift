import AVFoundation
import Combine
import Foundation
import PhotosUI
import SwiftUI
import UIKit

/// Editor view-model for the Split-Frame composer. Owns the in-progress draft,
/// coordinates the two Photos picks, and dispatches the fire-and-forget render.
///
/// Mirrors the shape of `StitchEditorViewModel` but MUCH simpler — Split-Frame
/// has one video + one image + one caption, so no timeline, no track uploads,
/// no draft persistence.
@MainActor
public final class SplitFrameViewModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case loadingVideo
        case loadingImage
        case dispatching
        case dispatched(compositionId: String)
        case failed(String)

        public var isBusy: Bool {
            switch self {
            case .loadingVideo, .loadingImage, .dispatching: return true
            default: return false
            }
        }
    }

    @Published public var draft = SplitFrameDraft()
    @Published public var imagePreview: UIImage?
    @Published public var stage: Stage = .idle

    /// Fired the instant the render POST returns 202 and the editor should
    /// dismiss. Parent presenter uses this to switch tabs / navigate to the
    /// list view. Same pattern as `StitchEditorViewModel.onRenderDispatched`.
    public var onRenderDispatched: (() -> Void)?

    private let api: APIClient
    private let uploader: VideoUploadService

    public init(api: APIClient) {
        self.api = api
        self.uploader = VideoUploadService(api: api)
    }

    // MARK: - Video pick

    /// Called by `SplitFrameVideoPicker` with the raw `NSItemProvider`. Reuses
    /// `ItemProviderLoader.loadMovieFile` (defined in the Stitch feature) so
    /// we get the same "specific type first, in-place-then-copy" fallback ladder.
    public func handleVideoPicked(_ provider: NSItemProvider?) {
        guard let provider else { return }
        stage = .loadingVideo
        Task { @MainActor in
            let result = await ItemProviderLoader.loadMovieFile(provider)
            switch result {
            case .success(let url):
                let asset = AVURLAsset(url: url)
                let durationS = (try? await asset.load(.duration)).map { CMTimeGetSeconds($0) } ?? 0
                draft.videoLocalURL = url
                draft.videoDurationS = durationS
                stage = .idle
            case .failure(let error):
                stage = .failed(error.errorDescription ?? "Failed to load video")
            }
        }
    }

    // MARK: - Image pick

    public func handleImagePicked(_ provider: NSItemProvider?) {
        guard let provider else { return }
        stage = .loadingImage
        Task { @MainActor in
            let result = await SplitFrameImageLoader.loadImageFile(provider)
            switch result {
            case .success(let (url, image)):
                draft.imageLocalURL = url
                imagePreview = image
                stage = .idle
            case .failure(let error):
                stage = .failed(error.errorDescription ?? "Failed to load image")
            }
        }
    }

    // MARK: - Render dispatch

    /// Fire-and-forget: upload video + image, POST manifest, invoke
    /// `onRenderDispatched`. The rendered mp4 is NOT downloaded here — the
    /// list view polls for status and offers a "View" button when the render
    /// completes. This matches the Stitch composer's UX.
    public func render() {
        guard case .idle = stage else { return }
        guard let videoURL = draft.videoLocalURL else {
            stage = .failed("Pick a video first")
            return
        }
        guard let imageURL = draft.imageLocalURL else {
            stage = .failed("Pick an image first")
            return
        }
        let captionTrimmed = draft.caption.trimmingCharacters(in: .whitespacesAndNewlines)
        let captionForRequest = captionTrimmed.isEmpty ? nil : captionTrimmed

        stage = .dispatching
        let api = self.api
        let uploader = self.uploader

        Task { @MainActor in
            do {
                // 1. Upload the video via the shared background URLSession
                //    (`com.clipfire.uploads`). Same helper the Stitch flow uses.
                let videoUpload = try await uploader.upload(
                    fileURL: videoURL,
                    prefix: "split-frame/videos/",
                    contentType: "video/mp4",
                    deleteAfterUpload: false,
                    progress: nil
                )

                // 2. Upload the image via a small foreground multipart POST.
                //    Images are small (< 25 MB) so no multipart chunking needed.
                let imageContentType = mimeType(for: imageURL)
                let imageUpload = try await api.uploadSplitFrameImage(
                    fileURL: imageURL,
                    contentType: imageContentType
                )

                // 3. POST the render manifest.
                let response = try await api.startSplitFrameRender(
                    SplitFrameRenderRequest(
                        videoUrl: videoUpload.s3Url,
                        imageUrl: imageUpload.imageUrl,
                        caption: captionForRequest,
                        title: nil
                    )
                )

                self.stage = .dispatched(compositionId: response.compositionId)
                self.cleanupDraftFiles(videoURL: videoURL, imageURL: imageURL)
                self.onRenderDispatched?()
            } catch {
                let msg: String
                if let apiErr = error as? APIError {
                    msg = apiErr.errorDescription ?? "Render dispatch failed"
                } else {
                    msg = error.localizedDescription
                }
                self.stage = .failed(msg)
            }
        }
    }

    /// Once the render is dispatched the server has its own copies of both
    /// files. Drop the local drafts so we don't accumulate them under Documents.
    private func cleanupDraftFiles(videoURL: URL, imageURL: URL) {
        for url in [videoURL, imageURL] {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - Helpers

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "heif": return "image/heif"
        case "webp": return "image/webp"
        default: return "image/jpeg"
        }
    }
}
