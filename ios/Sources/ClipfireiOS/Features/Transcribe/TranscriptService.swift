import Foundation

/// Client for the standalone transcript service (`TRANSCRIPT_SERVICE_URL`).
///
/// The on-device raw caption fetch (`YouTubeCaptionService`) returns empty for
/// auto-generated (ASR) captions after recent YouTube changes. This service — a
/// tiny Python `youtube-transcript-api` server — fetches transcripts from a
/// residential IP instead. In DEBUG it runs on the host Mac at
/// `http://localhost:8791`, which the simulator reaches via localhost (sharing
/// the Mac's residential IP, so YouTube's datacenter-IP blocking doesn't apply).
///
/// Deliberately NOT part of `APIClient`: it's a separate deployment gated by a
/// shared `x-render-secret` header (not the user's bearer token) and returns a
/// plain transcript with no S3 / login.
///
/// Flow: POST `{ url }` to `/transcript` → decode
/// `{ transcript, segments: [{start,duration,text}], source }`.
public struct TranscriptService {
    public struct Segment: Decodable, Equatable {
        public let start: Double
        public let duration: Double
        public let text: String
    }

    public struct Result: Decodable, Equatable {
        public let transcript: String
        public let segments: [Segment]
        public let source: String?
    }

    public enum TranscriptError: LocalizedError {
        /// Non-2xx from the service, with the server-provided message when present.
        case server(statusCode: Int, message: String?)
        /// The service returned an empty transcript.
        case empty

        public var errorDescription: String? {
            switch self {
            case .server(let statusCode, let message):
                if let message, !message.isEmpty { return message }
                if statusCode == 401 {
                    return "The transcript service rejected the request. Please update the app."
                }
                return "The transcript service is unavailable right now (HTTP \(statusCode)). Try again shortly."
            case .empty:
                return "No captions found for this video. Try one that has captions or auto-captions."
            }
        }
    }

    private struct RequestBody: Encodable {
        let url: String
    }

    private let session: URLSession
    private let endpoint: URL
    private let secret: String?
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        session: URLSession = .shared,
        baseURL: URL = AppConfiguration.transcriptServiceURL,
        secret: String? = AppConfiguration.transcriptServiceSecret
    ) {
        self.session = session
        self.endpoint = baseURL.appending(path: "transcript")
        self.secret = secret
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    /// Fetch the transcript for a YouTube URL. Throws `TranscriptError` on any
    /// non-2xx response or an empty transcript.
    public func fetch(url: String) async throws -> Result {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let secret {
            request.setValue(secret, forHTTPHeaderField: "x-render-secret")
        }
        request.httpBody = try encoder.encode(RequestBody(url: url))

        let (data, response) = try await session.data(for: request)

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw TranscriptError.server(statusCode: http.statusCode, message: Self.serverMessage(from: data))
        }

        let decoded = try decoder.decode(Result.self, from: data)
        guard !decoded.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw TranscriptError.empty
        }
        return decoded
    }

    /// Best-effort extraction of a human-readable `{ error | message }` string
    /// from a non-2xx JSON body.
    private static func serverMessage(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return (object["error"] as? String) ?? (object["message"] as? String)
    }
}
