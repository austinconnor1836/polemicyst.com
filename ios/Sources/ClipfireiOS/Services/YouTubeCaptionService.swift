import Foundation

/// Fetches YouTube captions client-side using multiple methods.
/// This runs from the user's device (residential IP), bypassing YouTube's
/// datacenter IP bot detection that blocks server-side fetching.
public final class YouTubeCaptionService {
    public struct CaptionResult {
        public let transcript: String
        public let segments: [[String: Any]]
        public let source: String // "youtube-manual" or "youtube-auto"
    }

    /// Error info for server-side debugging when all methods fail.
    public private(set) var lastError: String?

    // Authenticated IOS client payload (used with OAuth Bearer token)
    private struct AuthInnertubePayload: Encodable {
        let context: Context
        let videoId: String
        let contentCheckOk = true
        let racyCheckOk = true

        struct Context: Encodable {
            let client: Client
        }

        struct Client: Encodable {
            let clientName = "IOS"
            let clientVersion = "19.45.4"
            let deviceMake = "Apple"
            let deviceModel = "iPhone16,2"
            let hl = "en"
            let gl = "US"
            let osName = "iOS"
            let osVersion = "18.1.0.22B83"
        }
    }

    // Unauthenticated MWEB client payload (fallback)
    private struct MwebInnertubePayload: Encodable {
        let context: Context
        let videoId: String

        struct Context: Encodable {
            let client: Client
        }

        struct Client: Encodable {
            let clientName = "MWEB"
            let clientVersion = "2.20260101.01.00"
            let hl = "en"
            let gl = "US"
        }
    }

    public init() {}

    /// Extract YouTube video ID from a URL.
    public static func extractVideoId(from url: String) -> String? {
        let patterns = [
            #"(?:youtube\.com/watch\?.*v=)([a-zA-Z0-9_-]{11})"#,
            #"(?:youtu\.be/)([a-zA-Z0-9_-]{11})"#,
            #"(?:youtube\.com/embed/)([a-zA-Z0-9_-]{11})"#,
            #"(?:youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"#,
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

    /// Fetch captions for a YouTube video.
    /// Tries authenticated innertube (if accessToken provided), then unauthenticated innertube,
    /// then falls back to scraping the watch page HTML.
    public func fetchCaptions(videoId: String, accessToken: String? = nil) async -> CaptionResult? {
        lastError = nil
        var errors: [String] = []

        // Method 1: Authenticated innertube (IOS client + OAuth Bearer token)
        if let token = accessToken {
            if let result = await fetchViaInnertubeAuth(videoId: videoId, accessToken: token) {
                return result
            }
            errors.append("innertube-auth: \(lastError ?? "unknown")")
        }

        // Method 2: Unauthenticated innertube (MWEB client)
        if let result = await fetchViaInnertube(videoId: videoId) {
            return result
        }
        errors.append("innertube: \(lastError ?? "unknown")")

        // Method 3: Watch page HTML scraper
        if let result = await fetchViaWatchPage(videoId: videoId) {
            return result
        }
        errors.append("watchpage: \(lastError ?? "unknown")")

        lastError = errors.joined(separator: "; ")
        print("[YouTubeCaptions] All methods failed: \(lastError!)")
        return nil
    }

    // MARK: - Method 1: Authenticated Innertube (IOS client + Bearer token)

    private func fetchViaInnertubeAuth(videoId: String, accessToken: String) async -> CaptionResult? {
        let payload = AuthInnertubePayload(
            context: .init(client: .init()),
            videoId: videoId
        )

        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else {
            lastError = "bad URL"
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
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                lastError = "HTTP \(code)"
                print("[YouTubeCaptions] Auth innertube returned HTTP \(code)")
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                lastError = "parse failed"
                print("[YouTubeCaptions] Failed to parse auth innertube response")
                return nil
            }

            // Check playability
            if let playability = json["playabilityStatus"] as? [String: Any],
               let status = playability["status"] as? String, status != "OK" {
                let reason = playability["reason"] as? String ?? ""
                lastError = "\(status) \(reason)".trimmingCharacters(in: .whitespaces)
                print("[YouTubeCaptions] Auth innertube playability: \(lastError!)")
                return nil
            }

            // Extract caption tracks
            guard let captions = json["captions"] as? [String: Any],
                  let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
                  let tracks = renderer["captionTracks"] as? [[String: Any]],
                  !tracks.isEmpty else {
                lastError = "no caption tracks"
                print("[YouTubeCaptions] Auth innertube: no caption tracks found")
                return nil
            }

            print("[YouTubeCaptions] Auth innertube succeeded for \(videoId)")
            return await fetchCaptionData(from: tracks, videoId: videoId)
        } catch {
            lastError = error.localizedDescription
            print("[YouTubeCaptions] Auth innertube error: \(error)")
            return nil
        }
    }

    // MARK: - Method 2: Unauthenticated Innertube (MWEB)

    private func fetchViaInnertube(videoId: String) async -> CaptionResult? {
        let payload = MwebInnertubePayload(
            context: .init(client: .init()),
            videoId: videoId
        )

        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else {
            lastError = "bad URL"
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent"
        )

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                lastError = "HTTP \(code)"
                print("[YouTubeCaptions] Innertube returned HTTP \(code)")
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                lastError = "parse failed"
                print("[YouTubeCaptions] Failed to parse innertube response")
                return nil
            }

            // Check playability
            if let playability = json["playabilityStatus"] as? [String: Any],
               let status = playability["status"] as? String, status != "OK" {
                let reason = playability["reason"] as? String ?? ""
                lastError = "\(status) \(reason)".trimmingCharacters(in: .whitespaces)
                print("[YouTubeCaptions] Innertube playability: \(lastError!)")
                return nil
            }

            // Extract caption tracks
            guard let captions = json["captions"] as? [String: Any],
                  let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
                  let tracks = renderer["captionTracks"] as? [[String: Any]],
                  !tracks.isEmpty else {
                lastError = "no caption tracks"
                print("[YouTubeCaptions] Innertube: no caption tracks found")
                return nil
            }

            return await fetchCaptionData(from: tracks, videoId: videoId)
        } catch {
            lastError = error.localizedDescription
            print("[YouTubeCaptions] Innertube error: \(error)")
            return nil
        }
    }

    // MARK: - Method 3: Watch Page HTML Scraper

    private func fetchViaWatchPage(videoId: String) async -> CaptionResult? {
        guard let url = URL(string: "https://www.youtube.com/watch?v=\(videoId)&hl=en") else {
            lastError = "bad URL"
            return nil
        }

        var request = URLRequest(url: url)
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            forHTTPHeaderField: "User-Agent"
        )
        request.setValue("en", forHTTPHeaderField: "Accept-Language")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                lastError = "HTTP \(code)"
                print("[YouTubeCaptions] Watch page returned HTTP \(code)")
                return nil
            }

            guard let html = String(data: data, encoding: .utf8) else {
                lastError = "encoding failed"
                return nil
            }

            // Extract ytInitialPlayerResponse JSON from HTML
            guard let playerJson = extractPlayerResponse(from: html) else {
                lastError = "no ytInitialPlayerResponse"
                print("[YouTubeCaptions] Watch page: no ytInitialPlayerResponse found")
                return nil
            }

            // Extract caption tracks
            guard let captions = playerJson["captions"] as? [String: Any],
                  let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
                  let tracks = renderer["captionTracks"] as? [[String: Any]],
                  !tracks.isEmpty else {
                lastError = "no caption tracks in page"
                print("[YouTubeCaptions] Watch page: no caption tracks")
                return nil
            }

            return await fetchCaptionData(from: tracks, videoId: videoId)
        } catch {
            lastError = error.localizedDescription
            print("[YouTubeCaptions] Watch page error: \(error)")
            return nil
        }
    }

    private func extractPlayerResponse(from html: String) -> [String: Any]? {
        // Look for: var ytInitialPlayerResponse = {...};
        let marker = "var ytInitialPlayerResponse = "
        guard let startRange = html.range(of: marker) else { return nil }
        let jsonStart = html[startRange.upperBound...]

        // Find the matching closing brace
        var depth = 0
        var endIndex = jsonStart.startIndex
        for (i, char) in jsonStart.enumerated() {
            if char == "{" { depth += 1 }
            else if char == "}" { depth -= 1 }
            if depth == 0 {
                endIndex = jsonStart.index(jsonStart.startIndex, offsetBy: i + 1)
                break
            }
        }

        guard depth == 0 else { return nil }
        let jsonString = String(jsonStart[jsonStart.startIndex..<endIndex])
        guard let data = jsonString.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return obj
    }

    // MARK: - Shared Caption Fetching

    private func fetchCaptionData(from tracks: [[String: Any]], videoId: String) async -> CaptionResult? {
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
            lastError = "no English track"
            print("[YouTubeCaptions] No English caption track found")
            return nil
        }

        guard let baseUrl = selectedTrack["baseUrl"] as? String else {
            lastError = "no baseUrl in track"
            print("[YouTubeCaptions] No baseUrl in selected track")
            return nil
        }

        // Fetch caption data in json3 format
        let captionUrl = baseUrl + "&fmt=json3"
        guard let url = URL(string: captionUrl) else {
            lastError = "bad caption URL"
            return nil
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                lastError = "caption fetch HTTP \(code)"
                print("[YouTubeCaptions] Caption data fetch returned HTTP \(code)")
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let events = json["events"] as? [[String: Any]] else {
                lastError = "caption JSON parse failed"
                print("[YouTubeCaptions] Failed to parse caption JSON3 data")
                return nil
            }

            let segments = parseJson3Events(events)
            guard !segments.isEmpty else {
                lastError = "no segments parsed"
                print("[YouTubeCaptions] No segments parsed from events")
                return nil
            }

            let transcript = segments.compactMap { $0["text"] as? String }.joined(separator: " ")
            print("[YouTubeCaptions] Success: \(segments.count) \(source) segments for \(videoId)")

            return CaptionResult(transcript: transcript, segments: segments, source: source)
        } catch {
            lastError = "caption fetch: \(error.localizedDescription)"
            print("[YouTubeCaptions] Caption data fetch error: \(error)")
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

            // tStartMs can be Int or Double depending on YouTube's response
            let tStartMs: Double
            if let d = event["tStartMs"] as? Double {
                tStartMs = d
            } else if let i = event["tStartMs"] as? Int {
                tStartMs = Double(i)
            } else {
                continue
            }

            let startSec = tStartMs / 1000.0
            let endSec: Double
            if let d = event["dDurationMs"] as? Double {
                endSec = (tStartMs + d) / 1000.0
            } else if let i = event["dDurationMs"] as? Int {
                endSec = (tStartMs + Double(i)) / 1000.0
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
