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
        if session == nil {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 120
            let delegate = LocalDevSessionDelegate()
            self.session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        } else {
            self.session = session ?? .shared
        }
        #else
        if session == nil {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 120
            self.session = URLSession(configuration: config)
        } else {
            self.session = session ?? .shared
        }
        #endif
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            // Try ISO 8601 with fractional seconds first (Prisma default)
            let formatterWithFractional = ISO8601DateFormatter()
            formatterWithFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatterWithFractional.date(from: dateString) {
                return date
            }

            // Fall back to ISO 8601 without fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: dateString) {
                return date
            }

            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date: \(dateString)")
        }
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

    public func exchangeFacebookToken(_ accessToken: String) async throws -> FacebookTokenResponse {
        struct Body: Encodable { let accessToken: String }
        return try await post(path: "/api/auth/mobile/facebook", body: Body(accessToken: accessToken))
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

    public func importVideoFromURL(
        url: String,
        filename: String? = nil,
        transcript: String? = nil,
        transcriptSegments: [[String: AnyCodable]]? = nil,
        transcriptSource: String? = nil,
        captionError: String? = nil
    ) async throws -> FeedVideo {
        try await post(
            path: "/api/uploads/from-url",
            body: ImportFromURLRequest(
                url: url,
                filename: filename,
                transcript: transcript,
                transcriptSegments: transcriptSegments,
                transcriptSource: transcriptSource,
                captionError: captionError
            )
        )
    }

    // MARK: Multipart Upload

    public func initiateMultipartUpload(filename: String, contentType: String) async throws -> MultipartInitiateResponse {
        try await post(path: "/api/uploads/multipart/initiate", body: MultipartInitiateRequest(filename: filename, contentType: contentType))
    }

    public func getMultipartPartURL(uploadId: String, key: String, partNumber: Int) async throws -> MultipartPartURLResponse {
        try await post(path: "/api/uploads/multipart/part-url", body: MultipartPartURLRequest(uploadId: uploadId, key: key, partNumber: partNumber))
    }

    public func completeMultipartUpload(uploadId: String, key: String, parts: [MultipartCompletePart]) async throws {
        struct Response: Decodable { let success: Bool }
        let _: Response = try await post(path: "/api/uploads/multipart/complete", body: MultipartCompleteRequest(uploadId: uploadId, key: key, parts: parts))
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

    // MARK: Transcription

    public func innertubeTranscribe(feedVideoId: String) async throws -> InnertubeTranscribeResponse {
        try await post(path: "/api/feedVideos/\(feedVideoId)/innertube-transcribe", body: InnertubeTranscribeRequest())
    }

    public func transcribeFeedVideo(feedVideoId: String) async throws -> TranscribeResponse {
        try await post(path: "/api/feedVideos/\(feedVideoId)/transcribe", body: InnertubeTranscribeRequest())
    }

    public func saveTranscript(feedVideoId: String, transcript: String, segments: [[String: AnyCodable]], source: String) async throws -> SaveTranscriptResponse {
        try await post(path: "/api/feedVideos/\(feedVideoId)/save-transcript", body: SaveTranscriptRequest(transcript: transcript, segments: segments, source: source))
    }

    public func generateMetadata(feedVideoId: String) async throws -> GenerateMetadataResponse {
        try await post(path: "/api/feedVideos/\(feedVideoId)/generate-metadata", body: InnertubeTranscribeRequest())
    }

    // MARK: Truth Analysis

    public func fetchTruthAnalysis(feedVideoId: String, clipId: String? = nil) async throws -> TruthAnalysisResponse {
        var path = "/api/feedVideos/\(feedVideoId)/truth-analysis"
        if let clipId { path += "?clipId=\(clipId)" }
        return try await get(path: path)
    }

    public func runTruthAnalysis(feedVideoId: String, clipId: String? = nil, provider: String = "gemini") async throws -> TruthAnalysisResponse {
        try await post(path: "/api/feedVideos/\(feedVideoId)/truth-analysis", body: TruthAnalysisRequest(clipId: clipId, provider: provider))
    }

    // MARK: Analysis Chat

    public func fetchAnalysisChat(feedVideoId: String, clipId: String? = nil) async throws -> AnalysisChatResponse {
        var path = "/api/feedVideos/\(feedVideoId)/truth-analysis/chat"
        if let clipId { path += "?clipId=\(clipId)" }
        return try await get(path: path)
    }

    public func sendAnalysisChatMessage(feedVideoId: String, message: String, clipId: String? = nil) async throws -> AnalysisChatSendResponse {
        try await post(path: "/api/feedVideos/\(feedVideoId)/truth-analysis/chat", body: AnalysisChatSendRequest(message: message, clipId: clipId))
    }

    // MARK: Publications

    public func fetchPublications() async throws -> [Publication] {
        try await get(path: "/api/publications")
    }

    public func fetchPublication(id: String) async throws -> Publication {
        try await get(path: "/api/publications/\(id)")
    }

    public func createPublication(_ request: CreatePublicationRequest) async throws -> Publication {
        try await post(path: "/api/publications", body: request)
    }

    public func updatePublication(id: String, body: UpdatePublicationRequest) async throws -> Publication {
        try await put(path: "/api/publications/\(id)", body: body)
    }

    public func deletePublication(id: String) async throws {
        try await delete(path: "/api/publications/\(id)")
    }

    // MARK: Articles

    public func fetchArticles(publicationId: String? = nil) async throws -> [Article] {
        var path = "/api/articles"
        if let publicationId { path += "?publicationId=\(publicationId)" }
        return try await get(path: path)
    }

    public func fetchArticle(id: String) async throws -> Article {
        try await get(path: "/api/articles/\(id)")
    }

    public func createArticle(_ request: CreateArticleRequest) async throws -> Article {
        try await post(path: "/api/articles", body: request)
    }

    public func updateArticle(id: String, title: String, bodyMarkdown: String) async throws -> Article {
        struct Body: Encodable { let title: String; let bodyMarkdown: String }
        return try await put(path: "/api/articles/\(id)", body: Body(title: title, bodyMarkdown: bodyMarkdown))
    }

    public func deleteArticle(id: String) async throws {
        try await delete(path: "/api/articles/\(id)")
    }

    public func generateArticle(id: String, request: GenerateArticleRequest) async throws -> Article {
        try await post(path: "/api/articles/\(id)/generate", body: request)
    }

    public func generateGraphics(articleId: String) async throws -> GenerateGraphicsResponse {
        struct EmptyBody: Encodable {}
        return try await post(path: "/api/articles/\(articleId)/generate-graphics", body: EmptyBody())
    }

    public func rasterizeGraphics(articleId: String) async throws -> GenerateGraphicsResponse {
        struct EmptyBody: Encodable {}
        return try await post(path: "/api/articles/\(articleId)/rasterize-graphics", body: EmptyBody())
    }

    public func fetchArticlePublishes(articleId: String) async throws -> [ArticlePublishRecord] {
        try await get(path: "/api/articles/\(articleId)/publishes")
    }

    public func publishArticle(articleId: String, publishLive: Bool = false) async throws -> Article {
        try await post(path: "/api/articles/\(articleId)/publish", body: PublishArticleRequest(publishLive: publishLive))
    }

    public func publishArticleToAccount(articleId: String, publishingAccountId: String, publishLive: Bool = false) async throws -> ArticlePublishRecord {
        try await post(path: "/api/articles/\(articleId)/publish", body: PublishArticleRequest(publishingAccountId: publishingAccountId, publishLive: publishLive))
    }

    // MARK: Publishing Accounts

    public func fetchPublishingAccounts() async throws -> [PublishingAccount] {
        try await get(path: "/api/publishing-accounts")
    }

    public func connectPublishingAccount(platform: String, cookie: String, subdomain: String? = nil) async throws -> PublishingAccount {
        struct Body: Encodable { let platform: String; let cookie: String; let subdomain: String? }
        return try await post(path: "/api/publishing-accounts", body: Body(platform: platform, cookie: cookie, subdomain: subdomain))
    }

    // MARK: Substack

    public func connectSubstack(publicationId: String, cookie: String, subdomain: String) async throws -> SubstackConnectResponse {
        struct Body: Encodable { let cookie: String; let subdomain: String }
        return try await post(path: "/api/publications/\(publicationId)/substack/connect", body: Body(cookie: cookie, subdomain: subdomain))
    }

    public func disconnectSubstack(publicationId: String) async throws {
        struct EmptyBody: Encodable {}
        let _: SubstackConnectResponse = try await post(path: "/api/publications/\(publicationId)/substack/disconnect", body: EmptyBody())
    }

    public func verifySubstack(publicationId: String) async throws -> SubstackConnectResponse {
        try await get(path: "/api/publications/\(publicationId)/substack/verify")
    }

    // MARK: Social Posts

    public func fetchSocialPosts() async throws -> [SocialPost] {
        try await get(path: "/api/social-posts")
    }

    public func createSocialPost(_ request: CreateSocialPostRequest) async throws -> SocialPost {
        try await post(path: "/api/social-posts", body: request)
    }

    public func deleteSocialPost(id: String) async throws {
        try await delete(path: "/api/social-posts/\(id)")
    }

    public func fetchSocialPlatforms() async throws -> SocialPlatformsResponse {
        try await get(path: "/api/social-posts/platforms")
    }

    public func fetchPublishDefaults() async throws -> PublishDefaultsResponse {
        try await get(path: "/api/user/publish-defaults")
    }

    public func updatePublishDefaults(platforms: [String]) async throws -> PublishDefaultsResponse {
        struct Body: Encodable { let platforms: [String] }
        return try await put(path: "/api/user/publish-defaults", body: Body(platforms: platforms))
    }

    // MARK: Compositions

    public func fetchCompositions() async throws -> [Composition] {
        try await get(path: "/api/compositions")
    }

    public func createComposition(body: CreateCompositionRequest) async throws -> Composition {
        try await post(path: "/api/compositions", body: body)
    }

    public func fetchComposition(id: String) async throws -> Composition {
        try await get(path: "/api/compositions/\(id)")
    }

    public func updateComposition(id: String, body: UpdateCompositionRequest) async throws -> Composition {
        try await patch(path: "/api/compositions/\(id)", body: body)
    }

    public func deleteComposition(id: String) async throws {
        try await delete(path: "/api/compositions/\(id)")
    }

    public func addTrack(compositionId: String, body: CreateTrackRequest) async throws -> CompositionTrack {
        try await post(path: "/api/compositions/\(compositionId)/tracks", body: body)
    }

    public func deleteTrack(compositionId: String, trackId: String) async throws {
        try await delete(path: "/api/compositions/\(compositionId)/tracks/\(trackId)")
    }

    public func triggerRender(compositionId: String, body: RenderRequest) async throws -> AnyCodable {
        try await post(path: "/api/compositions/\(compositionId)/render", body: body)
    }

    public func fetchRenderStatus(compositionId: String) async throws -> RenderStatusResponse {
        try await get(path: "/api/compositions/\(compositionId)/render/status")
    }

    public func cancelRender(compositionId: String) async throws {
        struct EmptyBody: Encodable {}
        let _: AnyCodable = try await post(path: "/api/compositions/\(compositionId)/render/cancel", body: EmptyBody())
    }

    public func probeVideo(s3Key: String) async throws -> ProbeResponse {
        struct Body: Encodable { let s3Key: String }
        return try await post(path: "/api/compositions/probe", body: Body(s3Key: s3Key))
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
/// Accepts self-signed certificates for local development (localhost + LAN IPs).
final class LocalDevSessionDelegate: NSObject, URLSessionDelegate {
    private func isLocalHost(_ host: String) -> Bool {
        if host == "localhost" || host == "127.0.0.1" { return true }
        // Private network ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        if parts[0] == 192 && parts[1] == 168 { return true }
        if parts[0] == 10 { return true }
        if parts[0] == 172 && (16...31).contains(parts[1]) { return true }
        // Tailscale CGNAT range: 100.64-127.x.x
        if parts[0] == 100 && (64...127).contains(parts[1]) { return true }
        return false
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if isLocalHost(challenge.protectionSpace.host),
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
#endif
