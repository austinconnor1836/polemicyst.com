import XCTest
@testable import ClipfireiOS

final class ClipfireiOSTests: XCTestCase {
    func testDecodeFeed() throws {
        let json = """
        {
          "id": "feed-1",
          "name": "Test",
          "sourceUrl": "https://youtube.com/@test",
          "pollingInterval": 60,
          "sourceType": "youtube",
          "userId": "user-1",
          "autoGenerateClips": false,
          "createdAt": "2024-01-01T00:00:00Z"
        }
        """
        let data = Data(json.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        _ = try decoder.decode(VideoFeed.self, from: data)
    }
}

// MARK: - StitchEditor side-channel upload tests
//
// These tests verify the PR #298 follow-up fix: when the user adds clips to a stitch,
// the editor should upload them to the server as `Composition` tracks IMMEDIATELY
// (not deferred to render time). This kicks off server-side transcription early so
// that by the time the user taps "AI Suggest" in the publish sheet, the per-track
// transcripts are populated and the LLM can generate content-aware copy.

final class StitchEditorUploadOnAddTests: XCTestCase {

    override func setUp() {
        super.setUp()
        StitchEditorMockProtocol.reset()
        // Register globally so it intercepts `URLSession.shared` requests too — the
        // multipart S3 PUT in `VideoUploadService` used to use `URLSession.shared`
        // directly. It now uses a background URLSession (so uploads survive app
        // suspension), and background sessions don't honor `URLProtocol`. The
        // `testSessionOverride` seam below lets the test substitute a foreground
        // session that DOES honor URLProtocol mocks.
        URLProtocol.registerClass(StitchEditorMockProtocol.self)
        let mockConfig = URLSessionConfiguration.ephemeral
        mockConfig.protocolClasses = [StitchEditorMockProtocol.self]
        VideoUploadService.testSessionOverride = URLSession(configuration: mockConfig)
        // Wipe any persisted draft from a previous test run so the ViewModel starts clean.
        StitchDraftStore.clear()
    }

    override func tearDown() {
        URLProtocol.unregisterClass(StitchEditorMockProtocol.self)
        VideoUploadService.testSessionOverride = nil
        StitchEditorMockProtocol.reset()
        StitchDraftStore.clear()
        super.tearDown()
    }

    /// Starting a new stitch and adding a clip with a known local file should result in
    /// a `POST /api/compositions` to create the server-side Composition, and the resulting
    /// id should be persisted on the timeline (so the publish sheet sees it).
    @MainActor
    func testAddingClipCreatesServerComposition() async throws {
        StitchEditorMockProtocol.handler = { request in
            let path = request.url?.path ?? ""
            if request.httpMethod == "POST", path == "/api/compositions" {
                let body = """
                {
                  "id": "test-composition-123",
                  "userId": "u",
                  "title": "Untitled",
                  "mode": "stitch",
                  "status": "draft",
                  "audioMode": "creator",
                  "creatorVolume": 1.0,
                  "referenceVolume": 1.0,
                  "creatorTrimStartS": 0,
                  "tracks": [],
                  "outputs": [],
                  "createdAt": "2026-06-12T00:00:00Z",
                  "updatedAt": "2026-06-12T00:00:00Z"
                }
                """
                return Self.ok(body)
            }
            // Anything else — fail the test by returning 500.
            return Self.notMocked(path: path, method: request.httpMethod ?? "?")
        }

        let api = StitchEditorMockProtocol.makeAPIClient()
        let viewModel = StitchEditorViewModel(api: api)

        XCTAssertNil(viewModel.timeline.serverCompositionId,
                     "Fresh editor should have no server composition id yet.")

        // Simulate a clip becoming ready in the timeline (sourceURL + duration set).
        // The side-channel upload path is keyed off `loadFromProvider` finishing, but
        // we exercise the public surface — `ensureServerComposition` is what
        // `startServerTrackUpload` ultimately drives.
        let id = await viewModel.testHook_ensureServerCompositionForTests()

        XCTAssertEqual(id, "test-composition-123",
                       "ensureServerComposition should return the server-assigned id.")
        XCTAssertEqual(viewModel.timeline.serverCompositionId, "test-composition-123",
                       "Timeline should cache the server composition id for subsequent calls.")

        // POST /api/compositions should have been called exactly once.
        let creates = StitchEditorMockProtocol.recordedRequests.filter {
            $0.method == "POST" && $0.path == "/api/compositions"
        }
        XCTAssertEqual(creates.count, 1, "Exactly one composition create call expected.")
    }

    /// Adding a video to a stitch should trigger POST /api/compositions/<id>/tracks
    /// once the source S3 upload finishes. Verifies the side-channel transcription
    /// kickoff that PR #298 needs.
    @MainActor
    func testAddingClipSendsPOSTTracks() async throws {
        let tempVideo = try Self.makeTempVideoFile()
        defer { try? FileManager.default.removeItem(at: tempVideo) }

        StitchEditorMockProtocol.handler = { request in
            let path = request.url?.path ?? ""
            let method = request.httpMethod ?? "?"

            if method == "POST", path == "/api/compositions" {
                return Self.ok("""
                {
                  "id": "comp-xyz",
                  "userId": "u",
                  "title": "Untitled",
                  "mode": "stitch",
                  "status": "draft",
                  "audioMode": "creator",
                  "creatorVolume": 1.0,
                  "referenceVolume": 1.0,
                  "creatorTrimStartS": 0,
                  "tracks": [],
                  "outputs": [],
                  "createdAt": "2026-06-12T00:00:00Z",
                  "updatedAt": "2026-06-12T00:00:00Z"
                }
                """)
            }

            if method == "POST", path == "/api/uploads/multipart/initiate" {
                return Self.ok("""
                {"uploadId":"upload-1","key":"compositions/comp-xyz/raw/clip.mp4"}
                """)
            }

            if method == "POST", path == "/api/uploads/multipart/part-url" {
                // Return a localhost URL — we'll intercept the PUT below too.
                return Self.ok("""
                {"url":"https://mock.local/part?n=1"}
                """)
            }

            if method == "PUT", request.url?.host == "mock.local" {
                // S3 PUT — succeed with an ETag header.
                return Self.okWithHeaders("", headers: ["ETag": "\"mock-etag\""])
            }

            if method == "POST", path == "/api/uploads/multipart/complete" {
                return Self.ok("""
                {"success": true}
                """)
            }

            if method == "POST", path == "/api/compositions/comp-xyz/tracks" {
                return Self.ok("""
                {
                  "id": "track-1",
                  "compositionId": "comp-xyz",
                  "s3Key": "compositions/comp-xyz/raw/clip.mp4",
                  "s3Url": "https://example/proxy/clip.mp4",
                  "durationS": 3.0,
                  "startAtS": 0,
                  "trimStartS": 0,
                  "sortOrder": 0,
                  "hasAudio": true,
                  "createdAt": "2026-06-12T00:00:00Z",
                  "updatedAt": "2026-06-12T00:00:00Z"
                }
                """, status: 201)
            }

            return Self.notMocked(path: path, method: method)
        }

        let api = StitchEditorMockProtocol.makeAPIClient()
        let viewModel = StitchEditorViewModel(api: api)

        let clipId = UUID()
        await viewModel.testHook_startServerTrackUpload(
            clipId: clipId,
            localURL: tempVideo,
            durationS: 3.0
        )

        // Wait for the in-flight upload task to settle.
        await viewModel.testHook_awaitPendingTrackUploads()

        let trackPosts = StitchEditorMockProtocol.recordedRequests.filter {
            $0.method == "POST" && $0.path == "/api/compositions/comp-xyz/tracks"
        }
        XCTAssertEqual(trackPosts.count, 1,
                       "Exactly one POST /tracks expected after a clip's S3 upload completes.")

        XCTAssertEqual(viewModel.timeline.serverCompositionId, "comp-xyz")
        let storedTrackId = viewModel.timeline.clips.first(where: { $0.id == clipId })?.serverTrackId
        // The clip wasn't added through `addClips` (we drove the side-channel directly),
        // so it's not in the timeline — but the upload still hits the server, which is
        // the load-bearing assertion for transcription kickoff. The clip→trackId mapping
        // is exercised in the integration path via `addClips`; here we just confirm the
        // network call shape.
        XCTAssertNil(storedTrackId,
                     "Side-channel test drove upload without adding the clip to the timeline.")
    }

    // MARK: - Helpers

    private static func ok(_ body: String, status: Int = 200) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: URL(string: "https://test.local/")!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (response, Data(body.utf8))
    }

    private static func okWithHeaders(_ body: String, headers: [String: String]) -> (HTTPURLResponse, Data) {
        var allHeaders = headers
        allHeaders["Content-Type"] = "application/octet-stream"
        let response = HTTPURLResponse(
            url: URL(string: "https://test.local/")!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: allHeaders
        )!
        return (response, Data(body.utf8))
    }

    private static func notMocked(path: String, method: String) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: URL(string: "https://test.local/")!,
            statusCode: 500,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        )!
        let body = #"{"error":"unmocked \#(method) \#(path)"}"#
        return (response, Data(body.utf8))
    }

    /// Writes a tiny non-empty file to disk that stands in as a "video file" for the
    /// multipart upload flow. The mock S3 PUT doesn't inspect the bytes, so the file
    /// just needs to exist and be readable as `Data(contentsOf:)`.
    private static func makeTempVideoFile() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("stitch-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("clip.mp4")
        try Data(repeating: 0x00, count: 1024).write(to: url)
        return url
    }
}

// MARK: - URLProtocol mock

/// A `URLProtocol` subclass that intercepts every request issued through a session
/// configured with it, lets the test supply a synchronous handler, and records each
/// request for assertions. Standard pattern for testing networking without touching
/// the real internet — see https://www.swiftbysundell.com/articles/testing-networking-logic-in-swift/.
final class StitchEditorMockProtocol: URLProtocol {
    struct RecordedRequest {
        let method: String
        let path: String
        let body: Data?
    }

    nonisolated(unsafe) static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?
    nonisolated(unsafe) static var recordedRequests: [RecordedRequest] = []
    private static let lock = NSLock()

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        handler = nil
        recordedRequests = []
    }

    static func makeAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StitchEditorMockProtocol.self]
        let session = URLSession(configuration: config)
        return APIClient(baseURL: URL(string: "https://test.local")!, session: session)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let method = request.httpMethod ?? "?"
        // URLProtocol strips the request's httpBody for streaming uploads. Capture both
        // possible locations so PUT/POST bodies are inspectable in assertions.
        let body = request.httpBody ?? request.httpBodyStream.map { stream -> Data in
            stream.open()
            defer { stream.close() }
            var data = Data()
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
            defer { buf.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buf, maxLength: 1024)
                if read <= 0 { break }
                data.append(buf, count: read)
            }
            return data
        }
        Self.lock.lock()
        Self.recordedRequests.append(RecordedRequest(method: method, path: path, body: body))
        let handler = Self.handler
        Self.lock.unlock()

        guard let handler else {
            client?.urlProtocol(self, didFailWithError: NSError(
                domain: "MockProtocol", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "no handler installed for \(method) \(path)"]
            ))
            return
        }
        let (response, data) = handler(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

// MARK: - Test hooks
//
// We intentionally avoid making `ensureServerComposition` and `startServerTrackUpload`
// public on the production type — they're internal to the editor's side-channel. The
// test hooks below are thin shims that exist only in the test bundle... except Swift
// has no symmetric `@testable internal` for actor-isolated methods, so we expose them
// as `internal` on the production type and only call them from tests.

@MainActor
extension StitchEditorViewModel {
    /// Test-only escape hatch — calls the private `ensureServerComposition()` flow.
    /// Marked internal (not public) so it's only reachable from the test bundle via
    /// `@testable import ClipfireiOS`.
    func testHook_ensureServerCompositionForTests() async -> String? {
        await ensureServerCompositionForTesting()
    }

    /// Test-only escape hatch — drives `startServerTrackUpload` directly.
    func testHook_startServerTrackUpload(clipId: UUID, localURL: URL, durationS: Double) async {
        startServerTrackUploadForTesting(clipId: clipId, localURL: localURL, durationS: durationS)
    }

    /// Awaits every currently-scheduled track-upload task so assertions can run
    /// after the side-channel has settled.
    func testHook_awaitPendingTrackUploads() async {
        await awaitPendingTrackUploadsForTesting()
    }
}

// MARK: - TaskStore bookkeeping tests
//
// Covers what's testable about the background-upload delegate plumbing without
// having to spin up a real URLSession — namely the `TaskStore` actor's per-task
// register/complete/duplicate-callback semantics. Background URLSession itself
// is not testable in a unit-test environment, so we test the bookkeeping piece
// in isolation.

final class TaskStoreTests: XCTestCase {

    /// A successful HTTP 200 + ETag header resolves the continuation with the
    /// ETag string. The pending count returns to zero.
    func testCompleteWithSuccessfulResponseReturnsETag() async throws {
        let store = TaskStore()
        let etag = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            Task {
                await store.register(
                    taskIdentifier: 1,
                    partNumber: 1,
                    totalParts: 1,
                    progress: nil,
                    continuation: cont
                )
                let response = HTTPURLResponse(
                    url: URL(string: "https://s3.example/part")!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["ETag": "\"abc123\""]
                )!
                await store.complete(taskIdentifier: 1, response: response, error: nil)
            }
        }
        XCTAssertEqual(etag, "\"abc123\"")
        let pending = await store.pendingCount()
        XCTAssertEqual(pending, 0, "Pending bookkeeping should unwind on completion.")
    }

    /// A non-2xx response throws `partFailed(n)`.
    func testCompleteWithErrorStatusThrowsPartFailed() async {
        let store = TaskStore()
        do {
            _ = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
                Task {
                    await store.register(
                        taskIdentifier: 7,
                        partNumber: 3,
                        totalParts: 5,
                        progress: nil,
                        continuation: cont
                    )
                    let response = HTTPURLResponse(
                        url: URL(string: "https://s3.example/part")!,
                        statusCode: 500,
                        httpVersion: "HTTP/1.1",
                        headerFields: nil
                    )!
                    await store.complete(taskIdentifier: 7, response: response, error: nil)
                }
            }
            XCTFail("Expected partFailed to throw.")
        } catch let VideoUploadError.partFailed(part) {
            XCTAssertEqual(part, 3)
        } catch {
            XCTFail("Wrong error: \(error)")
        }
    }

    /// A networking-layer error propagates verbatim.
    func testCompleteWithNetworkErrorPropagates() async {
        let store = TaskStore()
        let sentinel = NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost)
        do {
            _ = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
                Task {
                    await store.register(
                        taskIdentifier: 9,
                        partNumber: 1,
                        totalParts: 1,
                        progress: nil,
                        continuation: cont
                    )
                    await store.complete(taskIdentifier: 9, response: nil, error: sentinel)
                }
            }
            XCTFail("Expected to throw.")
        } catch {
            let ns = error as NSError
            XCTAssertEqual(ns.domain, NSURLErrorDomain)
            XCTAssertEqual(ns.code, NSURLErrorNetworkConnectionLost)
        }
    }

    /// Two terminal callbacks must NOT double-resume the continuation. The
    /// second `complete()` should be a no-op.
    func testDoubleCompleteIsNoOp() async throws {
        let store = TaskStore()
        let etag = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            Task {
                await store.register(
                    taskIdentifier: 11,
                    partNumber: 1,
                    totalParts: 1,
                    progress: nil,
                    continuation: cont
                )
                let response = HTTPURLResponse(
                    url: URL(string: "https://s3.example/part")!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["ETag": "etag-1"]
                )!
                await store.complete(taskIdentifier: 11, response: response, error: nil)
                // Second terminal callback — the continuation MUST NOT be resumed
                // a second time, or Swift will trap.
                await store.complete(taskIdentifier: 11, response: response, error: nil)
            }
        }
        XCTAssertEqual(etag, "etag-1")
        let wasResolved = await store.wasResolved(11)
        XCTAssertTrue(wasResolved, "Task should be marked resolved after first complete().")
        let pending = await store.pendingCount()
        XCTAssertEqual(pending, 0)
    }

    /// `appendResponseBody` is harmless before completion and doesn't affect
    /// the eventual resolution.
    func testAppendResponseBodyDoesNotInterfereWithCompletion() async throws {
        let store = TaskStore()
        let etag = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            Task {
                await store.register(
                    taskIdentifier: 21,
                    partNumber: 1,
                    totalParts: 1,
                    progress: nil,
                    continuation: cont
                )
                await store.appendResponseBody(taskIdentifier: 21, data: Data("partial".utf8))
                await store.appendResponseBody(taskIdentifier: 21, data: Data(" body".utf8))
                let response = HTTPURLResponse(
                    url: URL(string: "https://s3.example/part")!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["ETag": "the-etag"]
                )!
                await store.complete(taskIdentifier: 21, response: response, error: nil)
            }
        }
        XCTAssertEqual(etag, "the-etag")
    }
}
