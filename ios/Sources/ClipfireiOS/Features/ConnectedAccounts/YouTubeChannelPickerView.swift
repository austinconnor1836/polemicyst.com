import SwiftUI

enum YouTubePickerState {
    case idle
    case requestingScope
    case exchangingCode
    case loadingChannels
    case loaded([YouTubeChannel])
    case error(String)
    case connecting
}

@MainActor
final class YouTubeChannelPickerViewModel: ObservableObject {
    @Published var state: YouTubePickerState = .idle
    @Published var selectedChannel: YouTubeChannel?

    private let authService: AuthService
    let api: APIClient

    init(authService: AuthService, api: APIClient) {
        self.authService = authService
        self.api = api
    }

    func authorizeAndLoadChannels() async {
        state = .requestingScope

        do {
            let serverAuthCode = try await authService.requestYouTubeScope()

            state = .exchangingCode
            _ = try await api.exchangeGoogleAuthCode(serverAuthCode)

            state = .loadingChannels
            let channels = try await api.fetchYouTubeChannels()

            if channels.isEmpty {
                state = .error("No YouTube channels found for this account.")
            } else {
                state = .loaded(channels)
            }
        } catch let error as YouTubeAuthError {
            state = .error(error.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    func connectChannel(_ channel: YouTubeChannel, onSuccess: @escaping (VideoFeed) -> Void) async {
        state = .connecting

        do {
            let request = CreateFromYouTubeRequest(
                channelId: channel.id,
                channelTitle: channel.title,
                channelThumbnail: channel.thumbnail
            )
            let feed = try await api.connectYouTubeChannel(request)
            onSuccess(feed)
        } catch {
            state = .error("Failed to connect channel: \(error.localizedDescription)")
        }
    }
}

struct YouTubeChannelPickerView: View {
    @StateObject private var viewModel: YouTubeChannelPickerViewModel
    @Environment(\.dismiss) private var dismiss
    let onConnected: (VideoFeed) -> Void

    init(authService: AuthService, api: APIClient, onConnected: @escaping (VideoFeed) -> Void) {
        _viewModel = StateObject(wrappedValue: YouTubeChannelPickerViewModel(
            authService: authService,
            api: api
        ))
        self.onConnected = onConnected
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                switch viewModel.state {
                case .idle:
                    idleView
                case .requestingScope, .exchangingCode, .loadingChannels:
                    loadingView
                case .loaded(let channels):
                    channelListView(channels)
                case .error(let message):
                    errorView(message)
                case .connecting:
                    loadingView
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Connect YouTube")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var idleView: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "play.rectangle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.red)

            Text("Authorize YouTube Access")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)

            Text("We'll request read-only access to your YouTube account to list your channels.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                Task { await viewModel.authorizeAndLoadChannels() }
            } label: {
                Label("Authorize YouTube", systemImage: "lock.open.fill")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .padding(.horizontal, DesignTokens.largeSpacing)
        }
        .padding()
    }

    @ViewBuilder
    private var loadingView: some View {
        VStack(spacing: DesignTokens.spacing) {
            ProgressView()
                .scaleEffect(1.2)

            Text(loadingMessage)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding()
    }

    private var loadingMessage: String {
        switch viewModel.state {
        case .requestingScope: return "Requesting YouTube access..."
        case .exchangingCode: return "Setting up authorization..."
        case .loadingChannels: return "Loading your channels..."
        case .connecting: return "Connecting channel..."
        default: return "Loading..."
        }
    }

    @ViewBuilder
    private func channelListView(_ channels: [YouTubeChannel]) -> some View {
        List {
            ForEach(channels) { channel in
                Button {
                    Task {
                        await viewModel.connectChannel(channel) { feed in
                            onConnected(feed)
                            dismiss()
                        }
                    }
                } label: {
                    HStack(spacing: DesignTokens.spacing) {
                        AsyncImage(url: URL(string: channel.thumbnail)) { image in
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } placeholder: {
                            Circle()
                                .fill(DesignTokens.surface)
                        }
                        .frame(width: 48, height: 48)
                        .clipShape(Circle())

                        VStack(alignment: .leading, spacing: 2) {
                            Text(channel.title)
                                .font(.headline)
                                .foregroundStyle(DesignTokens.textPrimary)

                            if let subs = channel.subscriberCount {
                                Text(formatSubscriberCount(subs))
                                    .font(.caption)
                                    .foregroundStyle(DesignTokens.textSecondary)
                            }
                        }

                        Spacer()

                        Text("Connect")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.red)
                            .cornerRadius(8)
                    }
                    .padding(.vertical, DesignTokens.smallSpacing)
                }
                .buttonStyle(.plain)
                .listRowBackground(DesignTokens.surface)
            }
        }
        .listStyle(.plain)
    }

    @ViewBuilder
    private func errorView(_ message: String) -> some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.yellow)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                Task { await viewModel.authorizeAndLoadChannels() }
            } label: {
                Label("Try Again", systemImage: "arrow.clockwise")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.accent)
            .padding(.horizontal, DesignTokens.largeSpacing)
        }
        .padding()
    }

    private func formatSubscriberCount(_ count: String) -> String {
        guard let num = Int(count) else { return "\(count) subscribers" }
        if num >= 1_000_000 {
            return String(format: "%.1fM subscribers", Double(num) / 1_000_000)
        } else if num >= 1_000 {
            return String(format: "%.1fK subscribers", Double(num) / 1_000)
        }
        return "\(num) subscribers"
    }
}
