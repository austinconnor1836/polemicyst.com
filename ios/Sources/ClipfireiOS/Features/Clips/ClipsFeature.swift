import SwiftUI

@MainActor
public final class ClipsViewModel: ObservableObject {
    @Published public private(set) var clips: [ClipVideo] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
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
            errorMessage = "Failed to load clips"
        }
    }

    public func deleteClip(_ clip: ClipVideo) async {
        do {
            try await api.deleteClip(id: clip.id)
            clips.removeAll { $0.id == clip.id }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to delete clip"
        }
    }
}

public struct ClipsListView: View {
    @StateObject private var viewModel: ClipsViewModel

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
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
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

    @ViewBuilder
    private var clipsList: some View {
        List {
            ForEach(viewModel.clips) { clip in
                NavigationLink(value: clip.id) {
                    ClipRowView(clip: clip)
                }
                .listRowBackground(DesignTokens.surface)
            }
            .onDelete { indexSet in
                for index in indexSet {
                    let clip = viewModel.clips[index]
                    Task { await viewModel.deleteClip(clip) }
                }
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: String.self) { clipId in
            if let clip = viewModel.clips.first(where: { $0.id == clipId }) {
                ClipDetailView(clip: clip)
            }
        }
    }
}

struct ClipRowView: View {
    let clip: ClipVideo

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text(clip.videoTitle ?? "Untitled Clip")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)
                .lineLimit(1)

            if let source = clip.sourceVideo?.videoTitle {
                HStack(spacing: 4) {
                    Image(systemName: "link")
                        .font(.caption2)
                    Text(source)
                        .lineLimit(1)
                }
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
            }

            Text(clip.createdAt, style: .date)
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
        }
        .padding(.vertical, DesignTokens.smallSpacing)
    }
}

public struct ClipDetailView: View {
    public let clip: ClipVideo

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                headerSection
                detailsSection
                if clip.s3Url != nil {
                    actionsSection
                }
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
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text(clip.videoTitle ?? "Untitled Clip")
                .font(.title2).bold()
                .foregroundStyle(DesignTokens.textPrimary)

            Text(clip.createdAt, style: .date)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            DetailRow(label: "Clip ID", value: clip.id)

            if let sourceTitle = clip.sourceVideo?.videoTitle {
                DetailRow(label: "Source Video", value: sourceTitle)
            }

            if let s3Key = clip.s3Key {
                DetailRow(label: "Storage Key", value: s3Key)
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
                Link(destination: url) {
                    Label("Open in Browser", systemImage: "safari")
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
