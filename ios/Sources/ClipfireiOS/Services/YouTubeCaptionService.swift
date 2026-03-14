import Foundation

/// Fetches YouTube captions client-side using multiple methods.
/// Runs from the device's residential IP, bypassing YouTube's datacenter
/// bot detection. Does NOT use OAuth Bearer tokens — Google rejects them
/// on innertube with ACCESS_TOKEN_SCOPE_INSUFFICIENT regardless of scopes.
public final class YouTubeCaptionService {
    public struct CaptionResult {
        public let transcript: String
        public let segments: [[String: Any]]
        public let source: String // "youtube-manual" or "youtube-auto"
    }

    /// Error info for server-side debugging when all methods fail.
    public private(set) var lastError: String?

    private struct InnertubePayload: Encodable {
        let context: Context
        let videoId: String

        struct Context: Encodable {
            let client: Client
        }

        struct Client: Encodable {
            let clientName: String
            let clientVersion: String
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
    /// Tries WEB innertube, then MWEB innertube, then watch page HTML scraping.
    /// OAuth Bearer tokens are NOT used — Google rejects them on innertube.
    public func fetchCaptions(videoId: String, accessToken: String? = nil) async -> CaptionResult? {
        lastError = nil
        var errors: [String] = []

        // Method 1: WEB innertube client
        if let result = await fetchViaInnertube(videoId: videoId, clientName: "WEB", clientVersion: "2.20240313.05.00") {
            return result
        }
        errors.append("innertube-web: \(lastError ?? "unknown")")

        // Method 2: MWEB innertube client
        if let result = await fetchViaInnertube(videoId: videoId, clientName: "MWEB", clientVersion: "2.20240304.08.00") {
            return result
        }
        errors.append("innertube-mweb: \(lastError ?? "unknown")")

        // Method 3: Watch page HTML scraper
        if let result = await fetchViaWatchPage(videoId: videoId) {
            return result
        }
        errors.append("watchpage: \(lastError ?? "unknown")")

        lastError = errors.joined(separator: "; ")
        print("[YouTubeCaptions] All methods failed: \(lastError!)")
        return nil
    }

    // MARK: - Innertube Client

    private func fetchViaInnertube(videoId: String, clientName: String, clientVersion: String) async -> CaptionResult? {
        let payload = InnertubePayload(
            context: .init(client: .init(clientName: clientName, clientVersion: clientVersion)),
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

            if let playability = json["playabilityStatus"] as? [String: Any],
               let status = playability["status"] as? String, status != "OK" {
                let reason = playability["reason"] as? String ?? ""
                lastError = "\(status) \(reason)".trimmingCharacters(in: .whitespaces)
                print("[YouTubeCaptions] Innertube playability: \(lastError!)")
                return nil
            }

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

    // MARK: - Method 2: Watch Page HTML Scraper

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

            guard let playerJson = extractPlayerResponse(from: html) else {
                lastError = "no ytInitialPlayerResponse"
                print("[YouTubeCaptions] Watch page: no ytInitialPlayerResponse found")
                return nil
            }

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
        let marker = "var ytInitialPlayerResponse = "
        guard let startRange = html.range(of: marker) else { return nil }
        let jsonStart = html[startRange.upperBound...]

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
            if event["aAppend"] != nil { continue }
            guard let segs = event["segs"] as? [[String: Any]] else { continue }

            let text = segs
                .compactMap { $0["utf8"] as? String }
                .joined()
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)

            if text.isEmpty { continue }
            if text.hasPrefix("[") && text.hasSuffix("]") { continue }

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
