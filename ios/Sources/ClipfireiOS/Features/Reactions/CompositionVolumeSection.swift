import SwiftUI

struct CompositionVolumeSection: View {
    let composition: Composition
    let onCreatorVolumeChanged: (Double) -> Void
    let onReferenceVolumeChanged: (Double) -> Void

    @State private var creatorVolume: Double = 100
    @State private var referenceVolume: Double = 100
    @State private var isEditingCreator = false
    @State private var isEditingReference = false

    private var showBoth: Bool { composition.audioMode == "both" }
    private var showCreator: Bool { composition.audioMode == "creator" || showBoth }
    private var showReference: Bool { composition.audioMode == "reference" || showBoth }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Volume")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if showCreator {
                volumeSlider(
                    label: "Creator",
                    value: $creatorVolume,
                    isEditing: $isEditingCreator,
                    onCommit: { onCreatorVolumeChanged(creatorVolume) }
                )
            }

            if showReference {
                volumeSlider(
                    label: "Reference",
                    value: $referenceVolume,
                    isEditing: $isEditingReference,
                    onCommit: { onReferenceVolumeChanged(referenceVolume) }
                )
            }

            if !showCreator && !showReference {
                Text("Select an audio mode to adjust volume")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
        .onAppear {
            creatorVolume = composition.creatorVolume
            referenceVolume = composition.referenceVolume
        }
        .onChange(of: composition.creatorVolume) { _, newValue in
            if !isEditingCreator { creatorVolume = newValue }
        }
        .onChange(of: composition.referenceVolume) { _, newValue in
            if !isEditingReference { referenceVolume = newValue }
        }
    }

    @ViewBuilder
    private func volumeSlider(
        label: String,
        value: Binding<Double>,
        isEditing: Binding<Bool>,
        onCommit: @escaping () -> Void
    ) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .frame(width: 70, alignment: .leading)

            Image(systemName: volumeIcon(for: value.wrappedValue))
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
                .frame(width: 16)

            Slider(value: value, in: 0...200, step: 5) { editing in
                isEditing.wrappedValue = editing
                if !editing { onCommit() }
            }

            Text("\(Int(value.wrappedValue))%")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(DesignTokens.muted)
                .frame(width: 40, alignment: .trailing)
        }
    }

    private func volumeIcon(for value: Double) -> String {
        if value == 0 { return "speaker.slash" }
        if value < 50 { return "speaker.wave.1" }
        if value < 150 { return "speaker.wave.2" }
        return "speaker.wave.3"
    }
}
