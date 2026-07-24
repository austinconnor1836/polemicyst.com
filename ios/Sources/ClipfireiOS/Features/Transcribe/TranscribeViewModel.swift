import Foundation
import GoogleSignIn

/// State machine for the standalone "Transcribe" screen — paste a URL, hit
/// the button, get back plain-text captions. Reuses the same
/// `POST /api/uploads/from-url` + polling `GET /api/feedVideos/:id` backend
/// that the "Import URL" flow uses, but frames the operation as
/// "get a transcript" rather than "add a video to my library."
///
/// The server-side FeedVideo record IS preserved (there's nowhere else for
/// the transcript to hang). We just don't foreground that fact — users who
/// want to see it can navigate via the "View in Library" link below the
/// transcript.
@MainActor
public final class TranscribeViewModel: ObservableObject {
    public enum State: Equatable {
        case idle
        case loading(stage: String)
        case ready(feedVideoId: String, transcript: String)
        case failed(message: String)
    }

    @Published public var urlText: String = ""
    @Published public private(set) var state: State = .idle

    private let api: APIClient
    private var pollTask: Task<Void, Never>?

    /// Poll interval + hard timeout. Whisper on a short IG/YouTube clip
    /// generally lands in 30-90s; 3 minutes is the fall-back so the UI
    /// doesn't spin forever on a stuck job.
    private let pollIntervalSeconds: UInt64 = 3
    private let pollTimeoutSeconds: TimeInterval = 180

    public init(api: APIClient) {
        self.api = api
    }

    // Intentionally no `deinit { pollTask?.cancel() }` — touching MainActor-
    // isolated state from a non-isolated deinit trips Swift 6 concurrency
    // warnings. Poll auto-terminates on `pollTimeoutSeconds` (3 min) or when
    // the user taps "Transcribe another" / "Try again" (which calls `reset`).

    // MARK: - URL validation (mirrors AddVideoView.canImportURL / urlValidationHint)

    public var trimmedURL: String {
        urlText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var canSubmit: Bool {
        guard !trimmedURL.isEmpty, trimmedURL.lowercased().hasPrefix("http") else { return false }
        // Anything else is up to the backend to accept/reject.
        return true
    }

    public var urlValidationHint: String? {
        guard !trimmedURL.isEmpty, trimmedURL.lowercased().hasPrefix("http") else { return nil }
        if YouTubeCaptionService.isYouTubeURL(trimmedURL) { return nil }
        if InstagramURLDetector.isInstagramURL(trimmedURL) { return nil }
        return "Unrecognized URL — YouTube and Instagram Reels work best."
    }

    // MARK: - Actions

    public func submit() {
        guard canSubmit else { return }
        pollTask?.cancel()
        pollTask = nil

        let url = trimmedURL
        state = .loading(stage: "Submitting URL…")

        Task { [weak self] in
            await self?.performSubmit(url: url)
        }
    }

    public func reset() {
        pollTask?.cancel()
        pollTask = nil
        state = .idle
    }

    // MARK: - Implementation

    private func performSubmit(url: String) async {
        // Mirror AddVideoView: for YouTube URLs, fetch captions client-side
        // first (residential IP bypasses Google's data-center bot detection).
        // If we get them, the server persists them directly and no Whisper
        // job is needed — makes the transcript screen instant for YouTube.
        var transcript: String?
        var transcriptSegments: [[String: AnyCodable]]?
        var transcriptSource: String?
        var captionError: String?

        if YouTubeCaptionService.isYouTubeURL(url),
           let videoId = YouTubeCaptionService.extractVideoId(from: url) {
            state = .loading(stage: "Fetching captions…")

            var googleAccessToken: String?
            if let gidUser = GIDSignIn.sharedInstance.currentUser {
                do {
                    let refreshed = try await gidUser.refreshTokensIfNeeded()
                    googleAccessToken = refreshed.accessToken.tokenString
                } catch {
                    captionError = "token-refresh-failed: \(error.localizedDescription)"
                }
            }

            let captionService = YouTubeCaptionService()
            if let captions = await captionService.fetchCaptions(videoId: videoId, accessToken: googleAccessToken) {
                transcript = captions.transcript
                transcriptSegments = captions.segments.map { segment in
                    segment.mapValues { AnyCodable($0) }
                }
                transcriptSource = captions.source
            } else {
                captionError = captionError ?? captionService.lastError ?? "unknown"
            }
        }

        // POST /api/uploads/from-url — creates a FeedVideo, kicks off
        // async Whisper transcription if no client-side transcript was
        // supplied. Returns the FeedVideo record.
        let feedVideo: FeedVideo
        do {
            state = .loading(stage: "Submitting URL…")
            feedVideo = try await api.importVideoFromURL(
                url: url,
                transcript: transcript,
                transcriptSegments: transcriptSegments,
                transcriptSource: transcriptSource,
                captionError: captionError
            )
        } catch {
            if error is CancellationError { return }
            state = .failed(message: URLImportErrorMessage.describe(error))
            return
        }

        // Fast path — the server already has the transcript (client-side
        // YouTube captions land in the same POST response).
        if let text = feedVideo.transcript, !text.isEmpty {
            state = .ready(feedVideoId: feedVideo.id, transcript: text)
            return
        }

        // Slow path — poll until Whisper finishes.
        state = .loading(stage: "Transcribing…")
        await pollForTranscript(feedVideoId: feedVideo.id)
    }

    private func pollForTranscript(feedVideoId: String) async {
        let deadline = Date().addingTimeInterval(pollTimeoutSeconds)

        while !Task.isCancelled {
            if Date() >= deadline {
                state = .failed(message: "Transcription is taking longer than expected. Check back in your library.")
                return
            }

            try? await Task.sleep(nanoseconds: pollIntervalSeconds * 1_000_000_000)
            if Task.isCancelled { return }

            do {
                let updated = try await api.fetchFeedVideoById(id: feedVideoId)
                if let text = updated.transcript, !text.isEmpty {
                    state = .ready(feedVideoId: updated.id, transcript: text)
                    return
                }
            } catch {
                if error is CancellationError { return }
                // Transient poll failures shouldn't kill the whole flow —
                // let the next tick retry. If the video was deleted or the
                // server is truly down, the deadline will surface it.
                continue
            }
        }
    }
}
