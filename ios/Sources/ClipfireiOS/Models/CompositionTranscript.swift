import Foundation

// MARK: - Stitched-composition transcript helpers
//
// Swift mirror of `polemicyst.com/shared/lib/composition-transcript.ts`.
// Builds the concatenated transcript of a stitched Composition for AI
// title/caption generation.
//
// Why this exists: a Composition is a stitched video — creator clip plus N
// reference tracks, each with their own per-segment transcript. The post-render
// `CompositionOutput.transcript` field is null at the moment the iOS publish
// sheet auto-fires the AI metadata generation (client-side renders never
// populate it; server-side renders enqueue a separate transcription job that
// lands later). Passing an empty transcript to the LLM gives generic,
// content-disconnected titles + captions — the bug this module fixes.
//
// Order is creator transcript first (the spine of the stitch), then each
// reference track sorted by `sortOrder` ascending. Sources are joined with a
// blank line so the LLM sees them as distinct passages — matches the web
// helper exactly so the LLM input is identical between platforms.

/// One segment of a transcript (Whisper / YouTube caption row). Tolerant of
/// extra fields (start/end/etc) returned by the API — only `text` is used here.
public struct TranscriptSegment: Codable, Equatable {
    public let text: String?

    public init(text: String?) {
        self.text = text
    }
}

public enum CompositionTranscript {
    /// Flatten an array of `{ text }` segments into a single string of joined
    /// words. Trims each segment and drops empties so we don't produce double
    /// spaces.
    public static func flattenSegments(_ segments: [TranscriptSegment]?) -> String {
        guard let segments, !segments.isEmpty else { return "" }
        return segments
            .compactMap { $0.text?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Build the full stitched-video transcript for an AI prompt. Returns
    /// `nil` if no source has a transcript yet — callers pass `nil` so the
    /// prompt omits the transcript block entirely instead of sending an empty
    /// string.
    ///
    /// Prefers `fallback` (the rendered-output transcript, which captures the
    /// actual stitched audio mix) when truthy. Otherwise concatenates the
    /// creator + per-track transcripts in `sortOrder` ascending.
    public static func buildStitched(
        composition: Composition?,
        fallback: String? = nil
    ) -> String? {
        let fallbackTrimmed = (fallback ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !fallbackTrimmed.isEmpty { return fallbackTrimmed }

        guard let composition else { return nil }

        var parts: [String] = []

        let creator = flattenSegments(composition.creatorTranscriptJson)
        if !creator.isEmpty { parts.append(creator) }

        let sortedTracks = (composition.tracks ?? [])
            .sorted { $0.sortOrder < $1.sortOrder }

        for track in sortedTracks {
            let segText = flattenSegments(track.transcriptJson)
            if !segText.isEmpty { parts.append(segText) }
        }

        if parts.isEmpty { return nil }
        return parts.joined(separator: "\n\n")
    }
}
