import SwiftUI
import ClipfireiOS

@main
struct ClipfireApp: App {
    @StateObject private var authService: AuthService
    @State private var tabSelection = 0
    @State private var forceUpdateRequired = false
    @State private var forceUpdateStoreUrl = ""
    @State private var showContentPicker = false
    @State private var showPublicationWizard = false
    @State private var showAddVideo = false

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
            Group {
                if forceUpdateRequired && !ScreenshotMode.isActive {
                    ForceUpdateView(storeUrl: forceUpdateStoreUrl)
                } else if authService.isAuthenticated || ScreenshotMode.isActive {
                    ZStack(alignment: .bottomTrailing) {
                        TabView(selection: $tabSelection) {
                            ClipsListView(viewModel: ClipsViewModel(api: apiClient))
                                .tabItem {
                                    Label("Clips", systemImage: "film.stack")
                                }
                                .tag(0)

                            ConnectedAccountsView(viewModel: ConnectedAccountsViewModel(api: apiClient), authService: authService)
                                .tabItem {
                                    Label("Accounts", systemImage: "link")
                                }
                                .tag(1)

                            FeedVideosView(viewModel: FeedVideosViewModel(api: apiClient))
                                .tabItem {
                                    Label("Videos", systemImage: "list.bullet")
                                }
                                .tag(2)

                            PublicationsListView(viewModel: PublicationsViewModel(api: apiClient))
                                .tabItem {
                                    Label("Publish", systemImage: "newspaper")
                                }
                                .tag(3)

                            SettingsTabView(apiClient: apiClient, authService: authService)
                                .tabItem {
                                    Label("Settings", systemImage: "gearshape.fill")
                                }
                                .tag(4)
                        }

                        FloatingActionButton {
                            showContentPicker = true
                        }
                        .padding(.trailing, 20)
                        .padding(.bottom, 70)
                    }
                    .sheet(isPresented: $showContentPicker) {
                        ContentTypePicker(
                            onPublication: {
                                showContentPicker = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    showPublicationWizard = true
                                }
                            },
                            onVideo: {
                                showContentPicker = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    showAddVideo = true
                                }
                            }
                        )
                    }
                    .sheet(isPresented: $showAddVideo) {
                        AddVideoView(api: apiClient, onVideoAdded: {
                            tabSelection = 2
                        })
                    }
                    .sheet(isPresented: $showPublicationWizard) {
                        CreateContentWizard(api: apiClient, onNavigateToPublish: {
                            tabSelection = 1
                        })
                    }
                } else {
                    LoginView(authService: authService)
                }
            }
            .task {
                await checkAppVersion()
            }
        }
    }

    private func checkAppVersion() async {
        let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        do {
            let response = try await apiClient.checkVersion(currentVersion: currentVersion)
            if response.updateRequired {
                forceUpdateStoreUrl = response.storeUrl
                forceUpdateRequired = true
            }
        } catch {
            // Version check is non-fatal — let the app continue if the server is unreachable
        }
    }
}

struct SettingsTabView: View {
    let apiClient: APIClient
    @ObservedObject var authService: AuthService

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
                    AutomationSettingsView(viewModel: AutomationSettingsViewModel(api: apiClient))
                } label: {
                    Label("Clip Generation", systemImage: "bolt.fill")
                }
                .listRowBackground(DesignTokens.surface)

                NavigationLink {
                    LLMProviderView(viewModel: LLMProviderViewModel(api: apiClient))
                } label: {
                    Label("LLM Provider", systemImage: "cpu")
                }
                .listRowBackground(DesignTokens.surface)

                Section {
                    Button(role: .destructive) {
                        authService.signOut()
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .listRowBackground(DesignTokens.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Settings")
        }
    }
}
