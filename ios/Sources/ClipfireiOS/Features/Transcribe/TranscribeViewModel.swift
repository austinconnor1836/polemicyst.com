import Foundation

/// State machine for the standalone "Transcribe" screen — paste a YouTube URL,
/// hit the button, get back plain-text captions.
///
/// FULLY ON-DEVICE: captions are fetched directly via `YouTubeCaptionService`
/// running from the phone's residential IP (which is what dodges YouTube's
/// datacenter-IP blocking). The fetched transcript is displayed straight away
/// — there is NO backend round-trip. This screen does not create a FeedVideo,
/// does not persist anything server-side, and does not depend on the monolith
/// being awake. (The "Import URL" flow in `AddVideoView` is separate and still
/// uses the backend to add a video to the user's library.)
///
/// No Whisper fallback here: if a YouTube video has no captions / auto-captions,
/// we surface that as an error rather than shipping audio off-device. Non-YouTube
/// URLs are rejected with an explanation — this screen is YouTube-captions-only.
@MainActor
public final class TranscribeViewModel: ObservableObject {
    public enum State: Equatable {
        case idle
        case loading(stage: String)
        case ready(transcript: String)
        case failed(message: String)
    }

    @Published public var urlText: String = ""
    @Published public private(set) var state: State = .idle

    private var fetchTask: Task<Void, Never>?

    public init() {}

    // Intentionally no `deinit { fetchTask?.cancel() }` — touching MainActor-
    // isolated state from a non-isolated deinit trips Swift 6 concurrency
    // warnings. The task is short-lived (a few HTTP calls) and is cancelled
    // when the user taps "Transcribe another" / "Try again" (which calls `reset`).

    // MARK: - URL validation

    public var trimmedURL: String {
        urlText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var canSubmit: Bool {
        guard !trimmedURL.isEmpty, trimmedURL.lowercased().hasPrefix("http") else { return false }
        return true
    }

    /// Soft inline hint — this screen only transcribes YouTube videos that
    /// carry captions. Non-YouTube URLs still hard-fail on submit, but the
    /// hint gives an early nudge.
    public var urlValidationHint: String? {
        guard !trimmedURL.isEmpty, trimmedURL.lowercased().hasPrefix("http") else { return nil }
        if YouTubeCaptionService.isYouTubeURL(trimmedURL) { return nil }
        return "This screen transcribes YouTube videos that have captions."
    }

    // MARK: - Actions

    public func submit() {
        guard canSubmit else { return }
        fetchTask?.cancel()
        fetchTask = nil

        let url = trimmedURL
        state = .loading(stage: "Fetching captions…")

        fetchTask = Task { [weak self] in
            await self?.performSubmit(url: url)
        }
    }

    public func reset() {
        fetchTask?.cancel()
        fetchTask = nil
        state = .idle
    }

    // MARK: - Implementation

    private func performSubmit(url: String) async {
        // This screen is YouTube-captions-only. Reject anything else up-front.
        guard YouTubeCaptionService.isYouTubeURL(url),
              let videoId = YouTubeCaptionService.extractVideoId(from: url) else {
            state = .failed(
                message: "This screen transcribes YouTube videos that have captions. Paste a YouTube video or Shorts URL."
            )
            return
        }

        // Fetch captions client-side. Running from the device's residential IP
        // bypasses YouTube's data-center bot detection — no OAuth token is used
        // (innertube rejects Bearer tokens with ACCESS_TOKEN_SCOPE_INSUFFICIENT).
        let captionService = YouTubeCaptionService()
        guard let captions = await captionService.fetchCaptions(videoId: videoId),
              !captions.transcript.isEmpty else {
            if Task.isCancelled { return }
            state = .failed(
                message: "No captions found for this video. Try one that has captions or auto-captions."
            )
            return
        }

        if Task.isCancelled { return }
        state = .ready(transcript: captions.transcript)
    }
}
