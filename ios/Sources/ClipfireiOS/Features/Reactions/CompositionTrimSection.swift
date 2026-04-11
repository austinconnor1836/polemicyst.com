import SwiftUI

// MARK: - Creator trim controls

struct CompositionTrimSection: View {
    let composition: Composition
    let onSave: (Double?, Double?) -> Void

    @State private var trimStart: Double = 0
    @State private var trimEnd: Double = 0
    @State private var isEditing = false

    private var duration: Double { composition.creatorDurationS ?? 0 }
    private var hasCreator: Bool { composition.creatorS3Url != nil && composition.creatorS3Url != "" }

    var body: some View {
        if hasCreator && duration > 0 {
            VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                HStack {
                    Text("Trim")
                        .font(.headline)
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    if trimStart > 0 || trimEnd < duration {
                        Text(formatDuration(trimEnd - trimStart) + " of " + formatDuration(duration))
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }

                VStack(spacing: DesignTokens.smallSpacing) {
                    // Start slider
                    HStack {
                        Text("Start")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 40, alignment: .leading)
                        Slider(value: $trimStart, in: 0...max(trimEnd - 0.5, 0)) { editing in
                            isEditing = editing
                            if !editing { onSave(trimStart, trimEnd) }
                        }
                        Text(formatTimestamp(trimStart))
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.muted)
                            .frame(width: 50, alignment: .trailing)
                    }

                    // End slider
                    HStack {
                        Text("End")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 40, alignment: .leading)
                        Slider(value: $trimEnd, in: max(trimStart + 0.5, 0.5)...duration) { editing in
                            isEditing = editing
                            if !editing { onSave(trimStart, trimEnd) }
                        }
                        Text(formatTimestamp(trimEnd))
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.muted)
                            .frame(width: 50, alignment: .trailing)
                    }
                }

                if trimStart > 0 || trimEnd < duration {
                    Button {
                        trimStart = 0
                        trimEnd = duration
                        onSave(0, nil)
                    } label: {
                        Label("Reset Trim", systemImage: "arrow.counterclockwise")
                            .font(.caption)
                    }
                    .foregroundStyle(DesignTokens.accent)
                }
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
            .onAppear {
                trimStart = composition.creatorTrimStartS
                trimEnd = composition.creatorTrimEndS ?? duration
            }
            .onChange(of: composition.id) { _, _ in
                trimStart = composition.creatorTrimStartS
                trimEnd = composition.creatorTrimEndS ?? duration
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

// MARK: - Per-track trim sheet

struct TrackTrimSheet: View {
    let track: CompositionTrack
    let onSave: (Double?, Double?) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var trimStart: Double = 0
    @State private var trimEnd: Double = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: DesignTokens.largeSpacing) {
                Text(track.label ?? "Track")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                Text(formatDuration(track.durationS))
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)

                VStack(spacing: DesignTokens.spacing) {
                    HStack {
                        Text("Start")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 40, alignment: .leading)
                        Slider(value: $trimStart, in: 0...max(trimEnd - 0.5, 0))
                        Text(formatTimestamp(trimStart))
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.muted)
                            .frame(width: 50, alignment: .trailing)
                    }

                    HStack {
                        Text("End")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 40, alignment: .leading)
                        Slider(value: $trimEnd, in: max(trimStart + 0.5, 0.5)...track.durationS)
                        Text(formatTimestamp(trimEnd))
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.muted)
                            .frame(width: 50, alignment: .trailing)
                    }
                }

                Text("Trimmed: " + formatDuration(trimEnd - trimStart))
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)

                Spacer()
            }
            .padding()
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Trim Track")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(trimStart, trimEnd)
                        dismiss()
                    }
                }
            }
            .onAppear {
                trimStart = track.trimStartS
                trimEnd = track.trimEndS ?? track.durationS
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
