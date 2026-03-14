import SwiftUI

@MainActor
public final class PublishDefaultsViewModel: ObservableObject {
    @Published public var platforms: [SocialPlatformInfo] = []
    @Published public var selectedDefaults: Set<String> = []
    @Published public var isLoading = false
    @Published public var isSaving = false
    @Published public var errorMessage: String?
    @Published public var hasChanges = false

    private let api: APIClient
    private var originalDefaults: Set<String> = []

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.fetchSocialPlatforms()
            platforms = response.platforms
            selectedDefaults = Set(response.defaults)
            originalDefaults = selectedDefaults
            hasChanges = false
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load platforms: \(error.localizedDescription)"
        }
    }

    public func togglePlatform(_ platform: String) {
        if selectedDefaults.contains(platform) {
            selectedDefaults.remove(platform)
        } else {
            selectedDefaults.insert(platform)
        }
        hasChanges = selectedDefaults != originalDefaults
    }

    public func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let response = try await api.updatePublishDefaults(platforms: Array(selectedDefaults))
            selectedDefaults = Set(response.platforms)
            originalDefaults = selectedDefaults
            hasChanges = false
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to save defaults: \(error.localizedDescription)"
        }
    }
}

public struct PublishDefaultsView: View {
    @StateObject private var viewModel: PublishDefaultsViewModel
    @State private var showErrorAlert = false

    public init(viewModel: PublishDefaultsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        List {
            Section {
                if viewModel.platforms.isEmpty && !viewModel.isLoading {
                    Text("No social platforms available.")
                        .foregroundStyle(DesignTokens.muted)
                        .listRowBackground(DesignTokens.surface)
                } else {
                    ForEach(viewModel.platforms) { platform in
                        Button {
                            viewModel.togglePlatform(platform.platform)
                        } label: {
                            HStack {
                                Image(systemName: platformIcon(platform.platform))
                                    .font(.system(size: 18))
                                    .foregroundStyle(platformColor(platform.platform))
                                    .frame(width: 28)

                                Text(platform.displayName)
                                    .foregroundStyle(DesignTokens.textPrimary)

                                if !platform.connected {
                                    Text("Not connected")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }

                                Spacer()

                                Image(systemName: viewModel.selectedDefaults.contains(platform.platform)
                                      ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(viewModel.selectedDefaults.contains(platform.platform)
                                                     ? DesignTokens.accent : DesignTokens.muted.opacity(0.5))
                            }
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(DesignTokens.surface)
                    }
                }
            } header: {
                Text("Default Platforms")
            } footer: {
                Text("Selected platforms will be pre-selected when composing new posts.")
            }

            if viewModel.hasChanges {
                Section {
                    Button {
                        Task { await viewModel.save() }
                    } label: {
                        HStack {
                            Spacer()
                            if viewModel.isSaving {
                                ProgressView().progressViewStyle(.circular)
                            } else {
                                Text("Save Defaults")
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                        }
                    }
                    .disabled(viewModel.isSaving)
                    .listRowBackground(DesignTokens.accent)
                    .foregroundStyle(.white)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Publish Defaults")
        .task { await viewModel.load() }
        .overlay {
            if viewModel.isLoading {
                ProgressView().progressViewStyle(.circular)
            }
        }
        .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private func platformIcon(_ platform: String) -> String {
        switch platform {
        case "twitter": return "at"
        case "facebook": return "person.2.fill"
        case "bluesky": return "cloud.fill"
        case "threads": return "at.circle.fill"
        default: return "link"
        }
    }

    private func platformColor(_ platform: String) -> Color {
        switch platform {
        case "twitter": return Color(red: 0.11, green: 0.63, blue: 0.95)
        case "facebook": return Color(red: 0.23, green: 0.35, blue: 0.60)
        case "bluesky": return Color(red: 0.0, green: 0.52, blue: 1.0)
        case "threads": return DesignTokens.textPrimary
        default: return DesignTokens.muted
        }
    }
}
