import SwiftUI
import Combine

@MainActor
public final class FeedsViewModel: ObservableObject {
    @Published public private(set) var feeds: [VideoFeed] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var subscription: SubscriptionResponse?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func loadFeeds() async {
        isLoading = true
        defer { isLoading = false }
        do {
            feeds = try await api.fetchFeeds()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to load feeds"
        }
    }

    public func loadSubscription() async {
        do {
            subscription = try await api.fetchSubscription()
        } catch {
            // Non-blocking
        }
    }

    public func createFeed(name: String, url: String, interval: Int,
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
            errorMessage = "Failed to create feed"
        }
    }

    public func deleteFeed(_ feed: VideoFeed) async {
        do {
            try await api.deleteFeed(id: feed.id)
            feeds.removeAll { $0.id == feed.id }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to delete feed"
        }
    }

    public var allowedProviders: [String] {
        subscription?.plan.limits.llmProviders ?? ["ollama"]
    }

    public var canAutoGenerate: Bool {
        subscription?.plan.limits.autoGenerateClips ?? false
    }
}

public struct FeedsView: View {
    @StateObject private var viewModel: FeedsViewModel
    @State private var name = ""
    @State private var url = ""
    @State private var interval = "60"
    @State private var autoGenerateClips = false
    @State private var showViralitySettings = false
    @State private var viralitySettings = ViralitySettings()

    public init(viewModel: FeedsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Form {
                    Section(header: Text("Create Feed")) {
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

                        Button("Create") {
                            Task { await submit() }
                        }
                        .disabled(name.isEmpty || url.isEmpty)
                    }
                }
                .scrollContentBackground(.hidden)
                .background(DesignTokens.background)
                .frame(maxHeight: showViralitySettings ? 520 : 340)

                if let sub = viewModel.subscription {
                    HStack(spacing: DesignTokens.largeSpacing) {
                        QuotaBar(
                            label: "Feeds",
                            current: sub.usage.feeds,
                            maximum: sub.plan.limits.maxFeeds
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

                feedsList
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Feeds")
            .task {
                await viewModel.loadSubscription()
                await viewModel.loadFeeds()
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
    private var feedsList: some View {
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
                    Task { await viewModel.deleteFeed(feed) }
                }
            }
        }
        .listStyle(.plain)
        .background(DesignTokens.background)
    }

    private func submit() async {
        guard let intervalInt = Int(interval) else { return }
        await viewModel.createFeed(
            name: name,
            url: url,
            interval: intervalInt,
            autoGenerateClips: autoGenerateClips,
            viralitySettings: showViralitySettings ? viralitySettings : nil
        )
        name = ""
        url = ""
        interval = "60"
        autoGenerateClips = false
    }

    private func sourceIcon(_ type: String) -> String {
        switch type.lowercased() {
        case "youtube": return "play.rectangle.fill"
        case "cspan": return "building.columns.fill"
        default: return "globe"
        }
    }
}
