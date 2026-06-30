import SwiftUI
import ClipfireiOS
import GoogleSignIn
import FirebaseCore
import FirebaseCrashlytics

// MARK: - AppDelegate (background upload session handling)

class ClipfireAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        NSLog("[App] handleEventsForBackgroundURLSession: %@", identifier)
        // Two background URLSessions live in the app — route the wake to the
        // one whose identifier matches.
        //   `com.clipfire.upload`  — `BackgroundUploadService` (AddVideo flow)
        //   `com.clipfire.uploads` — `VideoUploadService`      (Stitch / Reactions)
        if identifier == "com.clipfire.uploads" {
            VideoUploadService.shared.savedBackgroundCompletionHandler = completionHandler
        } else {
            BackgroundUploadService.shared.systemCompletionHandler = completionHandler
        }
    }
}

@main
struct ClipfireApp: App {
    @UIApplicationDelegateAdaptor(ClipfireAppDelegate.self) var appDelegate
    @StateObject private var authService: AuthService
    @State private var tabSelection = 0
    @State private var forceUpdateRequired = false
    @State private var forceUpdateStoreUrl = ""
    @State private var showContentPicker = false
    @State private var showPublicationWizard = false
    @State private var showAddVideo = false
    @State private var showSocialPostComposer = false
    @State private var showStitchEditor = false

    private let apiClient: APIClient

    init() {
        // Configure Firebase (Crashlytics) before anything else so early crashes are captured.
        // GoogleService-Info.plist is intentionally not in the repo (gitignored, secret-bearing).
        // FirebaseApp.configure() calls fatalError() when the plist is missing/invalid, so we
        // gate the call on the plist actually being present in the bundle. CI builds (and any
        // local checkout without the plist) skip Firebase entirely; Crashlytics simply stays
        // disabled in that case. TestFlight/Release builds always have it via Fastlane match.
        if FirebaseApp.app() == nil,
           Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist") != nil {
            FirebaseApp.configure()
        }

        let storage = TokenStorage()
        let client = APIClient(
            baseURL: AppConfiguration.apiBaseURL,
            tokenStorage: storage
        )
        self.apiClient = client
        _authService = StateObject(wrappedValue: AuthService(api: client, tokenStorage: storage))

        // Configure the background upload service so it can reconnect to in-progress uploads
        BackgroundUploadService.shared.configure(api: client)
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

                            NavigationStack {
                                MyStitchesView(api: apiClient, onRetry: { stitchId in
                                    StitchEditorViewModel.retryGenerateMeta(stitchId: stitchId, api: apiClient)
                                })
                            }
                                .tabItem {
                                    Label("Stitches", systemImage: "rectangle.split.3x1")
                                }
                                .tag(6)

                            ConnectedAccountsView(viewModel: ConnectedAccountsViewModel(api: apiClient), authService: authService)
                                .tabItem {
                                    Label("Accounts", systemImage: "link")
                                }
                                .tag(2)

                            FeedVideosView(viewModel: FeedVideosViewModel(api: apiClient))
                                .tabItem {
                                    Label("Videos", systemImage: "list.bullet")
                                }
                                .tag(3)

                            SocialPostsListView(viewModel: SocialPostsViewModel(api: apiClient), api: apiClient)
                                .tabItem {
                                    Label("Post", systemImage: "text.bubble")
                                }
                                .tag(1)

                            CompositionsListView(viewModel: CompositionsViewModel(api: apiClient), api: apiClient)
                                .tabItem {
                                    Label("Reactions", systemImage: "rectangle.on.rectangle.angled")
                                }
                                .tag(5)

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
                            },
                            onSocialPost: {
                                showContentPicker = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    showSocialPostComposer = true
                                }
                            },
                            onReaction: {
                                showContentPicker = false
                                tabSelection = 5
                            },
                            onStitch: {
                                showContentPicker = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    showStitchEditor = true
                                }
                            }
                        )
                    }
                    .sheet(isPresented: $showStitchEditor) {
                        StitchEditorView(api: apiClient, onRenderDispatched: {
                            // W025: fire-and-forget render — switch to the
                            // Stitches tab so the user lands on MyStitchesView
                            // with their freshly-queued (Processing…) row.
                            tabSelection = 6
                        })
                    }
                    .sheet(isPresented: $showAddVideo) {
                        AddVideoView(api: apiClient, onVideoAdded: {
                            tabSelection = 3
                        })
                    }
                    .sheet(isPresented: $showPublicationWizard) {
                        CreateContentWizard(api: apiClient, onNavigateToPublish: {
                            tabSelection = 2
                        })
                    }
                    .sheet(isPresented: $showSocialPostComposer) {
                        SocialPostComposerSheet(api: apiClient, onPosted: {
                            tabSelection = 1
                        })
                    }
                } else {
                    LoginView(authService: authService)
                }
            }
            .task {
                // Restore Google Sign-In session from Keychain so
                // GIDSignIn.sharedInstance.currentUser is available
                // for authenticated innertube caption requests
                do {
                    try await GIDSignIn.sharedInstance.restorePreviousSignIn()
                } catch {
                    // Not fatal — user may have signed in with Apple
                    print("[App] Google session restore: \(error.localizedDescription)")
                }
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
                // v0.5.0: "Subscription & Billing" entry removed for App Store
                // resubmission (Apple Guideline 2.1(b)). Will be reintroduced
                // alongside the RevenueCat integration post-v1.0.

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

                NavigationLink {
                    PublishDefaultsView(viewModel: PublishDefaultsViewModel(api: apiClient))
                } label: {
                    Label("Publish Defaults", systemImage: "paperplane.fill")
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
