import SwiftUI
import Combine

@MainActor
public final class ConnectedAccountsViewModel: ObservableObject {
    @Published public private(set) var feeds: [VideoFeed] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var subscription: SubscriptionResponse?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func loadAccounts() async {
        isLoading = true
        defer { isLoading = false }
        do {
            feeds = try await api.fetchFeeds()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to load accounts"
        }
    }

    public func loadSubscription() async {
        do {
            subscription = try await api.fetchSubscription()
        } catch {
            // Non-blocking
        }
    }

    public func connectAccount(name: String, url: String, interval: Int,
                               autoGenerateClips: Bool, viralitySettings: ViralitySettings?) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let request = CreateFeedRequest(
                name: name,
                sourceUrl: url,
                pollingInterval: interval,
                autoGenerateClips: autoGenerateClips,
                viralitySettings: viralitySettings?.toDictionary()
            )
            let feed = try await api.createFeed(request)
            feeds.insert(feed, at: 0)
        } catch let error as APIError {
            if error.isUpgradeRequired {
                upgradeError = error
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = "Failed to connect account"
        }
    }

    public func deleteAccount(_ feed: VideoFeed) async {
        do {
            try await api.deleteFeed(id: feed.id)
            feeds.removeAll { $0.id == feed.id }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to remove account"
        }
    }

    public var allowedProviders: [String] {
        subscription?.plan.limits.llmProviders ?? ["ollama"]
    }

    public var canAutoGenerate: Bool {
        subscription?.plan.limits.autoGenerateClips ?? false
    }
}

public struct ConnectedAccountsView: View {
    @StateObject private var viewModel: ConnectedAccountsViewModel
    @State private var showPlatformPicker = false
    @State private var showConnectForm = false
    @State private var selectedPlatform: PlatformOption?
    @State private var name = ""
    @State private var url = ""
    @State private var interval = "60"
    @State private var autoGenerateClips = false
    @State private var showViralitySettings = false
    @State private var viralitySettings = ViralitySettings()

    public init(viewModel: ConnectedAccountsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if showConnectForm, let platform = selectedPlatform {
                    connectFormSection(platform: platform)
                }

                if let sub = viewModel.subscription {
                    HStack(spacing: DesignTokens.largeSpacing) {
                        QuotaBar(
                            label: "Accounts",
                            current: sub.usage.feeds,
                            maximum: sub.plan.limits.maxConnectedAccounts
                        )
                        QuotaBar(
                            label: "Clips/mo",
                            current: sub.usage.clipsThisMonth,
                            maximum: sub.plan.limits.maxClipsPerMonth
                        )
                    }
                    .padding()
                    .background(DesignTokens.surface)
                }

                accountsList
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Connected Accounts")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showPlatformPicker = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .task {
                await viewModel.loadSubscription()
                await viewModel.loadAccounts()
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
            .sheet(isPresented: $showPlatformPicker) {
                PlatformPickerView { platform in
                    showPlatformPicker = false
                    selectedPlatform = platform
                    showConnectForm = true
                }
            }
        }
    }

    @ViewBuilder
    private func connectFormSection(platform: PlatformOption) -> some View {
        Form {
            Section(header: Text("Connect \(platform.name)")) {
                TextField("Name", text: $name)
                TextField("Source URL", text: $url)
                    #if os(iOS)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    #endif
                TextField("Polling Interval (minutes)", text: $interval)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif

                Toggle("Auto-Generate Clips", isOn: $autoGenerateClips)
                    .disabled(!viewModel.canAutoGenerate)

                if !viewModel.canAutoGenerate {
                    Text("Upgrade to Pro to enable auto-generation")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }

                DisclosureGroup("Virality Settings", isExpanded: $showViralitySettings) {
                    ViralitySettingsView(
                        settings: $viralitySettings,
                        allowedProviders: viewModel.allowedProviders
                    )
                }

                HStack {
                    Button("Cancel") {
                        showConnectForm = false
                        selectedPlatform = nil
                        resetForm()
                    }
                    .foregroundStyle(.secondary)

                    Spacer()

                    Button("Connect") {
                        Task { await submit() }
                    }
                    .disabled(name.isEmpty || url.isEmpty)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(DesignTokens.background)
        .frame(maxHeight: showViralitySettings ? 520 : 380)
    }

    @ViewBuilder
    private var accountsList: some View {
        if viewModel.feeds.isEmpty && !viewModel.isLoading {
            VStack(spacing: DesignTokens.spacing) {
                Image(systemName: "link.badge.plus")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.muted)
                Text("No connected accounts")
                    .font(.title3)
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Connect a YouTube channel, C-SPAN, or other source to start generating clips.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Button {
                    showPlatformPicker = true
                } label: {
                    Label("Connect Account", systemImage: "plus.circle.fill")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.accent)
                .padding(.horizontal, DesignTokens.largeSpacing)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                ForEach(viewModel.feeds) { feed in
                    VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                        HStack {
                            Text(feed.name)
                                .font(.headline)
                                .foregroundStyle(DesignTokens.textPrimary)
                            Spacer()
                            if feed.autoGenerateClips {
                                Image(systemName: "bolt.fill")
                                    .font(.caption)
                                    .foregroundStyle(DesignTokens.accent)
                            }
                        }
                        Text(feed.sourceUrl)
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .lineLimit(1)
                        HStack {
                            Label(feed.sourceType.uppercased(), systemImage: sourceIcon(feed.sourceType))
                                .font(.caption2)
                                .foregroundStyle(DesignTokens.muted)
                            Spacer()
                            Text("Every \(feed.pollingInterval) min")
                                .font(.caption2)
                                .foregroundStyle(DesignTokens.muted)
                        }
                    }
                    .padding(.vertical, DesignTokens.smallSpacing)
                    .listRowBackground(DesignTokens.surface)
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        let feed = viewModel.feeds[index]
                        Task { await viewModel.deleteAccount(feed) }
                    }
                }
            }
            .listStyle(.plain)
            .background(DesignTokens.background)
        }
    }

    private func submit() async {
        guard let intervalInt = Int(interval) else { return }
        await viewModel.connectAccount(
            name: name,
            url: url,
            interval: intervalInt,
            autoGenerateClips: autoGenerateClips,
            viralitySettings: showViralitySettings ? viralitySettings : nil
        )
        showConnectForm = false
        selectedPlatform = nil
        resetForm()
    }

    private func resetForm() {
        name = ""
        url = ""
        interval = "60"
        autoGenerateClips = false
        showViralitySettings = false
        viralitySettings = ViralitySettings()
    }

    private func sourceIcon(_ type: String) -> String {
        switch type.lowercased() {
        case "youtube": return "play.rectangle.fill"
        case "cspan": return "building.columns.fill"
        default: return "globe"
        }
    }
}
