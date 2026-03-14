import SwiftUI

// MARK: - ViewModel

@MainActor
public final class SocialPostsViewModel: ObservableObject {
    @Published public private(set) var posts: [SocialPost] = []
    @Published public private(set) var platforms: [SocialPlatformInfo] = []
    @Published public var defaultPlatforms: Set<String> = []
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
            async let postsTask = api.fetchSocialPosts()
            async let platformsTask = api.fetchSocialPlatforms()

            let (loadedPosts, platformsResponse) = try await (postsTask, platformsTask)
            posts = loadedPosts
            platforms = platformsResponse.platforms
            defaultPlatforms = Set(platformsResponse.defaults)
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load: \(error.localizedDescription)"
        }
    }

    public func deletePost(_ post: SocialPost) async {
        do {
            try await api.deleteSocialPost(id: post.id)
            withAnimation { posts.removeAll { $0.id == post.id } }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to delete post: \(error.localizedDescription)"
        }
    }
}

// MARK: - List View

public struct SocialPostsListView: View {
    @StateObject private var viewModel: SocialPostsViewModel
    @State private var showComposer = false
    @State private var showErrorAlert = false
    @State private var showDeleteAlert = false
    @State private var postToDelete: SocialPost?
    private let api: APIClient

    public init(viewModel: SocialPostsViewModel, api: APIClient) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.api = api
    }

    public var body: some View {
        NavigationStack {
            Group {
                if viewModel.posts.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    postsList
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Post")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showComposer = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .task { await viewModel.load() }
            .refreshable { await viewModel.load() }
            .overlay {
                if viewModel.isLoading && viewModel.posts.isEmpty {
                    ProgressView().progressViewStyle(.circular)
                }
            }
            .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .alert("Delete Post", isPresented: $showDeleteAlert, presenting: postToDelete) { post in
                Button("Delete", role: .destructive) {
                    Task { await viewModel.deletePost(post) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { post in
                let preview = post.content.prefix(50)
                Text("Delete \"\(preview)...\"? This cannot be undone.")
            }
            .sheet(isPresented: $showComposer) {
                ComposePostView(
                    api: api,
                    platforms: viewModel.platforms,
                    defaultPlatforms: viewModel.defaultPlatforms,
                    onPostCreated: {
                        Task { await viewModel.load() }
                    }
                )
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "text.bubble")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.muted)

            Text("No Posts Yet")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Create text posts and publish them\nto your connected social accounts.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.muted)
                .multilineTextAlignment(.center)

            Button {
                showComposer = true
            } label: {
                Label("Create Post", systemImage: "square.and.pencil")
                    .font(.headline)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.accent)
                    .foregroundStyle(.white)
                    .cornerRadius(DesignTokens.cornerRadius)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var postsList: some View {
        List {
            ForEach(viewModel.posts) { post in
                SocialPostRow(post: post)
                    .listRowBackground(DesignTokens.surface)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            postToDelete = post
                            showDeleteAlert = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
        }
        .scrollContentBackground(.hidden)
    }
}

// MARK: - Post Row

struct SocialPostRow: View {
    let post: SocialPost

    private var statusColor: Color {
        switch post.status {
        case "completed": return .green
        case "failed": return .red
        case "publishing": return .orange
        default: return DesignTokens.muted
        }
    }

    private var statusText: String {
        switch post.status {
        case "completed": return "Published"
        case "failed": return "Failed"
        case "publishing": return "Publishing..."
        case "pending": return "Pending"
        default: return post.status.capitalized
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(post.content)
                .font(.body)
                .foregroundStyle(DesignTokens.textPrimary)
                .lineLimit(3)

            HStack(spacing: 6) {
                ForEach(post.platforms, id: \.self) { platform in
                    platformBadge(platform)
                }
                Spacer()
                Text(statusText)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(statusColor)
            }

            if let publishes = post.publishes {
                ForEach(publishes) { pub in
                    if pub.status == "failed", let error = pub.publishError {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.caption2)
                                .foregroundStyle(.red)
                            Text("\(pub.platform.capitalized): \(error)")
                                .font(.caption2)
                                .foregroundStyle(.red.opacity(0.8))
                        }
                    }
                }
            }

            Text(post.createdAt, style: .relative)
                .font(.caption2)
                .foregroundStyle(DesignTokens.muted)
        }
        .padding(.vertical, 4)
    }

    private func platformBadge(_ platform: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: platformIcon(platform))
                .font(.system(size: 10))
            Text(platformName(platform))
                .font(.caption2)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(platformColor(platform).opacity(0.15))
        .foregroundStyle(platformColor(platform))
        .cornerRadius(4)
    }

    private func platformIcon(_ platform: String) -> String {
        switch platform {
        case "twitter": return "at"
        case "facebook": return "person.2.fill"
        case "bluesky": return "cloud.fill"
        case "threads": return "at.circle.fill"
        default: return "link"
        }
    }

    private func platformName(_ platform: String) -> String {
        switch platform {
        case "twitter": return "X"
        case "facebook": return "Facebook"
        case "bluesky": return "Bluesky"
        case "threads": return "Threads"
        default: return platform.capitalized
        }
    }

    private func platformColor(_ platform: String) -> Color {
        switch platform {
        case "twitter": return Color(red: 0.11, green: 0.63, blue: 0.95)
        case "facebook": return Color(red: 0.23, green: 0.35, blue: 0.60)
        case "bluesky": return Color(red: 0.0, green: 0.52, blue: 1.0)
        case "threads": return Color(red: 0.0, green: 0.0, blue: 0.0)
        default: return DesignTokens.muted
        }
    }
}
