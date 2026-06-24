import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

public struct VideoUploadResult: Sendable {
    public let s3Key: String
    public let s3Url: String
}

public enum VideoUploadError: LocalizedError {
    case noVideo
    case invalidURL
    case partFailed(Int)

    public var errorDescription: String? {
        switch self {
        case .noVideo: return "Could not load the selected video"
        case .invalidURL: return "Invalid upload URL"
        case .partFailed(let n): return "Upload part \(n) failed"
        }
    }
}

// MARK: - VideoUploadService
//
// A clip-upload pipeline backed by a *background* URLSession so multipart S3 PUTs
// survive the app being backgrounded, the device switching networks, or the user
// momentarily losing connectivity. Previously this used `URLSession.shared`, which
// is tied to the foreground process — the moment the user left the app, in-flight
// uploads died with `NSURLErrorDomain -1005` ("network connection lost").
//
// Design notes:
//   - A single long-lived background session per identifier is required by iOS.
//     We expose `VideoUploadService.shared` and route every upload through the
//     same session under the hood, regardless of how many `VideoUploadService`
//     instances callers create. The public `init(api:)` initializer is preserved
//     for source compatibility with existing callers — internally each instance
//     just holds an `APIClient` reference and delegates I/O to the shared session.
//   - Background sessions REQUIRE upload tasks to use a file URL on disk, not
//     in-memory `Data`. We stream the source file into per-part temp chunks
//     before scheduling each upload task, then delete them when the task
//     completes (success or failure).
//   - The per-part completion is driven by URLSession delegate callbacks. Each
//     scheduled task carries a `taskIdentifier`; the delegate looks up the
//     pending continuation in a `TaskStore` actor and resumes it with success
//     or failure.
//   - `URLSessionConfiguration.background` does NOT honor `protocolClasses`,
//     so tests cannot intercept these requests with `URLProtocol.registerClass`.
//     The test seam below (`testSessionOverride`) lets unit tests substitute a
//     normal foreground session that DOES honor URLProtocol mocks.
//
// Public API contract — UNCHANGED from the prior `URLSession.shared` version:
//   - `init(api:)`
//   - `upload(item:prefix:progress:)`
//   - `upload(fileURL:prefix:contentType:deleteAfterUpload:progress:)`
//   - `VideoUploadResult` / `VideoUploadError`
// Anything else on this type is internal plumbing and may change.

public final class VideoUploadService: NSObject, @unchecked Sendable {
    public typealias ProgressHandler = @Sendable (_ partsCompleted: Int, _ totalParts: Int) -> Void

    // MARK: Singleton

    /// Process-wide singleton. The AppDelegate hooks this when iOS wakes the
    /// app to deliver background-session events; the saved completion handler
    /// lives here so it can be invoked from `urlSessionDidFinishEvents`.
    public static let shared = VideoUploadService()

    /// The `handleEventsForBackgroundURLSession` completion handler the OS hands
    /// us when relaunching the app to deliver background session events. Stashed
    /// here from the AppDelegate, called from `urlSessionDidFinishEvents`.
    public var savedBackgroundCompletionHandler: (() -> Void)?

    // MARK: Configuration

    fileprivate static let backgroundSessionIdentifier = "com.clipfire.uploads"
    private static let chunkSize = 10 * 1024 * 1024 // 10 MB — matches existing behavior

    /// Test seam — when set, `upload(...)` uses this session instead of the
    /// background session. Tests need this because `URLSessionConfiguration
    /// .background` doesn't honor `URLProtocol.registerClass`, so the existing
    /// `StitchEditorMockProtocol`-based tests would otherwise hit the real S3.
    /// Production code never sets this.
    nonisolated(unsafe) public static var testSessionOverride: URLSession?

    // MARK: Instance state

    private let api: APIClient?
    private let taskStore = TaskStore()

    /// Lazily-built background session. We create this on first use so the
    /// shared singleton doesn't try to re-register the same identifier on every
    /// hot-reload during tests.
    private lazy var backgroundSession: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.backgroundSessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.httpMaximumConnectionsPerHost = 6
        // Resource-level timeout — the chunk should comfortably finish in an
        // hour even on slow connections. Default is 7 days which is overkill.
        config.timeoutIntervalForResource = 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    // MARK: Init

    public init(api: APIClient) {
        self.api = api
        super.init()
    }

    /// Singleton initializer — no APIClient because the shared instance is only
    /// the session host. Per-call uploads use the `api` provided to the caller's
    /// own `VideoUploadService` instance, which proxies the actual upload work
    /// here.
    private override init() {
        self.api = nil
        super.init()
    }

    // MARK: - Public API (unchanged contract)

    public func upload(
        item: PhotosPickerItem,
        prefix: String,
        progress: ProgressHandler? = nil
    ) async throws -> VideoUploadResult {
        guard let movie = try await item.loadTransferable(type: CompositionVideoTransferable.self) else {
            throw VideoUploadError.noVideo
        }
        return try await upload(
            fileURL: movie.url,
            prefix: prefix,
            deleteAfterUpload: true,
            progress: progress
        )
    }

    public func upload(
        fileURL: URL,
        prefix: String,
        contentType: String = "video/mp4",
        deleteAfterUpload: Bool = false,
        progress: ProgressHandler? = nil
    ) async throws -> VideoUploadResult {
        guard let api else {
            // Should never happen — public callers go through `init(api:)`.
            throw VideoUploadError.noVideo
        }

        let filename = fileURL.lastPathComponent

        // We need the file size up-front to compute part count and to slice the
        // source into per-part chunks. We do NOT load the whole thing into
        // memory — large source files would push us over the iOS background
        // limit instantly.
        let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let fileSize = (attrs[.size] as? NSNumber)?.intValue ?? 0
        guard fileSize > 0 else { throw VideoUploadError.noVideo }

        let initResponse = try await api.initiateMultipartUpload(
            filename: "\(prefix)\(filename)",
            contentType: contentType
        )
        let uploadId = initResponse.uploadId
        let key = initResponse.key

        let totalParts = Int(ceil(Double(fileSize) / Double(Self.chunkSize)))
        var completedParts: [MultipartCompletePart] = []
        progress?(0, totalParts)

        // Scratch directory for per-part temp chunks. Background sessions only
        // accept file URLs for upload bodies — we have to stage each chunk.
        let chunkDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("clipfire-uploads-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: chunkDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: chunkDir) }

        for partNumber in 1...totalParts {
            let offset = (partNumber - 1) * Self.chunkSize
            let length = min(Self.chunkSize, fileSize - offset)
            let chunkURL = chunkDir.appendingPathComponent("part-\(partNumber).bin")

            // Slice the source file into a chunk file. Streamed read so we don't
            // load the full source into memory.
            try sliceFile(source: fileURL, dest: chunkURL, offset: offset, length: length)

            let partURLResponse = try await api.getMultipartPartURL(
                uploadId: uploadId,
                key: key,
                partNumber: partNumber
            )
            guard let url = URL(string: partURLResponse.url) else {
                throw VideoUploadError.invalidURL
            }

            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")

            let etag: String
            do {
                etag = try await uploadPart(
                    request: request,
                    chunkURL: chunkURL,
                    partNumber: partNumber,
                    totalParts: totalParts,
                    progress: progress
                )
            } catch {
                throw error
            }

            // Best-effort: drop the chunk file as soon as the task finishes so
            // we don't sit on N copies of the source during a long upload.
            try? FileManager.default.removeItem(at: chunkURL)

            completedParts.append(MultipartCompletePart(partNumber: partNumber, etag: etag))
            progress?(partNumber, totalParts)
        }

        try await api.completeMultipartUpload(uploadId: uploadId, key: key, parts: completedParts)

        let s3Url = "https://\(api.baseURL.host ?? "")/api/uploads/proxy/\(key)"

        if deleteAfterUpload {
            try? FileManager.default.removeItem(at: fileURL)
        }

        return VideoUploadResult(s3Key: key, s3Url: s3Url)
    }

    // MARK: - Internal: per-part upload

    /// Schedules a single PUT upload of `chunkURL` against `request.url` and
    /// awaits its completion. Each task gets a unique `taskIdentifier`; the
    /// delegate looks up the stashed continuation and resumes it.
    private func uploadPart(
        request: URLRequest,
        chunkURL: URL,
        partNumber: Int,
        totalParts: Int,
        progress: ProgressHandler?
    ) async throws -> String {
        let session = Self.testSessionOverride ?? backgroundSession

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            let task = session.uploadTask(with: request, fromFile: chunkURL)

            // For the test-override path, the test session has no delegate
            // wiring — handle completion via the per-task completion handler
            // there instead.
            if Self.testSessionOverride != nil {
                // The override session uses a foreground session WITHOUT a
                // delegate, so the URLProtocol-mocked test path doesn't see
                // our delegate. Use a per-task completion handler instead.
                let cb = TaskCompletionCallback(continuation: continuation, partNumber: partNumber)
                Self.attachCompletion(to: task, callback: cb)
                task.resume()
                return
            }

            // Production path — background session with delegate-driven completion.
            Task {
                await taskStore.register(
                    taskIdentifier: task.taskIdentifier,
                    partNumber: partNumber,
                    totalParts: totalParts,
                    progress: progress,
                    continuation: continuation
                )
                task.resume()
            }
        }
    }

    /// Reads `length` bytes starting at `offset` from `source` and writes them
    /// to `dest`. Streams a 1 MiB buffer so the source stays out of memory.
    private func sliceFile(source: URL, dest: URL, offset: Int, length: Int) throws {
        FileManager.default.createFile(atPath: dest.path, contents: nil)
        let reader = try FileHandle(forReadingFrom: source)
        defer { try? reader.close() }
        let writer = try FileHandle(forWritingTo: dest)
        defer { try? writer.close() }

        try reader.seek(toOffset: UInt64(offset))
        var remaining = length
        let bufSize = 1 * 1024 * 1024
        while remaining > 0 {
            let take = min(bufSize, remaining)
            guard let chunk = try reader.read(upToCount: take), !chunk.isEmpty else { break }
            try writer.write(contentsOf: chunk)
            remaining -= chunk.count
        }
    }

    // MARK: - Test-path helpers
    //
    // The test-session path uses a stored map of `taskIdentifier → callback` so
    // foreground tests work the same way the production code does, without
    // having to wire a delegate to the test session.

    nonisolated(unsafe) private static var pendingCompletions: [Int: TaskCompletionCallback] = [:]
    private static let pendingCompletionsLock = NSLock()

    fileprivate static func attachCompletion(to task: URLSessionUploadTask, callback: TaskCompletionCallback) {
        pendingCompletionsLock.lock()
        pendingCompletions[task.taskIdentifier] = callback
        pendingCompletionsLock.unlock()

        // Bridge: the test session has no delegate, so we install a one-shot
        // observer via KVO on the task's state property. When the task
        // completes, we resolve the continuation from its response/error.
        let observer = TaskCompletionObserver(task: task)
        observer.start { response, error in
            pendingCompletionsLock.lock()
            let cb = pendingCompletions.removeValue(forKey: task.taskIdentifier)
            pendingCompletionsLock.unlock()
            cb?.resolve(response: response, error: error)
        }
    }
}

// MARK: - URLSession delegate (background-session path)

extension VideoUploadService: URLSessionDelegate, URLSessionTaskDelegate, URLSessionDataDelegate {

    public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        // S3 PUT responses are usually empty (the ETag is in the header), but
        // some error paths put an XML body here. We buffer it for the
        // didCompleteWithError path so the caller can log it if needed.
        Task { await taskStore.appendResponseBody(taskIdentifier: dataTask.taskIdentifier, data: data) }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        Task {
            await taskStore.reportProgress(
                taskIdentifier: task.taskIdentifier,
                bytesSent: totalBytesSent,
                bytesExpected: totalBytesExpectedToSend
            )
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        let response = task.response
        Task {
            await taskStore.complete(
                taskIdentifier: task.taskIdentifier,
                response: response,
                error: error
            )
        }
    }

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        #if DEBUG
        // Mirror APIClient's LocalDevSessionDelegate behavior so dev-time S3 PUTs
        // against self-signed proxies work.
        if let trust = challenge.protectionSpace.serverTrust {
            let host = challenge.protectionSpace.host
            if host == "localhost" || host == "127.0.0.1" {
                return (.useCredential, URLCredential(trust: trust))
            }
        }
        #endif
        return (.performDefaultHandling, nil)
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        // iOS woke us to deliver completion events. Fire the saved system
        // completion handler so the OS knows we're done processing them.
        NSLog("[VideoUploadService] urlSessionDidFinishEvents — calling savedBackgroundCompletionHandler")
        DispatchQueue.main.async { [weak self] in
            self?.savedBackgroundCompletionHandler?()
            self?.savedBackgroundCompletionHandler = nil
        }
    }
}

// MARK: - TaskStore
//
// Actor-backed per-task bookkeeping: one continuation per upload task plus a
// response-body accumulator and a progress callback. The delegate looks up by
// `taskIdentifier`; the public-API method waits on the continuation.

actor TaskStore {
    struct Pending {
        let partNumber: Int
        let totalParts: Int
        let progress: VideoUploadService.ProgressHandler?
        let continuation: CheckedContinuation<String, Error>
        var responseBody: Data
    }

    private var pending: [Int: Pending] = [:]
    /// We only resume each continuation once. If a task fires two terminal
    /// callbacks (e.g. error then completion), the second is a no-op.
    private var resolved: Set<Int> = []

    func register(
        taskIdentifier: Int,
        partNumber: Int,
        totalParts: Int,
        progress: VideoUploadService.ProgressHandler?,
        continuation: CheckedContinuation<String, Error>
    ) {
        pending[taskIdentifier] = Pending(
            partNumber: partNumber,
            totalParts: totalParts,
            progress: progress,
            continuation: continuation,
            responseBody: Data()
        )
    }

    func appendResponseBody(taskIdentifier: Int, data: Data) {
        guard var p = pending[taskIdentifier] else { return }
        p.responseBody.append(data)
        pending[taskIdentifier] = p
    }

    func reportProgress(taskIdentifier: Int, bytesSent: Int64, bytesExpected: Int64) {
        guard let p = pending[taskIdentifier], bytesExpected > 0 else { return }
        // Background sessions report less often than foreground sessions; we
        // surface fractional sub-part progress as no-op for now (the public
        // contract reports `(partsCompleted, totalParts)` at part boundaries).
        // The hook is here so a future refinement can compute a smoothed
        // global progress without touching the public surface.
        _ = p
        _ = bytesSent
    }

    /// Resolves the continuation for `taskIdentifier`. Idempotent — duplicate
    /// terminal callbacks are silently dropped (URLSession can occasionally
    /// fire both `didReceive` and `didCompleteWithError` with terminal info).
    func complete(taskIdentifier: Int, response: URLResponse?, error: Error?) {
        guard let p = pending.removeValue(forKey: taskIdentifier) else { return }
        guard !resolved.contains(taskIdentifier) else { return }
        resolved.insert(taskIdentifier)

        if let error {
            p.continuation.resume(throwing: error)
            return
        }
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let etag = http.value(forHTTPHeaderField: "ETag") else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            NSLog("[VideoUploadService] Part %d failed: status=%d", p.partNumber, status)
            p.continuation.resume(throwing: VideoUploadError.partFailed(p.partNumber))
            return
        }
        p.continuation.resume(returning: etag)
    }

    // MARK: - Test introspection

    /// Test-only — how many tasks are currently pending. Used to assert that
    /// the bookkeeping unwinds correctly after a complete()/error.
    func pendingCount() -> Int { pending.count }

    /// Test-only — directly drive a `complete()` and verify the continuation
    /// is consumed exactly once.
    func wasResolved(_ taskIdentifier: Int) -> Bool { resolved.contains(taskIdentifier) }
}

// MARK: - Test-session bridging
//
// `URLSessionConfiguration.background` doesn't honor `URLProtocol.registerClass`.
// For tests that need to mock S3 PUTs, we let them set `testSessionOverride` to
// a foreground session that DOES honor URLProtocol mocks, and use a tiny KVO
// observer to drive the per-task completion instead of relying on the session
// delegate (which the test doesn't install).

final class TaskCompletionCallback: @unchecked Sendable {
    let continuation: CheckedContinuation<String, Error>
    let partNumber: Int

    init(continuation: CheckedContinuation<String, Error>, partNumber: Int) {
        self.continuation = continuation
        self.partNumber = partNumber
    }

    private var resolved = false
    private let lock = NSLock()

    func resolve(response: URLResponse?, error: Error?) {
        lock.lock()
        let alreadyResolved = resolved
        resolved = true
        lock.unlock()
        guard !alreadyResolved else { return }

        if let error {
            continuation.resume(throwing: error)
            return
        }
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let etag = http.value(forHTTPHeaderField: "ETag") else {
            continuation.resume(throwing: VideoUploadError.partFailed(partNumber))
            return
        }
        continuation.resume(returning: etag)
    }
}

/// Polls a `URLSessionTask`'s `state` property for the `.completed` terminal
/// value. Used only on the test-override path where the session has no delegate.
final class TaskCompletionObserver: NSObject {
    private let task: URLSessionTask
    private var callback: ((URLResponse?, Error?) -> Void)?
    private var pollTask: Task<Void, Never>?

    init(task: URLSessionTask) { self.task = task }

    func start(_ cb: @escaping (URLResponse?, Error?) -> Void) {
        self.callback = cb
        // Poll the task state. URLProtocol-mocked tests finish synchronously
        // once `task.resume()` is called, but the response/error are populated
        // by the URL loading system on a background queue, so a 1-tick wait
        // is needed.
        pollTask = Task.detached { [weak self] in
            guard let self else { return }
            // Cap at ~30s so a stuck test surfaces as a timeout, not a hang.
            for _ in 0..<3000 {
                if self.task.state == .completed { break }
                try? await Task.sleep(nanoseconds: 10_000_000) // 10 ms
            }
            let response = self.task.response
            let error = self.task.error
            self.callback?(response, error)
        }
    }
}

// MARK: - PhotosPicker bridge

struct CompositionVideoTransferable: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            let dest = tempDir.appendingPathComponent(received.file.lastPathComponent)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return Self(url: dest)
        }
    }
}
