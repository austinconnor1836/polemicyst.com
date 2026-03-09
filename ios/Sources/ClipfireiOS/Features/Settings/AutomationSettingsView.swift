import SwiftUI

@MainActor
public final class AutomationSettingsViewModel: ObservableObject {
    @Published public var settings = AutomationSettings()
    @Published public var isLoading = false
    @Published public var isSaving = false
    @Published public var errorMessage: String?
    @Published public var hasChanges = false

    private let api: APIClient
    private var originalSettings: AutomationSettings?

    public init(api: APIClient) {
        self.api = api
    }

    public func loadSettings() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await api.fetchAutomationSettings()
            settings = loaded
            originalSettings = loaded
            hasChanges = false
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to load settings"
        }
    }

    public func saveSettings() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await api.updateAutomationSettings(settings)
            settings = saved
            originalSettings = saved
            hasChanges = false
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to save settings"
        }
    }

    public func markChanged() {
        hasChanges = true
    }
}

public struct AutomationSettingsView: View {
    @StateObject private var viewModel: AutomationSettingsViewModel

    private static let captionStyles = [
        ("default", "Default"),
        ("bold", "Bold"),
        ("minimal", "Minimal"),
        ("none", "None"),
    ]

    private static let aspectRatios = [
        ("9:16", "9:16 (Vertical)"),
        ("1:1", "1:1 (Square)"),
        ("4:5", "4:5 (Portrait)"),
        ("16:9", "16:9 (Landscape)"),
    ]

    public init(viewModel: AutomationSettingsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        List {
            Section {
                Toggle("Enable Automation", isOn: $viewModel.settings.enabled)
                    .onChange(of: viewModel.settings.enabled) { viewModel.markChanged() }
            } header: {
                Text("Full Automation")
            } footer: {
                Text("When enabled, new videos from connected accounts will be automatically processed.")
                    .foregroundStyle(DesignTokens.muted)
            }
            .listRowBackground(DesignTokens.surface)

            Section {
                Toggle("Auto-Generate Clips", isOn: $viewModel.settings.autoGenerateClips)
                    .onChange(of: viewModel.settings.autoGenerateClips) { viewModel.markChanged() }

                ViralitySettingsView(settings: $viewModel.settings.viralitySettings)
                    .onChange(of: viewModel.settings.viralitySettings) { viewModel.markChanged() }
            } header: {
                Text("Clip Generation")
            }
            .listRowBackground(DesignTokens.surface)

            Section {
                Toggle("Enable Captions", isOn: $viewModel.settings.captionsEnabled)
                    .onChange(of: viewModel.settings.captionsEnabled) { viewModel.markChanged() }

                Picker("Caption Style", selection: $viewModel.settings.captionStyle) {
                    ForEach(Self.captionStyles, id: \.0) { style in
                        Text(style.1).tag(style.0)
                    }
                }
                .onChange(of: viewModel.settings.captionStyle) { viewModel.markChanged() }
            } header: {
                Text("Captions")
            }
            .listRowBackground(DesignTokens.surface)

            Section {
                Picker("Aspect Ratio", selection: $viewModel.settings.aspectRatio) {
                    ForEach(Self.aspectRatios, id: \.0) { ratio in
                        Text(ratio.1).tag(ratio.0)
                    }
                }
                .onChange(of: viewModel.settings.aspectRatio) { viewModel.markChanged() }
            } header: {
                Text("Aspect Ratio")
            }
            .listRowBackground(DesignTokens.surface)

            Section {
                Toggle("Auto-Publish", isOn: $viewModel.settings.autoPublish)
                    .onChange(of: viewModel.settings.autoPublish) { viewModel.markChanged() }
            } header: {
                Text("Publishing")
            } footer: {
                Text("Automatically publish generated clips to selected platforms.")
                    .foregroundStyle(DesignTokens.muted)
            }
            .listRowBackground(DesignTokens.surface)
        }
        .scrollContentBackground(.hidden)
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Clip Generation")
        .safeAreaInset(edge: .bottom) {
            if viewModel.hasChanges {
                Button {
                    Task { await viewModel.saveSettings() }
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
        .task { await viewModel.loadSettings() }
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
