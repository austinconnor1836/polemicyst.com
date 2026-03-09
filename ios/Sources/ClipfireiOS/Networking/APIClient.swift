import Foundation

public struct APIClient {
    public var baseURL: URL
    public var session: URLSession
    public var decoder: JSONDecoder
    public var encoder: JSONEncoder
    public var tokenStorage: TokenStorage?

    public init(baseURL: URL, session: URLSession? = nil, tokenStorage: TokenStorage? = nil) {
        self.baseURL = baseURL
        #if DEBUG
        if session == nil && baseURL.host() == "localhost" {
            let delegate = LocalhostSessionDelegate()
            self.session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        } else {
            self.session = session ?? .shared
        }
        #else
        self.session = session ?? .shared
        #endif
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder = JSONEncoder()
        self.tokenStorage = tokenStorage
    }

    // MARK: Auth

    public func authenticateWithGoogle(idToken: String, serverAuthCode: String? = nil) async throws -> MobileAuthResponse {
        try await post(path: "/api/auth/mobile/google", body: MobileGoogleAuthRequest(idToken: idToken, serverAuthCode: serverAuthCode))
    }

    public func exchangeGoogleAuthCode(_ serverAuthCode: String) async throws -> ExchangeCodeResponse {
        try await post(path: "/api/auth/mobile/google/exchange-code", body: ExchangeCodeRequest(serverAuthCode: serverAuthCode))
    }

    public func authenticateWithApple(identityToken: String, fullName: AppleFullName?) async throws -> MobileAuthResponse {
        try await post(
            path: "/api/auth/mobile/apple",
            body: MobileAppleAuthRequest(identityToken: identityToken, fullName: fullName)
        )
    }

    // MARK: YouTube Channels

    public func fetchYouTubeChannels() async throws -> [YouTubeChannel] {
        try await get(path: "/api/youtube/channels")
    }

    public func connectYouTubeChannel(_ request: CreateFromYouTubeRequest) async throws -> VideoFeed {
        try await post(path: "/api/connected-accounts/from-youtube", body: request)
    }

    // MARK: Brands

    public func fetchBrands() async throws -> [Brand] {
        try await get(path: "/api/brands")
    }

    public func createBrand(_ request: CreateBrandRequest) async throws -> Brand {
        try await post(path: "/api/brands", body: request)
    }

    public func updateBrand(id: String, body: UpdateBrandRequest) async throws -> Brand {
        try await patch(path: "/api/brands/\(id)", body: body)
    }

    public func deleteBrand(id: String) async throws {
        try await delete(path: "/api/brands/\(id)")
    }

    // MARK: Connected Accounts

    public func fetchFeeds() async throws -> [VideoFeed] {
        try await get(path: "/api/connected-accounts")
    }

    public func createFeed(_ request: CreateFeedRequest) async throws -> VideoFeed {
        try await post(path: "/api/connected-accounts", body: request)
    }

    public func updateFeed(id: String, body: [String: AnyCodable]) async throws -> VideoFeed {
        try await patch(path: "/api/connected-accounts/\(id)", body: body)
    }

    public func deleteFeed(id: String) async throws {
        try await delete(path: "/api/connected-accounts/\(id)")
    }

    // MARK: Upload / Import

    public func importVideoFromURL(url: String, filename: String? = nil) async throws -> FeedVideo {
        try await post(path: "/api/uploads/from-url", body: ImportFromURLRequest(url: url, filename: filename))
    }

    public func getPresignedUploadURL(filename: String, contentType: String = "video/mp4") async throws -> PresignedUploadResponse {
        try await post(path: "/api/uploads/presigned", body: PresignedUploadRequest(filename: filename, contentType: contentType))
    }

    public func uploadToPresignedURL(_ presignedURL: URL, fileData: Data, contentType: String = "video/mp4") async throws {
        var request = URLRequest(url: presignedURL)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("\(fileData.count)", forHTTPHeaderField: "Content-Length")
        let (_, response) = try await session.upload(for: request, from: fileData)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.statusCode((response as? HTTPURLResponse)?.statusCode ?? 500)
        }
    }

    public func completeUpload(key: String, filename: String) async throws -> FeedVideo {
        try await post(path: "/api/uploads/complete", body: CompleteUploadRequest(key: key, filename: filename))
    }

    // MARK: Feed videos

    public func fetchFeedVideos() async throws -> [FeedVideo] {
        try await get(path: "/api/feedVideos")
    }

    public func deleteFeedVideo(id: String) async throws {
        try await delete(path: "/api/feedVideos/\(id)")
    }

    // MARK: Feed video detail

    public func fetchFeedVideoDetail(id: String) async throws -> FeedVideoDetailResponse {
        try await get(path: "/api/feedVideos/\(id)/clips")
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

    // MARK: Automation Settings

    public func fetchAutomationSettings() async throws -> AutomationSettings {
        try await get(path: "/api/user/automation")
    }

    public func updateAutomationSettings(_ settings: AutomationSettings) async throws -> AutomationSettings {
        try await put(path: "/api/user/automation", body: settings)
    }

    // MARK: Version Check

    public func checkVersion(currentVersion: String) async throws -> VersionCheckResponse {
        let url = baseURL.appending(path: "/api/app/version-check")
            .appending(queryItems: [
                URLQueryItem(name: "platform", value: "ios"),
                URLQueryItem(name: "currentVersion", value: currentVersion)
            ])
        let request = URLRequest(url: url)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(VersionCheckResponse.self, from: data)
    }

    // MARK: - Internal helpers

    func authorizedRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        if let token = tokenStorage?.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func get<T: Decodable>(path: String) async throws -> T {
        let request = authorizedRequest(url: baseURL.appending(path: path))
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    func post<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = authorizedRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func put<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = authorizedRequest(url: baseURL.appending(path: path))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func patch<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = authorizedRequest(url: baseURL.appending(path: path))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        try ensureSuccess(response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func delete(path: String) async throws {
        var request = authorizedRequest(url: baseURL.appending(path: path))
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

#if DEBUG
/// Accepts self-signed certificates for localhost during development.
final class LocalhostSessionDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard challenge.protectionSpace.host == "localhost",
              let trust = challenge.protectionSpace.serverTrust else {
            return (.performDefaultHandling, nil)
        }
        return (.useCredential, URLCredential(trust: trust))
    }
}
#endif
