import SwiftUI

@MainActor
public final class FeedVideosViewModel: ObservableObject {
    @Published public private(set) var videos: [FeedVideo] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var clipResultMessage: String?

    let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            videos = try await api.fetchFeedVideos()
        } catch {
            errorMessage = "Unable to load feed videos"
        }
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
            errorMessage = "Failed to trigger clip generation"
        }
    }
}

public struct FeedVideosView: View {
    @StateObject private var viewModel: FeedVideosViewModel
    @State private var showGenerateSheet = false

    public init(viewModel: FeedVideosViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    private let columns = [
        GridItem(.adaptive(minimum: 160), spacing: DesignTokens.spacing)
    ]

    public var body: some View {
        NavigationStack {
            Group {
                if viewModel.videos.isEmpty && !viewModel.isLoading {
                    VStack(spacing: DesignTokens.spacing) {
                        Image(systemName: "video.slash")
                            .font(.system(size: 48))
                            .foregroundStyle(DesignTokens.muted)
                        Text("No feed videos")
                            .font(.title3)
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Videos will appear here once your feeds are polled.")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: DesignTokens.spacing) {
                            ForEach(viewModel.videos) { video in
                                NavigationLink(value: video.id) {
                                    VideoGridCell(video: video)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(DesignTokens.spacing)
                    }
                    .navigationDestination(for: String.self) { videoId in
                        FeedVideoDetailView(api: viewModel.api, feedVideoId: videoId)
                    }
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Feed Videos")
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
                ClipGenerationView(
                    viewModel: ClipGenerationViewModel(api: viewModel.api)
                )
            }
            .task { await viewModel.load() }
            .refreshable { await viewModel.load() }
            .overlay {
                if viewModel.isLoading && viewModel.videos.isEmpty {
                    ProgressView().progressViewStyle(.circular)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .alert("Clip Generation", isPresented: .constant(viewModel.clipResultMessage != nil)) {
                Button("OK", role: .cancel) { viewModel.clipResultMessage = nil }
            } message: {
                Text(viewModel.clipResultMessage ?? "")
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
