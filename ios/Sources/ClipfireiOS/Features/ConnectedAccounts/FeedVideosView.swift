import SwiftUI

@MainActor
public final class FeedVideosViewModel: ObservableObject {
    @Published public private(set) var videos: [FeedVideo] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var clipResultMessage: String?
    @Published public private(set) var deletingVideoId: String?

    let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    private var pollTask: Task<Void, Never>?

    public func load() async {
        if ScreenshotMode.isActive {
            videos = MockData.feedVideos
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            videos = try await api.fetchFeedVideos()
            startPollingIfNeeded()
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Unable to load feed videos: \(error.localizedDescription)"
        }
    }

    func startPollingIfNeeded() {
        pollTask?.cancel()
        pollTask = nil

        let hasProcessing = videos.contains { $0.transcript == nil }
        guard hasProcessing else { return }

        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                do {
                    let updated = try await self?.api.fetchFeedVideos()
                    if let updated {
                        await MainActor.run { self?.videos = updated }
                        let stillProcessing = updated.contains { $0.transcript == nil }
                        if !stillProcessing { break }
                    }
                } catch {
                    break
                }
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    public func removeVideo(id: String) {
        videos.removeAll { $0.id == id }
    }

    public func deleteFeedVideo(_ video: FeedVideo) async {
        deletingVideoId = video.id
        do {
            try await api.deleteFeedVideo(id: video.id)
            withAnimation { videos.removeAll { $0.id == video.id } }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to delete video: \(error.localizedDescription)"
        }
        deletingVideoId = nil
    }

    public func triggerClip(for video: FeedVideo, userId: String) async {
        let request = TriggerClipRequest(feedVideoId: video.id, userId: userId)
        do {
            let response = try await api.triggerClip(request)
            clipResultMessage = response.message
        } catch let error as APIError {
            if error.isUpgradeRequired {
                upgradeError = error
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to trigger clip generation: \(error.localizedDescription)"
        }
    }
}

public struct FeedVideosView: View {
    @StateObject private var viewModel: FeedVideosViewModel
    @State private var showGenerateSheet = false
    @State private var videoToDelete: FeedVideo?
    @State private var showErrorAlert = false
    @State private var showClipResultAlert = false
    @State private var showDeleteAlert = false
    @State private var uploadStatusMessage: String?
    @State private var uploadIsError = false

    public init(viewModel: FeedVideosViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    private let columns = [
        GridItem(.adaptive(minimum: 160), spacing: DesignTokens.spacing)
    ]

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let uploadStatusMessage {
                    uploadStatusBanner(message: uploadStatusMessage, isError: uploadIsError)
                }
                gridContent
            }
                .background(DesignTokens.background.ignoresSafeArea())
                .navigationTitle("Videos")
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showGenerateSheet = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                        }
                    }
                }
                .sheet(isPresented: $showGenerateSheet) {
                    AddVideoView(api: viewModel.api) {
                        Task { await viewModel.load() }
                    }
                }
                .task { await viewModel.load() }
                .refreshable { await viewModel.load() }
                .onReceive(NotificationCenter.default.publisher(for: .videoAdded)) { _ in
                    withAnimation { uploadStatusMessage = nil }
                    Task { await viewModel.load() }
                }
                .onReceive(NotificationCenter.default.publisher(for: .uploadStarted)) { notification in
                    let filename = notification.userInfo?["filename"] as? String ?? "video"
                    let displayName = filename.count > 40 ? String(filename.prefix(40)) + "…" : filename
                    withAnimation {
                        uploadIsError = false
                        uploadStatusMessage = "Uploading \(displayName)…"
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .uploadFailed)) { notification in
                    let error = notification.userInfo?["error"] as? String ?? "Unknown error"
                    withAnimation {
                        uploadIsError = true
                        uploadStatusMessage = "Upload failed: \(error)"
                    }
                }
                .overlay {
                    if viewModel.isLoading && viewModel.videos.isEmpty {
                        ProgressView().progressViewStyle(.circular)
                    }
                }
                .modifier(FeedVideosAlerts(
                    viewModel: viewModel,
                    showErrorAlert: $showErrorAlert,
                    showClipResultAlert: $showClipResultAlert,
                    showDeleteAlert: $showDeleteAlert,
                    videoToDelete: $videoToDelete
                ))
        }
    }

    private func uploadStatusBanner(message: String, isError: Bool) -> some View {
        HStack(spacing: 8) {
            if isError {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.white)
            } else {
                ProgressView()
                    .tint(.white)
                    .controlSize(.small)
            }
            Text(message)
                .font(.footnote)
                .fontWeight(.medium)
                .foregroundStyle(.white)
                .lineLimit(2)
            Spacer()
            if isError {
                Button {
                    withAnimation { uploadStatusMessage = nil }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.white.opacity(0.8))
                }
            }
        }
        .padding(.horizontal, DesignTokens.spacing)
        .padding(.vertical, 10)
        .background(isError ? Color.red : DesignTokens.accent)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    @ViewBuilder
    private var gridContent: some View {
        if viewModel.videos.isEmpty && !viewModel.isLoading {
            VStack(spacing: DesignTokens.spacing) {
                Image(systemName: "video.slash")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.muted)
                Text("No videos")
                    .font(.title3)
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Videos will appear here once your connected accounts are polled.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: DesignTokens.spacing) {
                    ForEach(viewModel.videos) { video in
                        gridCell(for: video)
                    }
                }
                .padding(DesignTokens.spacing)
            }
            .navigationDestination(for: String.self) { videoId in
                FeedVideoDetailView(
                    api: viewModel.api,
                    feedVideoId: videoId,
                    onDelete: {
                        viewModel.removeVideo(id: videoId)
                    }
                )
            }
        }
    }

    private func gridCell(for video: FeedVideo) -> some View {
        let isDeleting = viewModel.deletingVideoId == video.id
        let isProcessing = video.transcript == nil
        return NavigationLink(value: video.id) {
            VideoGridCell(
                title: video.title ?? "Untitled video",
                subtitle: isProcessing ? "Transcribing..." : video.feed?.name,
                thumbnailUrl: video.resolvedThumbnailUrl,
                videoUrl: video.s3Url.flatMap { URL(string: $0) },
                placeholderIcon: "video.fill",
                isProcessing: isProcessing
            )
                .overlay(alignment: .topTrailing) {
                    Button {
                        videoToDelete = video
                        showDeleteAlert = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .black.opacity(0.6))
                    }
                    .padding(6)
                }
                .overlay {
                    if isDeleting {
                        ZStack {
                            RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                                .fill(.black.opacity(0.5))
                            VStack(spacing: 6) {
                                ProgressView()
                                    .tint(.white)
                                Text("Deleting...")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(isDeleting)
    }
}

// MARK: - Alerts modifier (extracted to help Swift type-checker)

private struct FeedVideosAlerts: ViewModifier {
    @ObservedObject var viewModel: FeedVideosViewModel
    @Binding var showErrorAlert: Bool
    @Binding var showClipResultAlert: Bool
    @Binding var showDeleteAlert: Bool
    @Binding var videoToDelete: FeedVideo?

    func body(content: Content) -> some View {
        content
            .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .onChange(of: viewModel.clipResultMessage) { _, newValue in showClipResultAlert = newValue != nil }
            .alert("Clip Generation", isPresented: $showClipResultAlert) {
                Button("OK", role: .cancel) { viewModel.clipResultMessage = nil }
            } message: {
                Text(viewModel.clipResultMessage ?? "")
            }
            .alert("Delete Video", isPresented: $showDeleteAlert, presenting: videoToDelete) { video in
                Button("Delete", role: .destructive) {
                    Task { await viewModel.deleteFeedVideo(video) }
                }
                Button("Cancel", role: .cancel) { }
            } message: { _ in
                Text("Are you sure you want to delete this video? This action cannot be undone.")
            }
            .sheet(item: $viewModel.upgradeError) { error in
                UpgradePromptView(
                    message: error.localizedDescription,
                    quotaLimit: error.quotaLimit,
                    quotaUsage: error.quotaUsage,
                    onDismiss: { viewModel.upgradeError = nil }
                )
                .presentationDetents([.medium])
            }
    }
}

