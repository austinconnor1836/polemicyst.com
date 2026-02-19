import SwiftUI

@MainActor
public final class FeedVideosViewModel: ObservableObject {
    @Published public private(set) var videos: [FeedVideo] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?

    private let api: APIClient

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
}

public struct FeedVideosView: View {
    @StateObject private var viewModel: FeedVideosViewModel

    public init(viewModel: FeedVideosViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
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
                }
                .padding(.vertical, DesignTokens.smallSpacing)
                .listRowBackground(DesignTokens.surface)
            }
            .listStyle(.plain)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Feed Videos")
            .task { await viewModel.load() }
            .overlay {
                if viewModel.isLoading {
                    ProgressView().progressViewStyle(.circular)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }
}
