import SwiftUI
import PhotosUI
import GoogleSignIn

extension Notification.Name {
    static let videoAdded = Notification.Name("videoAdded")
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

    func importFromURL() async -> Bool {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        isImporting = true
        uploadProgress = "Importing video..."
        defer {
            isImporting = false
            uploadProgress = nil
        }

        do {
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
                uploadProgress = "Importing video..."
            }

            _ = try await api.importVideoFromURL(
                url: trimmed,
                transcript: transcript,
                transcriptSegments: transcriptSegments,
                transcriptSource: transcriptSource,
                captionError: captionError
            )
            onVideoAdded?()
            NotificationCenter.default.post(name: .videoAdded, object: nil)
            return true
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return false }
            errorMessage = "Failed to import video: \(error.localizedDescription)"
            return false
        }
    }

    // MARK: - File Upload

    /// Loads video data, then signals the caller to dismiss the modal.
    /// Returns the loaded data so the caller can start the background upload.
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

        let data = movie.data
        let filename = movie.filename
        selectedFileName = filename

        // Signal the modal to dismiss — upload continues in background
        onVideoAdded?()
        NotificationCenter.default.post(name: .videoAdded, object: nil)
        readyToDismiss = true

        // Continue upload in background after modal dismisses
        await performBackgroundUpload(data: data, filename: filename)
    }

    /// Performs the S3 upload + backend registration in the background.
    /// The modal is already dismissed at this point.
    private func performBackgroundUpload(data: Data, filename: String) async {
        do {
            let contentType = filename.hasSuffix(".mov") ? "video/quicktime" : "video/mp4"
            let presigned = try await api.getPresignedUploadURL(filename: filename, contentType: contentType)

            guard let presignedURL = URL(string: presigned.url) else {
                print("[Upload] Invalid presigned URL")
                return
            }

            try await api.uploadToPresignedURL(presignedURL, fileData: data, contentType: contentType)

            // Register with backend — this auto-queues transcription
            _ = try await api.completeUpload(key: presigned.key, filename: filename)

            // Notify Videos tab to refresh (will pick up the new video with server-generated data)
            NotificationCenter.default.post(name: .videoAdded, object: nil)
            print("[Upload] Complete: \(filename)")
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            print("[Upload] Background upload failed: \(error.localizedDescription)")
        }

        isImporting = false
        uploadProgress = nil
    }
}

// MARK: - Video Transferable

struct VideoTransferable: Transferable {
    let data: Data
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(importedContentType: .movie) { data in
            VideoTransferable(data: data, filename: "video-\(UUID().uuidString.prefix(8)).mp4")
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
            .disabled(viewModel.isImporting)
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
                if await viewModel.importFromURL() {
                    dismiss()
                }
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
            .onChange(of: viewModel.readyToDismiss) { _, ready in
                if ready { dismiss() }
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
