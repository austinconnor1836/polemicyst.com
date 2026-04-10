import SwiftUI

struct CompositionAutoEditSection: View {
    let composition: Composition
    let api: APIClient

    @State private var isAnalyzing = false
    @State private var result: AutoEditResponse?
    @State private var errorMessage: String?
    @State private var aggressiveness = "balanced"
    @State private var badTakeDetection = true
    @State private var showCuts = false

    private var hasTranscript: Bool {
        composition.creatorTranscript != nil && composition.creatorTranscript != ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Auto-Edit")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if let r = result {
                    Text("\(r.summary.totalCuts) cuts")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.accent)
                }
            }

            if !hasTranscript {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text("Transcript required — transcription happens automatically during render.")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else {
                // Settings
                settingsRow

                // Analyze button
                Button {
                    Task { await analyze() }
                } label: {
                    HStack {
                        if isAnalyzing {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                        Text(isAnalyzing ? "Analyzing…" : (result != nil ? "Re-analyze" : "Analyze"))
                    }
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(DesignTokens.accent.opacity(isAnalyzing ? 0.3 : 0.15))
                    .foregroundStyle(DesignTokens.accent)
                    .cornerRadius(DesignTokens.cornerRadius)
                }
                .disabled(isAnalyzing)

                // Results
                if let r = result {
                    summaryView(r.summary)

                    if !r.cuts.isEmpty {
                        Button {
                            withAnimation { showCuts.toggle() }
                        } label: {
                            HStack {
                                Text(showCuts ? "Hide Cuts" : "Show Cuts")
                                    .font(.caption)
                                Image(systemName: showCuts ? "chevron.up" : "chevron.down")
                                    .font(.caption2)
                            }
                            .foregroundStyle(DesignTokens.accent)
                        }

                        if showCuts {
                            cutsListView(r.cuts)
                        }
                    }
                }

                if let err = errorMessage {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Settings

    @ViewBuilder
    private var settingsRow: some View {
        VStack(spacing: DesignTokens.smallSpacing) {
            HStack {
                Text("Aggressiveness")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
                Spacer()
            }
            Picker("Aggressiveness", selection: $aggressiveness) {
                Text("Conservative").tag("conservative")
                Text("Balanced").tag("balanced")
                Text("Aggressive").tag("aggressive")
            }
            .pickerStyle(.segmented)

            Toggle(isOn: $badTakeDetection) {
                Text("Detect bad takes")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .toggleStyle(.switch)
        }
    }

    // MARK: - Summary

    @ViewBuilder
    private func summaryView(_ summary: AutoEditSummary) -> some View {
        HStack(spacing: DesignTokens.largeSpacing) {
            statItem(value: "\(summary.silenceCuts)", label: "Silence")
            statItem(value: "\(summary.badTakeCuts)", label: "Bad takes")
            statItem(value: formatDuration(summary.totalRemovedS), label: "Removed")
            statItem(value: formatDuration(summary.newDurationS), label: "New length")
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)
            Text(label)
                .font(.caption2)
                .foregroundStyle(DesignTokens.muted)
        }
    }

    // MARK: - Cuts list

    @ViewBuilder
    private func cutsListView(_ cuts: [AutoEditCut]) -> some View {
        VStack(spacing: 4) {
            ForEach(cuts) { cut in
                HStack {
                    Image(systemName: cut.reason == "silence" ? "speaker.slash" : "arrow.uturn.backward")
                        .font(.caption2)
                        .foregroundStyle(cut.reason == "silence" ? .orange : .red)
                        .frame(width: 16)

                    Text(formatDuration(cut.startS) + " → " + formatDuration(cut.endS))
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(DesignTokens.textSecondary)

                    Text(cut.detail)
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                        .lineLimit(1)

                    Spacer()

                    Text(formatDuration(cut.endS - cut.startS))
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(DesignTokens.muted)
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: - Action

    private func analyze() async {
        isAnalyzing = true
        errorMessage = nil
        defer { isAnalyzing = false }
        do {
            result = try await api.runAutoEdit(
                compositionId: composition.id,
                body: AutoEditRequest(
                    settings: AutoEditSettings(
                        badTakeDetection: badTakeDetection,
                        aggressiveness: aggressiveness
                    ),
                    apply: true
                )
            )
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = error.localizedDescription
        }
    }
}
