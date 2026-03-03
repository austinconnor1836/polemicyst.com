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
                    List(viewModel.videos) { video in
                        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                            Text(video.title ?? "Untitled video")
                                .font(.headline)
                                .foregroundStyle(DesignTokens.textPrimary)
                            if let feedName = video.feed?.name {
                                Text(feedName)
                                    .font(.subheadline)
                                    .foregroundStyle(DesignTokens.textSecondary)
                            }
                            if let transcript = video.transcript, !transcript.isEmpty {
                                Text(transcript)
                                    .font(.footnote)
                                    .foregroundStyle(DesignTokens.textSecondary)
                                    .lineLimit(2)
                            }

                            Button {
                                Task {
                                    await viewModel.triggerClip(
                                        for: video,
                                        userId: video.feed?.userId ?? ""
                                    )
                                }
                            } label: {
                                Label("Generate Clip", systemImage: "bolt.fill")
                                    .font(.caption)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 4)
                                    .background(DesignTokens.accent.opacity(0.15))
                                    .foregroundStyle(DesignTokens.accent)
                                    .cornerRadius(6)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, DesignTokens.smallSpacing)
                        .listRowBackground(DesignTokens.surface)
                    }
                    .listStyle(.plain)
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
