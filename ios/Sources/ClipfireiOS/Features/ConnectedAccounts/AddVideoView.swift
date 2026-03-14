import SwiftUI
import PhotosUI
import GoogleSignIn

extension Notification.Name {
    static let videoAdded = Notification.Name("videoAdded")
    static let uploadFailed = Notification.Name("uploadFailed")
    static let uploadStarted = Notification.Name("uploadStarted")
}

// MARK: - Background Upload Service

/// Singleton that performs uploads outside the SwiftUI view lifecycle.
/// Uses its own URLSession so uploads survive modal dismissal.
final class BackgroundUploadService: NSObject, URLSessionDelegate {
    static let shared = BackgroundUploadService()

    private lazy var uploadSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() { super.init() }

    // Accept self-signed certs for localhost in debug builds
    func urlSession(
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

    /// 10 MB chunk size (matching web client)
    private static let chunkSize = 10 * 1024 * 1024
    /// Max concurrent part uploads (matching web client)
    private static let maxConcurrency = 4

    func uploadVideo(api: APIClient, fileURL: URL, filename: String) {
        // Use a plain Thread + semaphore approach to completely escape structured concurrency
        Thread.detachNewThread { [weak self] in
            guard let self else { return }
            let semaphore = DispatchSemaphore(value: 0)

            Task { @MainActor in
                let fileSize = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0
                NotificationCenter.default.post(
                    name: .uploadStarted,
                    object: nil,
                    userInfo: ["filename": filename, "size": fileSize]
                )
            }

            Task {
                defer {
                    // Clean up temp file
                    try? FileManager.default.removeItem(at: fileURL)
                }
                do {
                    let contentType = filename.hasSuffix(".mov") ? "video/quicktime" : "video/mp4"
                    let fileSize = try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int ?? 0
                    let totalParts = (fileSize + Self.chunkSize - 1) / Self.chunkSize

                    // 1. Initiate multipart upload
                    NSLog("[Upload] Initiating multipart upload: %d bytes (%d parts), contentType=%@", fileSize, totalParts, contentType)
                    let initResponse = try await api.initiateMultipartUpload(filename: filename, contentType: contentType)
                    let uploadId = initResponse.uploadId
                    let key = initResponse.key
                    NSLog("[Upload] Multipart initiated: uploadId=%@, key=%@", uploadId, key)

                    // 2. Upload parts with concurrency limit (reads chunks from disk)
                    let completedParts = try await self.uploadParts(
                        api: api,
                        fileURL: fileURL,
                        fileSize: fileSize,
                        uploadId: uploadId,
                        key: key,
                        contentType: contentType,
                        totalParts: totalParts
                    )

                    // 3. Complete multipart upload
                    NSLog("[Upload] Completing multipart upload with %d parts", completedParts.count)
                    try await api.completeMultipartUpload(uploadId: uploadId, key: key, parts: completedParts)
                    NSLog("[Upload] Multipart upload complete for %@", filename)

                    // 4. Register with backend
                    _ = try await api.completeUpload(key: key, filename: filename)

                    await MainActor.run {
                        NotificationCenter.default.post(name: .videoAdded, object: nil)
                    }
                    NSLog("[Upload] Complete: %@", filename)
                } catch {
                    let errorDetail = self.describeUploadError(error)
                    NSLog("[Upload] Background upload failed: %@ (detail: %@)", error.localizedDescription, errorDetail)
                    await MainActor.run {
                        NotificationCenter.default.post(
                            name: .uploadFailed,
                            object: nil,
                            userInfo: [
                                "filename": filename,
                                "error": errorDetail,
                            ]
                        )
                    }
                }
                semaphore.signal()
            }

            semaphore.wait()
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

    private func uploadParts(
        api: APIClient,
        fileURL: URL,
        fileSize: Int,
        uploadId: String,
        key: String,
        contentType: String,
        totalParts: Int
    ) async throws -> [MultipartCompletePart] {
        return try await withThrowingTaskGroup(of: MultipartCompletePart.self) { group in
            var completedParts: [MultipartCompletePart] = []
            var nextPart = 1

            // Seed initial batch
            for _ in 0..<min(Self.maxConcurrency, totalParts) {
                let partNumber = nextPart
                nextPart += 1
                group.addTask {
                    try await self.uploadSinglePart(
                        api: api,
                        fileURL: fileURL,
                        fileSize: fileSize,
                        uploadId: uploadId,
                        key: key,
                        contentType: contentType,
                        partNumber: partNumber,
                        totalParts: totalParts
                    )
                }
            }

            // As each completes, add the next
            for try await part in group {
                completedParts.append(part)
                if nextPart <= totalParts {
                    let partNumber = nextPart
                    nextPart += 1
                    group.addTask {
                        try await self.uploadSinglePart(
                            api: api,
                            fileURL: fileURL,
                            fileSize: fileSize,
                            uploadId: uploadId,
                            key: key,
                            contentType: contentType,
                            partNumber: partNumber,
                            totalParts: totalParts
                        )
                    }
                }
            }

            return completedParts.sorted { $0.PartNumber < $1.PartNumber }
        }
    }

    private func uploadSinglePart(
        api: APIClient,
        fileURL: URL,
        fileSize: Int,
        uploadId: String,
        key: String,
        contentType: String,
        partNumber: Int,
        totalParts: Int
    ) async throws -> MultipartCompletePart {
        // Read only this chunk from disk (avoids loading entire file into memory)
        let offset = (partNumber - 1) * Self.chunkSize
        let length = min(Self.chunkSize, fileSize - offset)

        let fileHandle = try FileHandle(forReadingFrom: fileURL)
        defer { try? fileHandle.close() }
        try fileHandle.seek(toOffset: UInt64(offset))
        guard let chunk = try fileHandle.read(upToCount: length) else {
            throw APIError.statusCode(500)
        }

        // Get presigned URL for this part
        let partURLResponse = try await api.getMultipartPartURL(uploadId: uploadId, key: key, partNumber: partNumber)
        guard let partURL = URL(string: partURLResponse.url) else {
            throw APIError.statusCode(500)
        }

        // Upload chunk to S3
        var request = URLRequest(url: partURL)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        let (_, response) = try await self.uploadSession.upload(for: request, from: chunk)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            NSLog("[Upload] Part %d/%d failed with status %d", partNumber, totalParts, statusCode)
            throw APIError.statusCode(statusCode)
        }

        // Extract ETag from response headers
        guard let etag = http.value(forHTTPHeaderField: "ETag") else {
            NSLog("[Upload] Part %d/%d missing ETag header", partNumber, totalParts)
            throw APIError.statusCode(500)
        }

        NSLog("[Upload] Part %d/%d uploaded (%d bytes)", partNumber, totalParts, chunk.count)
        return MultipartCompletePart(partNumber: partNumber, etag: etag)
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

        isImporting = true
        uploadProgress = "Loading video..."

        guard let movie = try? await item.loadTransferable(type: VideoTransferable.self) else {
            errorMessage = "Unable to load selected video"
            isImporting = false
            uploadProgress = nil
            return
        }

        let filename = movie.filename
        selectedFileName = filename

        // Hand off to background service — reads chunks from disk, survives modal dismissal
        BackgroundUploadService.shared.uploadVideo(api: api, fileURL: movie.fileURL, filename: filename)

        // Signal the modal to dismiss
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
