import SwiftUI
import Combine

@MainActor
public final class ConnectedAccountsViewModel: ObservableObject {
    @Published public private(set) var feeds: [VideoFeed] = []
    @Published public private(set) var brands: [Brand] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var subscription: SubscriptionResponse?

    public let api: APIClient

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

    public func loadBrands() async {
        do {
            brands = try await api.fetchBrands()
        } catch {
            // Non-blocking
        }
    }

    public func createBrand(name: String) async {
        do {
            let brand = try await api.createBrand(CreateBrandRequest(name: name))
            brands.insert(brand, at: 0)
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to create brand"
        }
    }

    public func deleteBrand(_ brand: Brand) async {
        do {
            try await api.deleteBrand(id: brand.id)
            brands.removeAll { $0.id == brand.id }
            await loadAccounts()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to delete brand"
        }
    }

    /// Groups feeds by brand. Ungrouped feeds have brand == nil, placed at end.
    public var feedsByBrand: [(brand: Brand?, feeds: [VideoFeed])] {
        guard !brands.isEmpty else { return [(nil, feeds)] }

        var brandMap: [String: [VideoFeed]] = [:]
        var ungrouped: [VideoFeed] = []

        for feed in feeds {
            if let brandId = feed.brandId {
                brandMap[brandId, default: []].append(feed)
            } else {
                ungrouped.append(feed)
            }
        }

        var result: [(brand: Brand?, feeds: [VideoFeed])] = []
        for brand in brands {
            result.append((brand, brandMap[brand.id] ?? []))
        }
        if !ungrouped.isEmpty {
            result.append((nil, ungrouped))
        }
        return result
    }

    public func loadSubscription() async {
        do {
            subscription = try await api.fetchSubscription()
        } catch {
            // Non-blocking
        }
    }

    public func addFeed(_ feed: VideoFeed) {
        feeds.insert(feed, at: 0)
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
}

public struct ConnectedAccountsView: View {
    @StateObject private var viewModel: ConnectedAccountsViewModel
    @State private var showPlatformPicker = false
    @State private var showYouTubePicker = false
    @State private var showCreateBrand = false
    @State private var newBrandName = ""
    @State private var selectedAccountSettings: VideoFeed?

    private let authService: AuthService?

    public init(viewModel: ConnectedAccountsViewModel, authService: AuthService? = nil) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.authService = authService
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
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
                    Menu {
                        Button {
                            showPlatformPicker = true
                        } label: {
                            Label("Connect Account", systemImage: "plus.circle")
                        }
                        Button {
                            newBrandName = ""
                            showCreateBrand = true
                        } label: {
                            Label("Create Brand", systemImage: "tag")
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .task {
                await viewModel.loadSubscription()
                async let accountsTask: () = viewModel.loadAccounts()
                async let brandsTask: () = viewModel.loadBrands()
                _ = await (accountsTask, brandsTask)
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
                    handlePlatformSelected(platform)
                }
            }
            .alert("Create Brand", isPresented: $showCreateBrand) {
                TextField("Brand name", text: $newBrandName)
                Button("Create") {
                    let name = newBrandName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }
                    Task { await viewModel.createBrand(name: name) }
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Group your connected accounts under a brand.")
            }
            .sheet(isPresented: $showYouTubePicker) {
                if let auth = authService {
                    YouTubeChannelPickerView(
                        authService: auth,
                        api: viewModel.api
                    ) { feed in
                        viewModel.addFeed(feed)
                    }
                }
            }
            .sheet(item: $selectedAccountSettings) { feed in
                AccountSettingsView(
                    viewModel: AccountSettingsViewModel(feed: feed, api: viewModel.api)
                )
                .presentationDetents([.large])
                .onDisappear {
                    Task { await viewModel.loadAccounts() }
                }
            }
        }
    }

    private func handlePlatformSelected(_ platform: PlatformOption) {
        if platform == .youtube {
            // Always use OAuth for YouTube
            showYouTubePicker = true
        }
        // Future platforms (Facebook, Instagram, TikTok, Twitter) will be added here
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
                Text("Connect a YouTube channel to start generating clips.")
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
                let groups = viewModel.feedsByBrand
                ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                    Section {
                        ForEach(group.feeds) { feed in
                            feedRow(feed)
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                let feed = group.feeds[index]
                                Task { await viewModel.deleteAccount(feed) }
                            }
                        }
                    } header: {
                        if let brand = group.brand {
                            HStack {
                                if let imageUrl = brand.imageUrl,
                                   let url = URL(string: imageUrl) {
                                    AsyncImage(url: url) { image in
                                        image.resizable().aspectRatio(contentMode: .fill)
                                    } placeholder: {
                                        Circle().fill(DesignTokens.surface)
                                    }
                                    .frame(width: 20, height: 20)
                                    .clipShape(Circle())
                                }
                                Text(brand.name)
                                Spacer()
                                Button(role: .destructive) {
                                    Task { await viewModel.deleteBrand(brand) }
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.caption2)
                                }
                            }
                        } else if viewModel.brands.count > 0 {
                            Text("Ungrouped")
                        }
                    }
                }
            }
            .listStyle(.plain)
            .background(DesignTokens.background)
        }
    }

    @ViewBuilder
    private func feedRow(_ feed: VideoFeed) -> some View {
        HStack(spacing: DesignTokens.spacing) {
            if feed.sourceType == "youtube-oauth",
               let thumb = feed.youtubeChannelThumb,
               let thumbURL = URL(string: thumb) {
                AsyncImage(url: thumbURL) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle().fill(DesignTokens.surface)
                }
                .frame(width: 40, height: 40)
                .clipShape(Circle())
            }

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
                    Button {
                        selectedAccountSettings = feed
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.muted)
                    }
                    .buttonStyle(.plain)
                }
                Text(feed.sourceUrl)
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(1)
                HStack {
                    Label(displaySourceType(feed.sourceType), systemImage: sourceIcon(feed.sourceType))
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                    Spacer()
                    Text("Every \(feed.pollingInterval) min")
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
        }
        .padding(.vertical, DesignTokens.smallSpacing)
        .listRowBackground(DesignTokens.surface)
    }

    private func displaySourceType(_ type: String) -> String {
        switch type.lowercased() {
        case "youtube-oauth": return "YouTube"
        case "youtube": return "YouTube"
        default: return type.uppercased()
        }
    }

    private func sourceIcon(_ type: String) -> String {
        switch type.lowercased() {
        case "youtube", "youtube-oauth": return "play.rectangle.fill"
        case "cspan": return "building.columns.fill"
        default: return "globe"
        }
    }
}
