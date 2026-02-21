import Foundation

struct APIClient {
    var baseURL: URL
    var session: URLSession
    var decoder: JSONDecoder
    var encoder: JSONEncoder

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder = JSONEncoder()
    }

    // MARK: Feeds

    func fetchFeeds() async throws -> [VideoFeed] {
        try await get(path: "/api/feeds")
    }

    func createFeed(_ request: CreateFeedRequest) async throws -> VideoFeed {
        try await post(path: "/api/feeds", body: request)
    }

    // MARK: Feed videos

    func fetchFeedVideos() async throws -> [FeedVideo] {
        try await get(path: "/api/feedVideos")
    }

    // MARK: Trigger clip generation

    func triggerClip(_ request: TriggerClipRequest) async throws -> ClipJobResponse {
        try await post(path: "/api/trigger-clip", body: request)
    }

    // MARK: Clips (requires auth/session)

    func fetchClips() async throws -> [ClipVideo] {
        try await get(path: "/api/clips")
    }

    func deleteClip(id: String) async throws {
        var urlRequest = URLRequest(url: baseURL.appending(path: "/api/clips/\(id)"))
        urlRequest.httpMethod = "DELETE"
        let (_, response) = try await session.data(for: urlRequest)
        try ensureSuccess(response)
    }

    // MARK: - Internal helpers

    private func get<T: Decodable>(path: String) async throws -> T {
        let (data, response) = try await session.data(from: baseURL.appending(path: path))
        try ensureSuccess(response)
        return try decoder.decode(T.self, from: data)
    }

    private func post<Body: Encodable, Response: Decodable>(path: String, body: Body) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
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

enum APIError: Error {
    case statusCode(Int)
}
