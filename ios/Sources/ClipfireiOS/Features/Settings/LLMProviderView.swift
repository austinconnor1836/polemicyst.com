import SwiftUI

@MainActor
public final class LLMProviderViewModel: ObservableObject {
    @Published public var currentProvider = "ollama"
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?
    @Published public var allowedProviders: [String] = ["ollama"]

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let providerTask = api.fetchLLMProvider()
            async let subTask = api.fetchSubscription()
            let (provider, sub) = try await (providerTask, subTask)
            currentProvider = provider.llmProvider
            allowedProviders = sub.plan.limits.llmProviders
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to load provider settings"
        }
    }

    public func updateProvider(_ provider: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await api.updateLLMProvider(UpdateLLMProviderRequest(llmProvider: provider))
            currentProvider = result.llmProvider
        } catch let error as APIError {
            if error.isUpgradeRequired {
                upgradeError = error
                if let allowed = error.allowedProviders {
                    allowedProviders = allowed
                }
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = "Failed to update provider"
        }
    }
}

public struct LLMProviderView: View {
    @StateObject private var viewModel: LLMProviderViewModel

    private static let allProviders: [(id: String, label: String, icon: String)] = [
        ("ollama", "Ollama", "desktopcomputer"),
        ("gemini", "Gemini", "sparkles"),
    ]

    public init(viewModel: LLMProviderViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Self.allProviders, id: \.id) { provider in
                        providerRow(provider)
                    }
                } header: {
                    Text("Default LLM Provider")
                } footer: {
                    Text("This provider will be used for clip scoring by default. Some providers require a paid plan.")
                        .foregroundStyle(DesignTokens.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("LLM Provider")
            .task { await viewModel.load() }
            .overlay {
                if viewModel.isLoading {
                    ProgressView().progressViewStyle(.circular)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .sheet(item: $viewModel.upgradeError) { error in
                UpgradePromptView(
                    message: error.localizedDescription,
                    onDismiss: { viewModel.upgradeError = nil }
                )
                .presentationDetents([.medium])
            }
        }
    }

    @ViewBuilder
    private func providerRow(_ provider: (id: String, label: String, icon: String)) -> some View {
        let isAllowed = viewModel.allowedProviders.contains(provider.id)
        let isSelected = viewModel.currentProvider == provider.id

        Button {
            if isAllowed {
                Task { await viewModel.updateProvider(provider.id) }
            }
        } label: {
            HStack {
                Image(systemName: provider.icon)
                    .frame(width: 24)
                    .foregroundStyle(isAllowed ? DesignTokens.accent : DesignTokens.muted)

                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.label)
                        .foregroundStyle(isAllowed ? DesignTokens.textPrimary : DesignTokens.muted)
                    if !isAllowed {
                        Text("Upgrade required")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(DesignTokens.accent)
                } else if !isAllowed {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
        }
        .listRowBackground(DesignTokens.surface)
    }
}
