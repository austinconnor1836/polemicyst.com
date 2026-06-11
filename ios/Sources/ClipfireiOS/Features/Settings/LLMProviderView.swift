import SwiftUI

@MainActor
public final class LLMProviderViewModel: ObservableObject {
    @Published public var currentProvider = "ollama"
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    // upgradeError and allowedProviders removed: LLM provider is no longer plan-gated. // TODO(pricing)

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let provider = try await api.fetchLLMProvider()
            currentProvider = provider.llmProvider
            // No longer fetching subscription for allowedProviders — all providers are available on every plan.
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load provider settings: \(error.localizedDescription)"
        }
    }

    public func updateProvider(_ provider: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await api.updateLLMProvider(UpdateLLMProviderRequest(llmProvider: provider))
            currentProvider = result.llmProvider
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to update provider: \(error.localizedDescription)"
        }
    }
}

public struct LLMProviderView: View {
    @StateObject private var viewModel: LLMProviderViewModel
    @State private var showErrorAlert = false

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
                    // LLM provider is no longer plan-gated — all providers available on every plan. // TODO(pricing)
                    Text("This provider will be used for clip scoring by default.")
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
            .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }

    @ViewBuilder
    private func providerRow(_ provider: (id: String, label: String, icon: String)) -> some View {
        // All providers are available on every plan — no lock/upgrade UI needed. // TODO(pricing)
        let isSelected = viewModel.currentProvider == provider.id

        Button {
            Task { await viewModel.updateProvider(provider.id) }
        } label: {
            HStack {
                Image(systemName: provider.icon)
                    .frame(width: 24)
                    .foregroundStyle(DesignTokens.accent)

                Text(provider.label)
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(DesignTokens.accent)
                }
            }
        }
        .listRowBackground(DesignTokens.surface)
    }
}
