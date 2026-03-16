import SwiftUI

public struct SocialPostComposerSheet: View {
    @StateObject private var loader: PlatformLoader
    private let api: APIClient
    private let onPosted: () -> Void

    public init(api: APIClient, onPosted: @escaping () -> Void) {
        self.api = api
        self.onPosted = onPosted
        _loader = StateObject(wrappedValue: PlatformLoader(api: api))
    }

    public var body: some View {
        Group {
            if loader.isLoading {
                ProgressView("Loading platforms...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(DesignTokens.background.ignoresSafeArea())
            } else {
                ComposePostView(
                    api: api,
                    platforms: loader.platforms,
                    defaultPlatforms: loader.defaults,
                    onPostCreated: onPosted
                )
            }
        }
        .task { await loader.load() }
    }
}

@MainActor
final class PlatformLoader: ObservableObject {
    @Published var platforms: [SocialPlatformInfo] = []
    @Published var defaults: Set<String> = []
    @Published var isLoading = true

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.fetchSocialPlatforms()
            platforms = response.platforms
            defaults = Set(response.defaults)
        } catch {
            platforms = []
            defaults = []
        }
    }
}
