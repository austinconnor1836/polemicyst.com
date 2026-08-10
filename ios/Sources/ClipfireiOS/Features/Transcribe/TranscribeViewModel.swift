import Foundation

/// State machine for the standalone "Transcribe" screen — paste a YouTube URL,
/// hit the button, get back plain-text captions.
///
/// Captions are fetched via the standalone `TranscriptService`
/// (`TRANSCRIPT_SERVICE_URL`), a tiny Python `youtube-transcript-api` server.
/// The on-device raw fetch (`YouTubeCaptionService`) returns empty for
/// auto-generated (ASR) captions after recent YouTube changes; the service
/// fetches them from a residential IP instead (in DEBUG the host Mac via
/// localhost — the simulator shares the Mac's network, so YouTube's
/// datacenter-IP blocking doesn't apply). The transcript is displayed straight
/// away. This screen does not create a FeedVideo, does not persist anything
/// server-side, and does not depend on the monolith being awake. (The "Import
/// URL" flow in `AddVideoView` is separate and still uses the backend to add a
/// video to the user's library.)
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
    private let transcriptService: TranscriptService

    public init(transcriptService: TranscriptService = TranscriptService()) {
        self.transcriptService = transcriptService
    }

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
              YouTubeCaptionService.extractVideoId(from: url) != nil else {
            state = .failed(
                message: "This screen transcribes YouTube videos that have captions. Paste a YouTube video or Shorts URL."
            )
            return
        }

        // Fetch via the standalone transcript service. It runs the
        // `youtube-transcript-api` library from a residential IP (in DEBUG the
        // host Mac via localhost), which returns auto-generated captions the
        // on-device raw fetch can no longer retrieve.
        do {
            let result = try await transcriptService.fetch(url: url)
            if Task.isCancelled { return }
            state = .ready(transcript: result.transcript)
        } catch {
            if Task.isCancelled { return }
            let message = (error as? LocalizedError)?.errorDescription
                ?? "Couldn't fetch the transcript. Check your connection and try again."
            state = .failed(message: message)
        }
    }
}
