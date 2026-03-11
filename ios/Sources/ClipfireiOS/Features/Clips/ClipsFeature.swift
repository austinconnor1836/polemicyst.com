import AVKit
import SwiftUI

@MainActor
public final class ClipsViewModel: ObservableObject {
    @Published public private(set) var clips: [ClipVideo] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var deletingId: String?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        if ScreenshotMode.isActive {
            clips = MockData.clips
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            clips = try await api.fetchClips()
        } catch let error as APIError {
            if error.isUpgradeRequired {
                upgradeError = error
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load clips: \(error.localizedDescription)"
        }
    }

    public func deleteClip(_ clip: ClipVideo) async {
        deletingId = clip.id
        defer { deletingId = nil }
        do {
            try await api.deleteClip(id: clip.id)
            withAnimation { clips.removeAll { $0.id == clip.id } }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to delete clip: \(error.localizedDescription)"
        }
    }
}

public struct ClipsListView: View {
    @StateObject private var viewModel: ClipsViewModel
    @State private var showErrorAlert = false
    @State private var showDeleteAlert = false
    @State private var clipToDelete: ClipVideo?

    public init(viewModel: ClipsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            Group {
                if viewModel.clips.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    clipsList
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Clips")
            .task { await viewModel.load() }
            .refreshable { await viewModel.load() }
            .overlay {
                if viewModel.isLoading && viewModel.clips.isEmpty {
                    ProgressView().progressViewStyle(.circular)
                }
            }
            .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .alert("Delete Clip", isPresented: $showDeleteAlert, presenting: clipToDelete) { clip in
                Button("Delete", role: .destructive) {
                    Task { await viewModel.deleteClip(clip) }
                }
                Button("Cancel", role: .cancel) { }
            } message: { clip in
                Text("Delete \"\(clip.videoTitle ?? "this clip")\"? This cannot be undone.")
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
    private var emptyState: some View {
        VStack(spacing: DesignTokens.spacing) {
            Image(systemName: "film.stack")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.muted)
            Text("No clips yet")
                .font(.title3)
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Generate clips from your feed videos to see them here.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private let columns = [
        GridItem(.adaptive(minimum: 160), spacing: DesignTokens.spacing)
    ]

    @ViewBuilder
    private var clipsList: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: DesignTokens.spacing) {
                ForEach(viewModel.clips) { clip in
                    clipGridCell(clip)
                }
            }
            .padding(DesignTokens.spacing)
        }
        .navigationDestination(for: String.self) { clipId in
            if let clip = viewModel.clips.first(where: { $0.id == clipId }) {
                ClipDetailView(clip: clip)
            }
        }
    }

    private func clipGridCell(_ clip: ClipVideo) -> some View {
        let isDeleting = viewModel.deletingId == clip.id
        return NavigationLink(value: clip.id) {
            ClipGridCell(clip: clip)
                .overlay(alignment: .topTrailing) {
                    Button {
                        clipToDelete = clip
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
                                Text("Deleting…")
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

public struct ClipDetailView: View {
    public let clip: ClipVideo
    @State private var isSharePresented = false

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                videoPlayerSection
                headerSection
                detailsSection
                actionsSection
            }
            .padding()
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Clip Details")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    private var videoPlayerSection: some View {
        if let urlString = clip.s3Url, let url = URL(string: urlString) {
            ClipPlayerView(url: url)
                .aspectRatio(16 / 9, contentMode: .fit)
                .cornerRadius(DesignTokens.cornerRadius)
        } else {
            ZStack {
                Rectangle()
                    .fill(DesignTokens.surface)
                    .aspectRatio(16 / 9, contentMode: .fit)
                VStack(spacing: DesignTokens.smallSpacing) {
                    Image(systemName: "film.stack")
                        .font(.system(size: 40))
                        .foregroundStyle(DesignTokens.muted)
                    Text("No video available")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
            .cornerRadius(DesignTokens.cornerRadius)
        }
    }

    @ViewBuilder
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text(clip.videoTitle ?? "Untitled Clip")
                .font(.title2).bold()
                .foregroundStyle(DesignTokens.textPrimary)

            HStack(spacing: DesignTokens.smallSpacing) {
                if let duration = clip.duration {
                    Label(formatDuration(duration), systemImage: "clock")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Text(clip.createdAt, style: .date)
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            if let sourceTitle = clip.sourceVideo?.videoTitle {
                DetailRow(label: "Source Video", value: sourceTitle)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private var actionsSection: some View {
        VStack(spacing: DesignTokens.spacing) {
            if let urlString = clip.s3Url, let url = URL(string: urlString) {
                ShareLink(item: url) {
                    Label("Share Clip", systemImage: "square.and.arrow.up")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(DesignTokens.accent)
                        .foregroundStyle(DesignTokens.background)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
            }
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

/// Grid cell for clips — shows a video-frame thumbnail from the clip's S3 URL.
struct ClipGridCell: View {
    let clip: ClipVideo

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Thumbnail from the clip video itself
            if let urlString = clip.s3Url, let url = URL(string: urlString) {
                VideoThumbnailView(videoUrl: url, placeholderIcon: "film.stack")
            } else {
                ZStack {
                    Rectangle()
                        .fill(DesignTokens.background)
                        .aspectRatio(16 / 9, contentMode: .fit)
                    Image(systemName: "film.stack")
                        .font(.title2)
                        .foregroundStyle(DesignTokens.muted)
                }
            }

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(clip.videoTitle ?? "Untitled Clip")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(2)

                if let sourceTitle = clip.sourceVideo?.videoTitle {
                    Text(sourceTitle)
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(1)
                }

                HStack(spacing: 4) {
                    if let duration = clip.duration {
                        Text(formatDuration(duration))
                            .font(.caption2)
                            .foregroundStyle(DesignTokens.muted)
                    }
                    Text(clip.createdAt, style: .date)
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                        .lineLimit(1)
                }
            }
            .padding(DesignTokens.smallSpacing)
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

/// Inline video player for S3-hosted clip MP4s.
struct ClipPlayerView: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .onAppear {
                let p = AVPlayer(url: url)
                p.isMuted = false
                player = p
            }
            .onDisappear {
                player?.pause()
                player = nil
            }
    }
}

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textPrimary)
                .textSelection(.enabled)
        }
    }
}

extension APIError: Identifiable {
    public var id: String {
        switch self {
        case .statusCode(let code): return "status-\(code)"
        case .serverError(let code, let response): return "server-\(code)-\(response.error)"
        }
    }
}
