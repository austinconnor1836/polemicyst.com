import SwiftUI
import PhotosUI
import GoogleSignIn
import UIKit

extension Notification.Name {
    static let videoAdded = Notification.Name("videoAdded")
    static let uploadFailed = Notification.Name("uploadFailed")
    static let uploadStarted = Notification.Name("uploadStarted")
}

// MARK: - Upload State (persisted to disk for crash recovery)

private struct UploadState: Codable {
    let uploadId: String
    let key: String
    let filename: String
    let contentType: String
    let sourceFileURL: String
    let totalParts: Int
    let fileSize: Int
    var completedParts: [CompletedPart]
    var nextPart: Int // 1-based, next part number to schedule
    var taskToPartMap: [String: Int] // taskIdentifier (as String) -> partNumber

    struct CompletedPart: Codable {
        let partNumber: Int
        let etag: String
    }

    var allPartsUploaded: Bool {
        completedParts.count >= totalParts
    }
}

// MARK: - Background Upload Service

/// Singleton that performs uploads outside the SwiftUI view lifecycle.
/// Uses a background URLSession so S3 uploads survive app backgrounding/termination.
public final class BackgroundUploadService: NSObject, URLSessionDataDelegate {
    public static let shared = BackgroundUploadService()

    private static let sessionIdentifier = "com.clipfire.upload"
    private static let chunkSize = 10 * 1024 * 1024 // 10 MB (matching web client)
    private static let maxConcurrency = 4

    private var bgSession: URLSession!
    private(set) var api: APIClient?

    /// System completion handler from handleEventsForBackgroundURLSession
    public var systemCompletionHandler: (() -> Void)?

    // In-memory tracking
    private var uploadState: UploadState?
    private var taskToPartMap: [Int: Int] = [:] // taskIdentifier -> partNumber
    private var inFlightCount = 0
    private let lock = NSLock()

    private var chunksDir: URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("clipfire-chunks")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private var stateFileURL: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        return appSupport.appendingPathComponent("clipfire-upload-state.json")
    }

    private override init() {
        super.init()
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForResource = 3600
        bgSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    /// Call on app launch to set the API client and reconnect to any in-progress uploads.
    public func configure(api: APIClient) {
        self.api = api
        restoreState()
        if let state = uploadState {
            NSLog("[Upload] Restored state: %d/%d parts completed", state.completedParts.count, state.totalParts)
            // Background session automatically reconnects and delivers pending events
        }
    }

    // MARK: - State persistence

    private func saveState() {
        lock.lock()
        guard var state = uploadState else {
            lock.unlock()
            return
        }
        // Sync in-memory taskToPartMap into state
        state.taskToPartMap = Dictionary(uniqueKeysWithValues: taskToPartMap.map { ("\($0.key)", $0.value) })
        uploadState = state
        lock.unlock()

        if let data = try? JSONEncoder().encode(state) {
            try? data.write(to: stateFileURL, options: .atomic)
        }
    }

    private func restoreState() {
        guard let data = try? Data(contentsOf: stateFileURL),
              let state = try? JSONDecoder().decode(UploadState.self, from: data) else { return }
        uploadState = state
        // Restore taskToPartMap
        taskToPartMap = Dictionary(uniqueKeysWithValues: state.taskToPartMap.compactMap { key, value in
            guard let intKey = Int(key) else { return nil }
            return (intKey, value)
        })
        inFlightCount = taskToPartMap.count
    }

    private func clearState() {
        lock.lock()
        uploadState = nil
        taskToPartMap = [:]
        inFlightCount = 0
        lock.unlock()
        try? FileManager.default.removeItem(at: stateFileURL)
        try? FileManager.default.removeItem(at: chunksDir)
    }

    // MARK: - Public API

    /// Loads video from PhotosPickerItem in background, then uploads via multipart.
    /// Modal is already dismissed when this is called.
    func loadAndUploadVideo(api: APIClient, item: PhotosPickerItem) {
        self.api = api

        var bgTaskId = UIBackgroundTaskIdentifier.invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "loadVideo") {
            UIApplication.shared.endBackgroundTask(bgTaskId)
        }

        Thread.detachNewThread {
            let semaphore = DispatchSemaphore(value: 0)
            Task {
                NSLog("[Upload] Loading video from photo library...")
                guard let movie = try? await item.loadTransferable(type: VideoTransferable.self) else {
                    NSLog("[Upload] Failed to load video from photo library")
                    await MainActor.run {
                        NotificationCenter.default.post(
                            name: .uploadFailed,
                            object: nil,
                            userInfo: ["filename": "video", "error": "Unable to load selected video"]
                        )
                    }
                    UIApplication.shared.endBackgroundTask(bgTaskId)
                    semaphore.signal()
                    return
                }
                NSLog("[Upload] Video loaded: %@ (%@)", movie.filename, movie.fileURL.path)
                await BackgroundUploadService.shared.startMultipartUpload(
                    fileURL: movie.fileURL, filename: movie.filename
                )
                UIApplication.shared.endBackgroundTask(bgTaskId)
                semaphore.signal()
            }
            semaphore.wait()
        }
    }

    func uploadVideo(api: APIClient, fileURL: URL, filename: String) {
        self.api = api

        var bgTaskId = UIBackgroundTaskIdentifier.invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "uploadVideo") {
            UIApplication.shared.endBackgroundTask(bgTaskId)
        }

        Thread.detachNewThread { [weak self] in
            let semaphore = DispatchSemaphore(value: 0)
            Task {
                await self?.startMultipartUpload(fileURL: fileURL, filename: filename)
                UIApplication.shared.endBackgroundTask(bgTaskId)
                semaphore.signal()
            }
            semaphore.wait()
        }
    }

    // MARK: - Upload orchestration

    private func startMultipartUpload(fileURL: URL, filename: String) async {
        guard let api else {
            NSLog("[Upload] API client not configured")
            return
        }

        do {
            let contentType = filename.hasSuffix(".mov") ? "video/quicktime" : "video/mp4"
            let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            let fileSize = attrs[.size] as? Int ?? 0
            let totalParts = (fileSize + Self.chunkSize - 1) / Self.chunkSize

            await MainActor.run {
                NotificationCenter.default.post(
                    name: .uploadStarted,
                    object: nil,
                    userInfo: ["filename": filename, "size": fileSize]
                )
            }

            NSLog("[Upload] Initiating multipart upload: %d bytes (%d parts), contentType=%@", fileSize, totalParts, contentType)
            let initResponse = try await api.initiateMultipartUpload(filename: filename, contentType: contentType)
            NSLog("[Upload] Multipart initiated: uploadId=%@, key=%@", initResponse.uploadId, initResponse.key)

            lock.lock()
            uploadState = UploadState(
                uploadId: initResponse.uploadId,
                key: initResponse.key,
                filename: filename,
                contentType: contentType,
                sourceFileURL: fileURL.path,
                totalParts: totalParts,
                fileSize: fileSize,
                completedParts: [],
                nextPart: 1,
                taskToPartMap: [:]
            )
            lock.unlock()
            saveState()

            await scheduleNextBatch()
        } catch {
            let errorDetail = describeUploadError(error)
            NSLog("[Upload] Failed to start multipart upload: %@", errorDetail)
            await MainActor.run {
                NotificationCenter.default.post(
                    name: .uploadFailed,
                    object: nil,
                    userInfo: ["filename": filename, "error": errorDetail]
                )
            }
            try? FileManager.default.removeItem(at: fileURL)
        }
    }

    private func scheduleNextBatch() async {
        guard let api = self.api else { return }

        lock.lock()
        guard let state = uploadState else {
            lock.unlock()
            return
        }

        let availableSlots = Self.maxConcurrency - inFlightCount
        var partsToSchedule: [Int] = []
        var nextPart = state.nextPart
        let completedSet = Set(state.completedParts.map { $0.partNumber })

        for _ in 0..<availableSlots {
            // Skip already completed parts
            while nextPart <= state.totalParts && completedSet.contains(nextPart) {
                nextPart += 1
            }
            if nextPart <= state.totalParts {
                partsToSchedule.append(nextPart)
                nextPart += 1
            }
        }

        uploadState?.nextPart = nextPart
        lock.unlock()

        guard !partsToSchedule.isEmpty else { return }

        let sourceURL = URL(fileURLWithPath: state.sourceFileURL)

        for partNumber in partsToSchedule {
            do {
                // Write chunk to temp file (background sessions require file-based uploads)
                let chunkFileURL = chunksDir.appendingPathComponent("part-\(partNumber).tmp")
                let offset = (partNumber - 1) * Self.chunkSize
                let length = min(Self.chunkSize, state.fileSize - offset)

                let fileHandle = try FileHandle(forReadingFrom: sourceURL)
                defer { try? fileHandle.close() }
                try fileHandle.seek(toOffset: UInt64(offset))
                guard let chunk = try fileHandle.read(upToCount: length) else {
                    throw APIError.statusCode(500)
                }
                try chunk.write(to: chunkFileURL)

                // Get presigned URL for this part
                let partURLResponse = try await api.getMultipartPartURL(
                    uploadId: state.uploadId, key: state.key, partNumber: partNumber
                )
                guard let partURL = URL(string: partURLResponse.url) else {
                    throw APIError.statusCode(500)
                }

                // Create background upload task
                var request = URLRequest(url: partURL)
                request.httpMethod = "PUT"
                request.setValue(state.contentType, forHTTPHeaderField: "Content-Type")

                let task = bgSession.uploadTask(with: request, fromFile: chunkFileURL)

                lock.lock()
                taskToPartMap[task.taskIdentifier] = partNumber
                inFlightCount += 1
                lock.unlock()

                NSLog("[Upload] Scheduled part %d/%d (task %d)", partNumber, state.totalParts, task.taskIdentifier)
                task.resume()
            } catch {
                NSLog("[Upload] Failed to schedule part %d: %@", partNumber, error.localizedDescription)
                // Put part back for retry on next batch
                lock.lock()
                if let current = uploadState?.nextPart {
                    uploadState?.nextPart = min(current, partNumber)
                }
                lock.unlock()
            }
        }

        saveState()
    }

    private func finalizeUpload() async {
        guard let api = self.api else { return }

        lock.lock()
        guard let state = uploadState else {
            lock.unlock()
            return
        }
        lock.unlock()

        do {
            let parts = state.completedParts
                .sorted { $0.partNumber < $1.partNumber }
                .map { MultipartCompletePart(partNumber: $0.partNumber, etag: $0.etag) }

            NSLog("[Upload] Completing multipart upload with %d parts", parts.count)
            try await api.completeMultipartUpload(uploadId: state.uploadId, key: state.key, parts: parts)
            NSLog("[Upload] Multipart upload complete for %@", state.filename)

            _ = try await api.completeUpload(key: state.key, filename: state.filename)

            await MainActor.run {
                NotificationCenter.default.post(name: .videoAdded, object: nil)
            }
            NSLog("[Upload] Complete: %@", state.filename)

            // Clean up
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: state.sourceFileURL))
            clearState()
        } catch {
            let errorDetail = describeUploadError(error)
            NSLog("[Upload] Failed to finalize upload: %@", errorDetail)
            await MainActor.run {
                NotificationCenter.default.post(
                    name: .uploadFailed,
                    object: nil,
                    userInfo: ["filename": state.filename, "error": errorDetail]
                )
            }
        }
    }

    // MARK: - URLSessionDataDelegate

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard let partNumber = taskToPartMap.removeValue(forKey: task.taskIdentifier) else {
            lock.unlock()
            return
        }
        inFlightCount = max(0, inFlightCount - 1)
        lock.unlock()

        // Clean up chunk file
        let chunkFile = chunksDir.appendingPathComponent("part-\(partNumber).tmp")
        try? FileManager.default.removeItem(at: chunkFile)

        if let error = error {
            NSLog("[Upload] Part %d failed: %@", partNumber, error.localizedDescription)
            // Put part back for retry
            lock.lock()
            if let current = uploadState?.nextPart {
                uploadState?.nextPart = min(current, partNumber)
            }
            lock.unlock()
            saveState()

            withBackgroundTask(name: "retryPart") {
                await self.scheduleNextBatch()
            }
            return
        }

        guard let response = task.response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode),
              let etag = response.value(forHTTPHeaderField: "ETag") else {
            let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
            NSLog("[Upload] Part %d bad response (status %d) or missing ETag", partNumber, status)
            lock.lock()
            if let current = uploadState?.nextPart {
                uploadState?.nextPart = min(current, partNumber)
            }
            lock.unlock()
            saveState()
            return
        }

        NSLog("[Upload] Part %d uploaded (ETag: %@)", partNumber, etag)

        lock.lock()
        uploadState?.completedParts.append(UploadState.CompletedPart(partNumber: partNumber, etag: etag))
        let allDone = uploadState?.allPartsUploaded ?? false
        let total = uploadState?.totalParts ?? 0
        let completed = uploadState?.completedParts.count ?? 0
        lock.unlock()
        saveState()

        NSLog("[Upload] Progress: %d/%d parts", completed, total)

        if allDone {
            withBackgroundTask(name: "finalizeUpload") {
                await self.finalizeUpload()
            }
        } else {
            withBackgroundTask(name: "scheduleNext") {
                await self.scheduleNextBatch()
            }
        }
    }

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        #if DEBUG
        if challenge.protectionSpace.host == "localhost",
           let trust = challenge.protectionSpace.serverTrust {
            return (.useCredential, URLCredential(trust: trust))
        }
        #endif
        return (.performDefaultHandling, nil)
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        NSLog("[Upload] All background session events delivered")
        DispatchQueue.main.async { [weak self] in
            self?.systemCompletionHandler?()
            self?.systemCompletionHandler = nil
        }
    }

    // MARK: - Helpers

    /// Wraps an async block in a UIBackgroundTask for extended execution time.
    private func withBackgroundTask(name: String, block: @escaping () async -> Void) {
        var bgTaskId = UIBackgroundTaskIdentifier.invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: name) {
            UIApplication.shared.endBackgroundTask(bgTaskId)
        }
        Task {
            await block()
            UIApplication.shared.endBackgroundTask(bgTaskId)
        }
    }

    private func describeUploadError(_ error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .statusCode(let code):
                switch code {
                case 401: return "Authentication expired. Please sign out and sign back in."
                case 413: return "File is too large for the server to accept."
                case 500: return "Server error. Please try again later."
                default: return "Server returned HTTP \(code)."
                }
            case .serverError(let code, let response):
                return "Server error (\(code)): \(response.error)"
            }
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorNotConnectedToInternet:
                return "No internet connection."
            case NSURLErrorTimedOut:
                return "Upload timed out. Check your connection and try again."
            case NSURLErrorNetworkConnectionLost:
                return "Connection lost during upload. Please try again."
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted:
                return "Secure connection failed."
            default:
                return "Network error: \(error.localizedDescription)"
            }
        }

        return error.localizedDescription
    }

    func importFromURL(api: APIClient, url: String, transcript: String?, transcriptSegments: [[String: AnyCodable]]?, transcriptSource: String?, captionError: String?) {
        Thread.detachNewThread { [weak self] in
            let semaphore = DispatchSemaphore(value: 0)

            Task { @MainActor in
                NotificationCenter.default.post(
                    name: .uploadStarted,
                    object: nil,
                    userInfo: ["filename": url]
                )
            }

            Task {
                do {
                    _ = try await api.importVideoFromURL(
                        url: url,
                        transcript: transcript,
                        transcriptSegments: transcriptSegments,
                        transcriptSource: transcriptSource,
                        captionError: captionError
                    )
                    await MainActor.run {
                        NotificationCenter.default.post(name: .videoAdded, object: nil)
                    }
                    NSLog("[Upload] URL import complete: %@", url)
                } catch {
                    if !(error is CancellationError) {
                        let errorDetail = self?.describeUploadError(error) ?? error.localizedDescription
                        NSLog("[Upload] URL import failed: %@ (detail: %@)", error.localizedDescription, errorDetail)
                        await MainActor.run {
                            NotificationCenter.default.post(
                                name: .uploadFailed,
                                object: nil,
                                userInfo: [
                                    "filename": url,
                                    "error": errorDetail,
                                ]
                            )
                        }
                    }
                }
                semaphore.signal()
            }

            semaphore.wait()
        }
    }
}

// MARK: - ViewModel

@MainActor
public final class AddVideoViewModel: ObservableObject {
    enum ImportMode: String, CaseIterable {
        case url = "Import URL"
        case file = "Upload File"
    }

    @Published var selectedMode: ImportMode = .url
    @Published var urlText = ""
    @Published var isImporting = false
    @Published var errorMessage: String?
    @Published var selectedPhotoItem: PhotosPickerItem?
    @Published var selectedFileName: String?
    @Published var uploadProgress: String?
    @Published var readyToDismiss = false

    let api: APIClient
    var onVideoAdded: (() -> Void)?

    init(api: APIClient, onVideoAdded: (() -> Void)? = nil) {
        self.api = api
        self.onVideoAdded = onVideoAdded
    }

    var canImportURL: Bool {
        !urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && urlText.lowercased().hasPrefix("http")
    }

    // MARK: - URL Import

    func importFromURL() async {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isImporting = true
        uploadProgress = "Importing video..."

        // For YouTube URLs, fetch captions client-side (residential IP bypasses bot detection)
        var transcript: String?
        var transcriptSegments: [[String: AnyCodable]]?
        var transcriptSource: String?
        var captionError: String?

        if YouTubeCaptionService.isYouTubeURL(trimmed),
           let videoId = YouTubeCaptionService.extractVideoId(from: trimmed) {
            uploadProgress = "Fetching captions..."

            // Get Google access token for authenticated innertube requests
            var googleAccessToken: String?
            let hasGoogleSession = GIDSignIn.sharedInstance.currentUser != nil
            if let gidUser = GIDSignIn.sharedInstance.currentUser {
                do {
                    let refreshed = try await gidUser.refreshTokensIfNeeded()
                    googleAccessToken = refreshed.accessToken.tokenString
                    print("[AddVideo] Google token available (scopes: \(gidUser.grantedScopes?.joined(separator: ", ") ?? "none"))")
                } catch {
                    captionError = "token-refresh-failed: \(error.localizedDescription)"
                    print("[AddVideo] Could not refresh Google token: \(error)")
                }
            } else {
                print("[AddVideo] No Google session available (hasGoogleSession=\(hasGoogleSession))")
            }

            let captionService = YouTubeCaptionService()
            if let captions = await captionService.fetchCaptions(videoId: videoId, accessToken: googleAccessToken) {
                transcript = captions.transcript
                transcriptSegments = captions.segments.map { segment in
                    segment.mapValues { AnyCodable($0) }
                }
                transcriptSource = captions.source
                print("[AddVideo] Captions fetched: \(captions.segments.count) segments (\(captions.source))")
            } else {
                captionError = captionError ?? captionService.lastError ?? "unknown"
                print("[AddVideo] Caption fetch failed: \(captionError!)")
            }
        }

        // Hand off to background service — survives modal dismissal
        BackgroundUploadService.shared.importFromURL(
            api: api,
            url: trimmed,
            transcript: transcript,
            transcriptSegments: transcriptSegments,
            transcriptSource: transcriptSource,
            captionError: captionError
        )

        // Dismiss the modal immediately
        onVideoAdded?()
        NotificationCenter.default.post(name: .videoAdded, object: nil)
        readyToDismiss = true
    }

    // MARK: - File Upload

    func handleSelectedPhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }

        // Dismiss immediately — loading + upload happens entirely in background
        BackgroundUploadService.shared.loadAndUploadVideo(api: api, item: item)

        onVideoAdded?()
        NotificationCenter.default.post(name: .videoAdded, object: nil)
        readyToDismiss = true
    }
}

// MARK: - Video Transferable

struct VideoTransferable: Transferable {
    let fileURL: URL
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { receivedFile in
            // Copy to a temp location we control (the received file is cleaned up by the system)
            let filename = "video-\(UUID().uuidString.prefix(8)).mp4"
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            try FileManager.default.copyItem(at: receivedFile.file, to: dest)
            return VideoTransferable(fileURL: dest, filename: filename)
        }
    }
}

// MARK: - View

public struct AddVideoView: View {
    @StateObject private var viewModel: AddVideoViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showErrorAlert = false

    public init(api: APIClient, onVideoAdded: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: AddVideoViewModel(api: api, onVideoAdded: onVideoAdded))
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                modePicker
                Divider()
                modeContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Add Video")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(viewModel.isImporting)
                }
            }
            .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .disabled(viewModel.isImporting && !viewModel.readyToDismiss)
            .onChange(of: viewModel.readyToDismiss) { _, ready in
                if ready { dismiss() }
            }
        }
    }

    // MARK: - Subviews

    private var modePicker: some View {
        Picker("Mode", selection: $viewModel.selectedMode) {
            ForEach(AddVideoViewModel.ImportMode.allCases, id: \.self) { mode in
                Text(mode.rawValue).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .padding(DesignTokens.spacing)
    }

    @ViewBuilder
    private var modeContent: some View {
        switch viewModel.selectedMode {
        case .url:
            urlImportContent
        case .file:
            fileUploadContent
        }
    }

    private var urlImportContent: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Spacer()

            VStack(spacing: DesignTokens.spacing) {
                Image(systemName: "link")
                    .font(.system(size: 40))
                    .foregroundStyle(DesignTokens.accent)

                Text("Import from URL")
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Paste a YouTube or direct video link")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            TextField("https://...", text: $viewModel.urlText)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .padding(.horizontal, DesignTokens.largeSpacing)

            importButton

            Spacer()
        }
    }

    private var importButton: some View {
        Button {
            Task {
                await viewModel.importFromURL()
            }
        } label: {
            HStack(spacing: 8) {
                if viewModel.isImporting {
                    ProgressView()
                        .tint(.white)
                        .controlSize(.small)
                }
                Text(viewModel.uploadProgress ?? "Import Video")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .tint(DesignTokens.accent)
        .disabled(!viewModel.canImportURL || viewModel.isImporting)
        .padding(.horizontal, DesignTokens.largeSpacing)
    }

    private var fileUploadContent: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Spacer()

            if viewModel.isImporting {
                uploadingState
            } else {
                pickVideoState
            }

            Spacer()
        }
    }

    private var pickVideoState: some View {
        VStack(spacing: DesignTokens.spacing) {
            Image(systemName: "arrow.up.doc.fill")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.accent)

            Text("Upload a Video")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Select a video from your photo library")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)

            PhotosPicker(
                selection: $viewModel.selectedPhotoItem,
                matching: .videos
            ) {
                HStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle.angled")
                    Text("Choose Video")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.accent)
            .padding(.horizontal, DesignTokens.largeSpacing)
            .onChange(of: viewModel.selectedPhotoItem) { _, newItem in
                Task {
                    await viewModel.handleSelectedPhoto(newItem)
                    viewModel.selectedPhotoItem = nil
                }
            }
        }
    }

    private var uploadingState: some View {
        VStack(spacing: DesignTokens.spacing) {
            ProgressView()
                .controlSize(.large)

            if let progress = viewModel.uploadProgress {
                Text(progress)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
            }

            if let name = viewModel.selectedFileName {
                Text(name)
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(1)
            }
        }
    }
}
