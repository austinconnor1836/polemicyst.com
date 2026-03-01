import Foundation

public struct APIClient {
    public var baseURL: URL
    public var session: URLSession
    public var decoder: JSONDecoder
    public var encoder: JSONEncoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder = JSONEncoder()
    }

    // MARK: Feeds

    public func fetchFeeds() async throws -> [VideoFeed] {
        try await get(path: "/api/feeds")
    }

    public func createFeed(_ request: CreateFeedRequest) async throws -> VideoFeed {
        try await post(path: "/api/feeds", body: request)
    }

    public func updateFeed(id: String, body: [String: AnyCodable]) async throws -> VideoFeed {
        try await patch(path: "/api/feeds/\(id)", body: body)
    }

    public func deleteFeed(id: String) async throws {
        try await delete(path: "/api/feeds/\(id)")
    }

    // MARK: Feed videos

    public func fetchFeedVideos() async throws -> [FeedVideo] {
        try await get(path: "/api/feedVideos")
    }

    // MARK: Trigger clip generation

    public func triggerClip(_ request: TriggerClipRequest) async throws -> ClipJobResponse {
        try await post(path: "/api/trigger-clip", body: request)
    }

    // MARK: Clips

    public func fetchClips() async throws -> [ClipVideo] {
        try await get(path: "/api/clips")
    }

    public func deleteClip(id: String) async throws {
        try await delete(path: "/api/clips/\(id)")
    }

    // MARK: Subscription

    public func fetchSubscription() async throws -> SubscriptionResponse {
        try await get(path: "/api/user/subscription")
    }

    // MARK: LLM Provider

    public func fetchLLMProvider() async throws -> LLMProviderResponse {
        try await get(path: "/api/user/llm-provider")
    }

    public func updateLLMProvider(_ request: UpdateLLMProviderRequest) async throws -> LLMProviderResponse {
        try await put(path: "/api/user/llm-provider", body: request)
    }

    // MARK: - Internal helpers

    private func get<T: Decodable>(path: String) async throws -> T {
        let (data, response) = try await session.data(from: baseURL.appending(path: path))
        try ensureSuccess(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private func post<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func put<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func patch<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func delete(path: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "DELETE"
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
    }

    private func ensureSuccess(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            if let errorBody = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.serverError(
                    statusCode: http.statusCode,
                    response: errorBody
                )
            }
            throw APIError.statusCode(http.statusCode)
        }
    }
}

public enum APIError: Error, LocalizedError {
    case statusCode(Int)
    case serverError(statusCode: Int, response: APIErrorResponse)

    public var errorDescription: String? {
        switch self {
        case .statusCode(let code):
            return "Request failed (HTTP \(code))"
        case .serverError(_, let response):
            return response.error
        }
    }

    public var isUpgradeRequired: Bool {
        guard case .serverError(let statusCode, let response) = self else { return false }
        return statusCode == 403 && (response.code == "QUOTA_EXCEEDED" || response.code == "PLAN_RESTRICTED")
    }

    public var errorCode: String? {
        guard case .serverError(_, let response) = self else { return nil }
        return response.code
    }

    public var quotaLimit: Int? {
        guard case .serverError(_, let response) = self else { return nil }
        return response.limit
    }

    public var quotaUsage: Int? {
        guard case .serverError(_, let response) = self else { return nil }
        return response.usage
    }

    public var allowedProviders: [String]? {
        guard case .serverError(_, let response) = self else { return nil }
        return response.allowedProviders
    }
}
