import SwiftUI

struct CompositionCaptionsSection: View {
    let api: APIClient

    @State private var settings: AutomationSettings?
    @State private var isLoading = true
    @State private var isSaving = false

    private let captionStyles = [
        ("default", "Default"),
        ("bold", "Bold"),
        ("minimal", "Minimal"),
        ("none", "None"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Captions")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if isSaving {
                    ProgressView()
                        .scaleEffect(0.7)
                }
            }

            if isLoading {
                HStack {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Loading settings…")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else if var s = settings {
                Toggle(isOn: Binding(
                    get: { s.captionsEnabled },
                    set: { newValue in
                        s.captionsEnabled = newValue
                        settings = s
                        Task { await saveSettings() }
                    }
                )) {
                    Text("Enable captions")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .toggleStyle(.switch)

                if s.captionsEnabled {
                    VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                        Text("Caption Style")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.textSecondary)

                        Picker("Caption Style", selection: Binding(
                            get: { s.captionStyle },
                            set: { newValue in
                                s.captionStyle = newValue
                                settings = s
                                Task { await saveSettings() }
                            }
                        )) {
                            ForEach(captionStyles, id: \.0) { style in
                                Text(style.1).tag(style.0)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
        .task { await loadSettings() }
    }

    private func loadSettings() async {
        isLoading = true
        defer { isLoading = false }
        do {
            settings = try await api.fetchAutomationSettings()
        } catch {
            // Use nil — section won't render controls
        }
    }

    private func saveSettings() async {
        guard let s = settings else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            settings = try await api.updateAutomationSettings(s)
        } catch {
            // Silently fail
        }
    }
}
