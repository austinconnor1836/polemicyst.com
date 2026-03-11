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

    public func load() async {
        if ScreenshotMode.isActive {
            videos = MockData.feedVideos
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            videos = try await api.fetchFeedVideos()
        } catch {
            errorMessage = "Unable to load feed videos: \(error.localizedDescription)"
        }
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
            errorMessage = "Failed to trigger clip generation: \(error.localizedDescription)"
        }
    }
}

public struct FeedVideosView: View {
    @StateObject private var viewModel: FeedVideosViewModel
    @State private var showGenerateSheet = false
    @State private var videoToDelete: FeedVideo?

    public init(viewModel: FeedVideosViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    private let columns = [
        GridItem(.adaptive(minimum: 160), spacing: DesignTokens.spacing)
    ]

    public var body: some View {
        NavigationStack {
            gridContent
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
                .overlay {
                    if viewModel.isLoading && viewModel.videos.isEmpty {
                        ProgressView().progressViewStyle(.circular)
                    }
                }
                .alert("Error", isPresented: Binding(
                    get: { viewModel.errorMessage != nil },
                    set: { if !$0 { viewModel.errorMessage = nil } }
                )) {
                    Button("OK", role: .cancel) { }
                } message: {
                    Text(viewModel.errorMessage ?? "")
                }
                .alert("Clip Generation", isPresented: Binding(
                    get: { viewModel.clipResultMessage != nil },
                    set: { if !$0 { viewModel.clipResultMessage = nil } }
                )) {
                    Button("OK", role: .cancel) { }
                } message: {
                    Text(viewModel.clipResultMessage ?? "")
                }
                .alert("Delete Video", isPresented: Binding(
                    get: { videoToDelete != nil },
                    set: { if !$0 { videoToDelete = nil } }
                )) {
                    Button("Delete", role: .destructive) {
                        if let video = videoToDelete {
                            Task { await viewModel.deleteFeedVideo(video) }
                        }
                    }
                    Button("Cancel", role: .cancel) { }
                } message: {
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
        return NavigationLink(value: video.id) {
            VideoGridCell(video: video)
                .overlay(alignment: .topTrailing) {
                    Button {
                        videoToDelete = video
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

// MARK: - Grid Cell

private struct VideoGridCell: View {
    let video: FeedVideo

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Thumbnail
            if let url = video.resolvedThumbnailUrl {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(16 / 9, contentMode: .fill)
                    case .failure:
                        thumbnailPlaceholder
                    case .empty:
                        ZStack {
                            thumbnailPlaceholder
                            ProgressView()
                                .tint(DesignTokens.muted)
                        }
                    @unknown default:
                        thumbnailPlaceholder
                    }
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipped()
            } else {
                thumbnailPlaceholder
            }

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(video.title ?? "Untitled video")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(2)

                if let feedName = video.feed?.name {
                    Text(feedName)
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(1)
                }
            }
            .padding(DesignTokens.smallSpacing)
        }
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var thumbnailPlaceholder: some View {
        ZStack {
            Rectangle()
                .fill(DesignTokens.background)
                .aspectRatio(16 / 9, contentMode: .fit)
            Image(systemName: "video.fill")
                .font(.title2)
                .foregroundStyle(DesignTokens.muted)
        }
    }
}
