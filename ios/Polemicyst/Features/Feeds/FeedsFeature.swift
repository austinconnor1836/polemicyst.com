import SwiftUI
import Combine

@MainActor
final class FeedsViewModel: ObservableObject {
    @Published private(set) var feeds: [VideoFeed] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    func loadFeeds() async {
        isLoading = true
        defer { isLoading = false }
        do {
            feeds = try await api.fetchFeeds()
        } catch {
            errorMessage = "Failed to load feeds"
        }
    }

    func createFeed(name: String, url: String, interval: Int) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let request = CreateFeedRequest(
                name: name,
                sourceUrl: url,
                pollingInterval: interval,
                autoGenerateClips: nil,
                viralitySettings: nil
            )
            let feed = try await api.createFeed(request)
            feeds.insert(feed, at: 0)
        } catch {
            errorMessage = "Failed to create feed"
        }
    }
}

struct FeedsView: View {
    @StateObject private var viewModel: FeedsViewModel
    @State private var name = ""
    @State private var url = ""
    @State private var interval = "60"

    init(viewModel: FeedsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: DesignTokens.spacing) {
                Form {
                    Section(header: Text("Create Feed")) {
                        TextField("Name", text: $name)
                        TextField("Source URL", text: $url)
                        TextField("Polling Interval (minutes)", text: $interval)
                        #if os(iOS)
                            .keyboardType(.numberPad)
                        #endif
                        Button("Create") {
                            Task { await submit() }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .background(DesignTokens.background)

                List(viewModel.feeds) { feed in
                    VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                        Text(feed.name)
                            .font(.headline)
                        Text(feed.sourceUrl)
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .padding(.vertical, DesignTokens.smallSpacing)
                    .listRowBackground(DesignTokens.surface)
                }
                .listStyle(.plain)
                .background(DesignTokens.background)
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Feeds")
            .task { await viewModel.loadFeeds() }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }

    private func submit() async {
        guard let intervalInt = Int(interval) else { return }
        await viewModel.createFeed(name: name, url: url, interval: intervalInt)
        name = ""
        url = ""
        interval = "60"
    }
}
