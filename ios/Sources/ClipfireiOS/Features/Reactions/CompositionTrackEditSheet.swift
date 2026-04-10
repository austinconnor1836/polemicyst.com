import SwiftUI

struct CompositionTrackEditSheet: View {
    let track: CompositionTrack
    let creatorDuration: Double
    let isTimelineMode: Bool
    let onSave: (UpdateTrackRequest) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var label: String = ""
    @State private var startAtS: Double = 0
    @State private var trimStartS: Double = 0
    @State private var trimEndS: Double = 0

    var body: some View {
        NavigationStack {
            Form {
                // Label
                Section("Label") {
                    TextField("Track name", text: $label)
                }

                // Position (timeline mode only)
                if isTimelineMode {
                    Section("Position") {
                        HStack {
                            Text("Start at")
                                .foregroundStyle(DesignTokens.textSecondary)
                            Spacer()
                            Text(formatTimestamp(startAtS))
                                .monospacedDigit()
                                .foregroundStyle(DesignTokens.textPrimary)
                        }
                        Slider(value: $startAtS, in: 0...max(creatorDuration - 0.5, 0), step: 0.5)
                    }
                }

                // Trim
                Section("Trim") {
                    HStack {
                        Text("Start")
                            .foregroundStyle(DesignTokens.textSecondary)
                        Spacer()
                        Text(formatTimestamp(trimStartS))
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.textPrimary)
                    }
                    Slider(value: $trimStartS, in: 0...max(trimEndS - 0.5, 0))

                    HStack {
                        Text("End")
                            .foregroundStyle(DesignTokens.textSecondary)
                        Spacer()
                        Text(formatTimestamp(trimEndS))
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.textPrimary)
                    }
                    Slider(value: $trimEndS, in: max(trimStartS + 0.5, 0.5)...track.durationS)

                    HStack {
                        Text("Duration")
                            .foregroundStyle(DesignTokens.textSecondary)
                        Spacer()
                        Text(formatDuration(trimEndS - trimStartS) + " of " + formatDuration(track.durationS))
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }

                // Info (read-only)
                Section("Info") {
                    HStack {
                        Text("Dimensions")
                            .foregroundStyle(DesignTokens.textSecondary)
                        Spacer()
                        if let w = track.width, let h = track.height {
                            Text("\(w)×\(h)")
                                .foregroundStyle(DesignTokens.muted)
                        }
                    }
                    HStack {
                        Text("Audio")
                            .foregroundStyle(DesignTokens.textSecondary)
                        Spacer()
                        Text(track.hasAudio ? "Yes" : "No")
                            .foregroundStyle(DesignTokens.muted)
                    }
                }
            }
            .navigationTitle("Edit Track")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(UpdateTrackRequest(
                            label: label.isEmpty ? nil : label,
                            startAtS: isTimelineMode ? startAtS : nil,
                            trimStartS: trimStartS,
                            trimEndS: trimEndS
                        ))
                        dismiss()
                    }
                }
            }
            .onAppear {
                label = track.label ?? ""
                startAtS = track.startAtS
                trimStartS = track.trimStartS
                trimEndS = track.trimEndS ?? track.durationS
            }
        }
    }

    private func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        let frac = Int((seconds.truncatingRemainder(dividingBy: 1)) * 10)
        return String(format: "%d:%02d.%d", mins, secs, frac)
    }
}
