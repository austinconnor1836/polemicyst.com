import SwiftUI

// MARK: - ViewModel

@MainActor
public final class FeedVideoDetailViewModel: ObservableObject {
    @Published public private(set) var detail: FeedVideoDetailResponse?
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var clipResultMessage: String?
    @Published public private(set) var isGenerating = false

    let api: APIClient
    let feedVideoId: String
    private var pollTask: Task<Void, Never>?

    public init(api: APIClient, feedVideoId: String) {
        self.api = api
        self.feedVideoId = feedVideoId
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await api.fetchFeedVideoDetail(id: feedVideoId)
            startPollingIfNeeded()
        } catch {
            errorMessage = "Unable to load video details"
        }
    }

    public func triggerClip() async {
        guard let userId = detail?.feedVideo.userId else { return }
        isGenerating = true
        defer { isGenerating = false }
        let request = TriggerClipRequest(feedVideoId: feedVideoId, userId: userId)
        do {
            let response = try await api.triggerClip(request)
            clipResultMessage = response.message
            await load()
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

    func startPollingIfNeeded() {
        pollTask?.cancel()
        pollTask = nil

        guard let state = detail?.jobState, state == "active" || state == "waiting" else { return }

        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { break }
                await self?.load()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }
}

// MARK: - View

public struct FeedVideoDetailView: View {
    @StateObject private var viewModel: FeedVideoDetailViewModel

    public init(api: APIClient, feedVideoId: String) {
        _viewModel = StateObject(wrappedValue: FeedVideoDetailViewModel(api: api, feedVideoId: feedVideoId))
    }

    public var body: some View {
        Group {
            if viewModel.isLoading && viewModel.detail == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let detail = viewModel.detail {
                contentView(detail)
            } else {
                VStack(spacing: DesignTokens.spacing) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 48))
                        .foregroundStyle(DesignTokens.muted)
                    Text("Failed to load video")
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle(viewModel.detail?.feedVideo.title ?? "Video Details")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        .onDisappear { viewModel.stopPolling() }
        .refreshable { await viewModel.load() }
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

    // MARK: - Content

    @ViewBuilder
    private func contentView(_ detail: FeedVideoDetailResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                thumbnailSection(detail.feedVideo)
                metadataSection(detail)
                transcriptSection(detail.feedVideo)
                generateSection(detail)
                clipsSection(detail.clips)
            }
            .padding(DesignTokens.spacing)
        }
    }

    // MARK: - Thumbnail

    @ViewBuilder
    private func thumbnailSection(_ video: FeedVideoDetail) -> some View {
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
                        ProgressView().tint(DesignTokens.muted)
                    }
                @unknown default:
                    thumbnailPlaceholder
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()
            .cornerRadius(DesignTokens.cornerRadius)
        } else {
            thumbnailPlaceholder
                .cornerRadius(DesignTokens.cornerRadius)
        }
    }

    private var thumbnailPlaceholder: some View {
        ZStack {
            Rectangle()
                .fill(DesignTokens.surface)
                .aspectRatio(16 / 9, contentMode: .fit)
            Image(systemName: "video.fill")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.muted)
        }
    }

    // MARK: - Metadata

    @ViewBuilder
    private func metadataSection(_ detail: FeedVideoDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text(detail.feedVideo.title ?? "Untitled video")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)

            HStack(spacing: DesignTokens.smallSpacing) {
                if let feedName = detail.feedVideo.feed?.name {
                    Label(feedName, systemImage: "antenna.radiowaves.left.and.right")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Text(detail.feedVideo.createdAt, style: .date)
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
            }

            if let jobState = detail.jobState {
                jobBadge(jobState)
            }
        }
    }

    @ViewBuilder
    private func jobBadge(_ state: String) -> some View {
        let (label, color) = jobBadgeStyle(state)
        Text(label)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .cornerRadius(6)
    }

    private func jobBadgeStyle(_ state: String) -> (String, Color) {
        switch state {
        case "completed": return ("Completed", .green)
        case "active": return ("Processing", .orange)
        case "waiting": return ("Queued", .yellow)
        case "failed": return ("Failed", .red)
        default: return (state.capitalized, DesignTokens.muted)
        }
    }

    // MARK: - Transcript

    @ViewBuilder
    private func transcriptSection(_ video: FeedVideoDetail) -> some View {
        if let transcript = video.transcript, !transcript.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                DisclosureGroup {
                    Text(transcript)
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, DesignTokens.smallSpacing)
                } label: {
                    Label("Transcript", systemImage: "text.alignleft")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .tint(DesignTokens.muted)
            }
            .padding(DesignTokens.spacing)
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
        }
    }

    // MARK: - Generate Clip

    @ViewBuilder
    private func generateSection(_ detail: FeedVideoDetailResponse) -> some View {
        let isJobRunning = detail.jobState == "active" || detail.jobState == "waiting"

        Button {
            Task { await viewModel.triggerClip() }
        } label: {
            HStack {
                if viewModel.isGenerating || isJobRunning {
                    ProgressView()
                        .tint(.white)
                        .controlSize(.small)
                }
                Text(isJobRunning ? "Generating..." : "Generate Clips")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, DesignTokens.spacing)
        }
        .buttonStyle(.borderedProminent)
        .tint(DesignTokens.accent)
        .disabled(viewModel.isGenerating || isJobRunning)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Generated Clips

    private let clipColumns = [
        GridItem(.adaptive(minimum: 150), spacing: DesignTokens.spacing)
    ]

    @ViewBuilder
    private func clipsSection(_ clips: [GeneratedClip]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Generated Clips")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if clips.isEmpty {
                VStack(spacing: DesignTokens.smallSpacing) {
                    Image(systemName: "film.stack")
                        .font(.system(size: 32))
                        .foregroundStyle(DesignTokens.muted)
                    Text("No clips yet")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, DesignTokens.largeSpacing)
            } else {
                LazyVGrid(columns: clipColumns, spacing: DesignTokens.spacing) {
                    ForEach(clips) { clip in
                        clipCard(clip)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func clipCard(_ clip: GeneratedClip) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            // Clip icon placeholder
            ZStack {
                Rectangle()
                    .fill(DesignTokens.background)
                    .aspectRatio(16 / 9, contentMode: .fit)
                Image(systemName: "film")
                    .font(.title2)
                    .foregroundStyle(DesignTokens.muted)
            }
            .cornerRadius(8)

            VStack(alignment: .leading, spacing: 2) {
                Text(clip.videoTitle ?? "Untitled clip")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(2)

                Text(formatDuration(clip.duration))
                    .font(.caption2)
                    .foregroundStyle(DesignTokens.muted)

                Text(clip.createdAt, style: .date)
                    .font(.caption2)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .padding(.horizontal, DesignTokens.smallSpacing)
            .padding(.bottom, DesignTokens.smallSpacing)
        }
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
