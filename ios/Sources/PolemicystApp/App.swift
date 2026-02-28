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

                    FeedVideosView(viewModel: FeedVideosViewModel(api: apiClient))
                        .tabItem {
                            Label("Feed Videos", systemImage: "list.bullet")
                        }
                        .tag(1)
                }
            } else {
                LoginView(authService: authService)
            }
        }
    }
}
