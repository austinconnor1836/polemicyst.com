import SwiftUI

struct CompositionAudioSection: View {
    let composition: Composition
    let onAudioModeChanged: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Audio")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            Picker("Audio Mode", selection: Binding(
                get: { composition.audioMode },
                set: { newValue in onAudioModeChanged(newValue) }
            )) {
                Text("Creator").tag("creator")
                Text("Reference").tag("reference")
                Text("Both").tag("both")
            }
            .pickerStyle(.segmented)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}
