import SwiftUI
import PolemicystiOS

@main
struct PolemicystApp: App {
    @StateObject private var authService: AuthService
    @State private var tabSelection = 0

    private let apiClient: APIClient

    init() {
        let storage = TokenStorage()
        let client = APIClient(
            baseURL: AppConfiguration.apiBaseURL,
            tokenStorage: storage
        )
        self.apiClient = client
        _authService = StateObject(wrappedValue: AuthService(api: client, tokenStorage: storage))
    }

    var body: some Scene {
        WindowGroup {
            if authService.isAuthenticated {
                TabView(selection: $tabSelection) {
                    HomeView(selection: $tabSelection)
                        .tabItem {
                            Label("Home", systemImage: "house.fill")
                        }
                        .tag(0)

                FeedsView(viewModel: FeedsViewModel(api: apiClient))
                    .tabItem {
                        Label("Feeds", systemImage: "antenna.radiowaves.left.and.right")
                    }
                    .tag(1)

                FeedVideosView(viewModel: FeedVideosViewModel(api: apiClient))
                    .tabItem {
                        Label("Videos", systemImage: "list.bullet")
                    }
                    .tag(2)

                ClipsListView(viewModel: ClipsViewModel(api: apiClient))
                    .tabItem {
                        Label("Clips", systemImage: "film.stack")
                    }
                    .tag(3)

                SettingsTabView(apiClient: apiClient)
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
                    .tag(4)
                }
            } else {
                LoginView(authService: authService)
            }
        }
    }
}

struct SettingsTabView: View {
    let apiClient: APIClient

    var body: some View {
        NavigationStack {
            List {
                NavigationLink {
                    SubscriptionView(viewModel: SubscriptionViewModel(api: apiClient))
                } label: {
                    Label("Subscription & Billing", systemImage: "creditcard.fill")
                }
                .listRowBackground(DesignTokens.surface)

                NavigationLink {
                    LLMProviderView(viewModel: LLMProviderViewModel(api: apiClient))
                } label: {
                    Label("LLM Provider", systemImage: "cpu")
                }
                .listRowBackground(DesignTokens.surface)
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Settings")
        }
    }
}
