import SwiftUI

@MainActor
public final class AccountSettingsViewModel: ObservableObject {
    @Published public var autoGenerateClips: Bool
    @Published public var viralitySettings: ViralitySettings
    @Published public var globalSettings: AutomationSettings?
    @Published public var isLoading = false
    @Published public var isSaving = false
    @Published public var errorMessage: String?
    @Published public var hasChanges = false
    @Published public var didSave = false

    public let feed: VideoFeed
    private let api: APIClient

    public init(feed: VideoFeed, api: APIClient) {
        self.feed = feed
        self.api = api
        self.autoGenerateClips = feed.autoGenerateClips

        // Parse feed's viralitySettings dictionary into typed struct
        if let dict = feed.viralitySettings {
            self.viralitySettings = ViralitySettings(
                scoringMode: (dict["scoringMode"]?.value as? String) ?? "heuristic",
                targetPlatform: (dict["targetPlatform"]?.value as? String) ?? "all",
                contentStyle: (dict["contentStyle"]?.value as? String) ?? "auto",
                saferClips: (dict["saferClips"]?.value as? Bool) ?? false,
                includeAudio: (dict["includeAudio"]?.value as? Bool) ?? false,
                llmProvider: (dict["llmProvider"]?.value as? String) ?? "ollama"
            )
        } else {
            self.viralitySettings = ViralitySettings()
        }
    }

    public func loadGlobalSettings() async {
        do {
            globalSettings = try await api.fetchAutomationSettings()
        } catch {
            // Non-blocking — just won't show global indicators
        }
    }

    public func saveSettings() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let body: [String: AnyCodable] = [
                "autoGenerateClips": AnyCodable(autoGenerateClips),
                "viralitySettings": AnyCodable(viralitySettings.toDictionary().mapValues { $0.value }),
            ]
            _ = try await api.updateFeed(id: feed.id, body: body)
            hasChanges = false
            didSave = true
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to save settings"
        }
    }

    public func resetToGlobalDefaults() async {
        guard let global = globalSettings else { return }
        autoGenerateClips = global.autoGenerateClips
        viralitySettings = global.viralitySettings
        hasChanges = true
    }

    public func markChanged() {
        hasChanges = true
    }

    // MARK: - Global comparison helpers

    public func autoGenerateMatchesGlobal() -> Bool {
        globalSettings?.autoGenerateClips == autoGenerateClips
    }
}

public struct AccountSettingsView: View {
    @StateObject private var viewModel: AccountSettingsViewModel
    @Environment(\.dismiss) private var dismiss

    public init(viewModel: AccountSettingsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Toggle("Auto-Generate Clips", isOn: $viewModel.autoGenerateClips)
                            .onChange(of: viewModel.autoGenerateClips) { viewModel.markChanged() }
                    }
                    if viewModel.autoGenerateMatchesGlobal() {
                        Text("Matches global default")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                } header: {
                    Text("Clip Generation")
                }
                .listRowBackground(DesignTokens.surface)

                Section {
                    ViralitySettingsView(settings: $viewModel.viralitySettings)
                        .onChange(of: viewModel.viralitySettings) { viewModel.markChanged() }
                } header: {
                    Text("Virality Settings")
                }
                .listRowBackground(DesignTokens.surface)

                if viewModel.globalSettings != nil {
                    Section {
                        Button {
                            Task { await viewModel.resetToGlobalDefaults() }
                        } label: {
                            HStack {
                                Spacer()
                                Label("Reset to Global Defaults", systemImage: "arrow.counterclockwise")
                                    .foregroundStyle(DesignTokens.accent)
                                Spacer()
                            }
                        }
                    }
                    .listRowBackground(DesignTokens.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle(viewModel.feed.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if viewModel.hasChanges {
                    Button {
                        Task {
                            await viewModel.saveSettings()
                            if viewModel.didSave {
                                dismiss()
                            }
                        }
                    } label: {
                        Group {
                            if viewModel.isSaving {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .tint(.white)
                            } else {
                                Text("Save Changes")
                                    .fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(DesignTokens.accent)
                    .disabled(viewModel.isSaving)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                    .background(
                        DesignTokens.background
                            .shadow(color: .black.opacity(0.3), radius: 8, y: -4)
                            .ignoresSafeArea()
                    )
                }
            }
            .task { await viewModel.loadGlobalSettings() }
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
        }
    }
}
