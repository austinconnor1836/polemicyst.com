import SwiftUI

struct CompositionModeSection: View {
    let composition: Composition
    let onModeChanged: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Mode")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            Picker("Composition Mode", selection: Binding(
                get: { composition.mode },
                set: { newValue in onModeChanged(newValue) }
            )) {
                Label("Pre-synced", systemImage: "rectangle.on.rectangle")
                    .tag("pre-synced")
                Label("Timeline", systemImage: "timeline.selection")
                    .tag("timeline")
            }
            .pickerStyle(.segmented)

            Text(composition.mode == "timeline"
                ? "Position reference clips at specific timestamps within the creator video."
                : "Both videos play from the start — best when they're already the same length.")
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}
