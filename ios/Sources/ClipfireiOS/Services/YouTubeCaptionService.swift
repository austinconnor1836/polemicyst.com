import Foundation
import GoogleSignIn

/// Fetches YouTube captions client-side using the innertube player API.
/// When a Google OAuth token is available, sends an authenticated request
/// for reliable access. Falls back to unauthenticated WEB client otherwise.
public final class YouTubeCaptionService {
    public struct CaptionResult {
        public let transcript: String
        public let segments: [[String: Any]]
        public let source: String // "youtube-manual" or "youtube-auto"
    }

    /// Full innertube player response metadata (available after authenticated fetch).
    public struct PlayerInfo {
        public let videoTitle: String?
        public let lengthSeconds: Int?
        public let streamingUrl: String?
        public let captionResult: CaptionResult?
    }

    private struct InnertubePayload: Encodable {
        let context: Context
        let videoId: String
        let contentCheckOk: Bool?
        let racyCheckOk: Bool?

        struct Context: Encodable {
            let client: Client
        }

        struct Client: Encodable {
            let clientName: String
            let clientVersion: String
            let hl: String
            let gl: String
            let deviceMake: String?
            let deviceModel: String?
            let osName: String?
            let osVersion: String?
        }
    }

    public init() {}

    /// Extract YouTube video ID from a URL.
    public static func extractVideoId(from url: String) -> String? {
        let patterns = [
            #"(?:youtube\.com/watch\?.*v=)([a-zA-Z0-9_-]{11})"#,
            #"(?:youtu\.be/)([a-zA-Z0-9_-]{11})"#,
            #"(?:youtube\.com/embed/)([a-zA-Z0-9_-]{11})"#,
        ]
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern),
               let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)),
               let range = Range(match.range(at: 1), in: url) {
                return String(url[range])
            }
        }
        return nil
    }

    /// Check if a URL is a YouTube URL.
    public static func isYouTubeURL(_ url: String) -> Bool {
        url.contains("youtube.com") || url.contains("youtu.be")
    }

    /// Get the current Google access token from the GIDSignIn session.
    public static func getGoogleAccessToken() async -> String? {
        guard let currentUser = GIDSignIn.sharedInstance.currentUser else { return nil }
        do {
            try await currentUser.refreshTokensIfNeeded()
            return currentUser.accessToken.tokenString
        } catch {
            print("[YouTubeCaptions] Failed to refresh Google token: \(error)")
            return nil
        }
    }

    /// Fetch captions using an authenticated innertube request.
    /// Uses the Google OAuth access token for reliable, bot-detection-free access.
    public func fetchCaptionsAuthenticated(videoId: String, accessToken: String) async -> CaptionResult? {
        let payload = InnertubePayload(
            context: .init(client: .init(
                clientName: "IOS",
                clientVersion: "19.45.4",
                hl: "en",
                gl: "US",
                deviceMake: "Apple",
                deviceModel: "iPhone16,2",
                osName: "iOS",
                osVersion: "18.1.0.22B83"
            )),
            videoId: videoId,
            contentCheckOk: true,
            racyCheckOk: true
        )

        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(
            "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            forHTTPHeaderField: "User-Agent"
        )

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                print("[YouTubeCaptions] Authenticated innertube returned non-200")
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                print("[YouTubeCaptions] Failed to parse authenticated innertube response")
                return nil
            }

            if let playability = json["playabilityStatus"] as? [String: Any],
               let status = playability["status"] as? String, status != "OK" {
                print("[YouTubeCaptions] Auth playability: \(status)")
                return nil
            }

            guard let captions = json["captions"] as? [String: Any],
                  let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
                  let tracks = renderer["captionTracks"] as? [[String: Any]],
                  !tracks.isEmpty else {
                print("[YouTubeCaptions] Auth: no caption tracks found")
                return nil
            }

            return await extractCaptions(from: tracks, videoId: videoId)
        } catch {
            print("[YouTubeCaptions] Auth error: \(error)")
            return nil
        }
    }

    /// Fetch captions for a YouTube video.
    /// Tries authenticated innertube first if a Google session exists, then falls back
    /// to unauthenticated WEB client.
    public func fetchCaptions(videoId: String) async -> CaptionResult? {
        // Try authenticated request first
        if let accessToken = await Self.getGoogleAccessToken() {
            print("[YouTubeCaptions] Trying authenticated innertube...")
            if let result = await fetchCaptionsAuthenticated(videoId: videoId, accessToken: accessToken) {
                return result
            }
            print("[YouTubeCaptions] Authenticated innertube failed, trying unauthenticated...")
        }

        return await fetchCaptionsUnauthenticated(videoId: videoId)
    }

    /// Unauthenticated innertube fetch (original WEB client approach).
    private func fetchCaptionsUnauthenticated(videoId: String) async -> CaptionResult? {
        let payload = InnertubePayload(
            context: .init(client: .init(
                clientName: "WEB",
                clientVersion: "2.20240313.05.00",
                hl: "en",
                gl: "US",
                deviceMake: nil,
                deviceModel: nil,
                osName: nil,
                osVersion: nil
            )),
            videoId: videoId,
            contentCheckOk: nil,
            racyCheckOk: nil
        )

        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent"
        )

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                print("[YouTubeCaptions] Innertube API returned non-200")
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                print("[YouTubeCaptions] Failed to parse innertube response")
                return nil
            }

            if let playability = json["playabilityStatus"] as? [String: Any],
               let status = playability["status"] as? String, status != "OK" {
                print("[YouTubeCaptions] Playability: \(status)")
                return nil
            }

            guard let captions = json["captions"] as? [String: Any],
                  let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
                  let tracks = renderer["captionTracks"] as? [[String: Any]],
                  !tracks.isEmpty else {
                print("[YouTubeCaptions] No caption tracks found")
                return nil
            }

            return await extractCaptions(from: tracks, videoId: videoId)
        } catch {
            print("[YouTubeCaptions] Error: \(error)")
            return nil
        }
    }

    private func extractCaptions(from tracks: [[String: Any]], videoId: String) async -> CaptionResult? {
        // Find best English track: manual > auto > any en variant
        let manualTrack = tracks.first { ($0["languageCode"] as? String) == "en" && ($0["kind"] as? String) != "asr" }
        let autoTrack = tracks.first { ($0["languageCode"] as? String) == "en" && ($0["kind"] as? String) == "asr" }
        let enVariant = tracks.first { ($0["languageCode"] as? String)?.hasPrefix("en") == true }

        let selectedTrack: [String: Any]
        let source: String
        if let t = manualTrack {
            selectedTrack = t
            source = "youtube-manual"
        } else if let t = autoTrack {
            selectedTrack = t
            source = "youtube-auto"
        } else if let t = enVariant {
            selectedTrack = t
            source = (t["kind"] as? String) == "asr" ? "youtube-auto" : "youtube-manual"
        } else {
            print("[YouTubeCaptions] No English track found")
            return nil
        }

        guard let baseUrl = selectedTrack["baseUrl"] as? String else {
            print("[YouTubeCaptions] No baseUrl in track")
            return nil
        }

        // Fetch caption data in json3 format
        let captionUrl = baseUrl + "&fmt=json3"
        guard let url = URL(string: captionUrl) else { return nil }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                print("[YouTubeCaptions] Caption fetch failed")
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let events = json["events"] as? [[String: Any]] else {
                print("[YouTubeCaptions] Failed to parse caption JSON")
                return nil
            }

            let segments = parseJson3Events(events)
            guard !segments.isEmpty else {
                print("[YouTubeCaptions] No segments parsed")
                return nil
            }

            let transcript = segments.compactMap { $0["text"] as? String }.joined(separator: " ")
            print("[YouTubeCaptions] Fetched \(segments.count) \(source) segments for \(videoId)")

            return CaptionResult(transcript: transcript, segments: segments, source: source)
        } catch {
            print("[YouTubeCaptions] Caption fetch error: \(error)")
            return nil
        }
    }

    private func parseJson3Events(_ events: [[String: Any]]) -> [[String: Any]] {
        var segments: [[String: Any]] = []

        for event in events {
            // Skip append events
            if event["aAppend"] != nil { continue }
            guard let segs = event["segs"] as? [[String: Any]] else { continue }

            let text = segs
                .compactMap { $0["utf8"] as? String }
                .joined()
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)

            // Skip empty or [Music] style markers
            if text.isEmpty { continue }
            if text.hasPrefix("[") && text.hasSuffix("]") { continue }

            guard let tStartMs = event["tStartMs"] as? Double else { continue }
            let startSec = tStartMs / 1000.0
            let endSec: Double
            if let dDurationMs = event["dDurationMs"] as? Double {
                endSec = (tStartMs + dDurationMs) / 1000.0
            } else {
                endSec = startSec + 5.0
            }

            segments.append([
                "start": startSec,
                "end": endSec,
                "text": text,
            ])
        }

        return segments
    }
}
