import Foundation

public struct APIClient {
    public var baseURL: URL
    public var session: URLSession
    public var decoder: JSONDecoder
    public var encoder: JSONEncoder
    public var tokenStorage: TokenStorage?

    public init(baseURL: URL, session: URLSession = .shared, tokenStorage: TokenStorage? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder = JSONEncoder()
        self.tokenStorage = tokenStorage
    }

    // MARK: Auth

    public func authenticateWithGoogle(idToken: String) async throws -> MobileAuthResponse {
        try await post(path: "/api/auth/mobile/google", body: MobileGoogleAuthRequest(idToken: idToken))
    }

    public func authenticateWithApple(identityToken: String, fullName: AppleFullName?) async throws -> MobileAuthResponse {
        try await post(
            path: "/api/auth/mobile/apple",
            body: MobileAppleAuthRequest(identityToken: identityToken, fullName: fullName)
        )
    }

    // MARK: Feeds

    public func fetchFeeds() async throws -> [VideoFeed] {
        try await get(path: "/api/feeds")
    }

    public func createFeed(_ request: CreateFeedRequest) async throws -> VideoFeed {
        try await post(path: "/api/feeds", body: request)
    }

    // MARK: Feed videos

    public func fetchFeedVideos() async throws -> [FeedVideo] {
        try await get(path: "/api/feedVideos")
    }

    // MARK: Trigger clip generation

    public func triggerClip(_ request: TriggerClipRequest) async throws -> ClipJobResponse {
        try await post(path: "/api/trigger-clip", body: request)
    }

    // MARK: Clips (requires auth/session)

    public func fetchClips() async throws -> [ClipVideo] {
        try await get(path: "/api/clips")
    }

    public func deleteClip(id: String) async throws {
        var urlRequest = authorizedRequest(url: baseURL.appending(path: "/api/clips/\(id)"))
        urlRequest.httpMethod = "DELETE"
        let (_, response) = try await session.data(for: urlRequest)
        try ensureSuccess(response)
    }

    // MARK: - Internal helpers

    func authorizedRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        if let token = tokenStorage?.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    func get<T: Decodable>(path: String) async throws -> T {
        let request = authorizedRequest(url: baseURL.appending(path: path))
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response)
        return try decoder.decode(T.self, from: data)
    }

    func post<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = authorizedRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response)
        return try decoder.decode(Response.self, from: data)
    }

    private func ensureSuccess(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.statusCode(http.statusCode)
        }
    }
}

public enum APIError: Error {
    case statusCode(Int)
}
