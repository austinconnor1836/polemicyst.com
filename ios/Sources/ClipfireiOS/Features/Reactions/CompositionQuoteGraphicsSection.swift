import SwiftUI

struct CompositionQuoteGraphicsSection: View {
    let composition: Composition
    let api: APIClient

    @State private var isDetecting = false
    @State private var quotes: [DetectedQuote] = []
    @State private var enabled = false
    @State private var style = "pull-quote"
    @State private var isLoaded = false
    @State private var errorMessage: String?
    @State private var isSaving = false

    private var hasTranscript: Bool {
        composition.creatorTranscript != nil && composition.creatorTranscript != ""
    }

    private let styles: [(id: String, label: String, icon: String)] = [
        ("pull-quote", "Pull Quote", "text.quote"),
        ("lower-third", "Lower Third", "rectangle.bottomhalf.filled"),
        ("highlight-card", "Card", "rectangle.on.rectangle"),
        ("side-panel", "Side Panel", "sidebar.right"),
        ("typewriter", "Typewriter", "keyboard"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Quote Graphics")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if !quotes.isEmpty {
                    Text("\(quotes.count) quote\(quotes.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.accent)
                }
            }

            if !hasTranscript {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text("Transcript required for quote detection.")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else {
                // Enable toggle
                Toggle(isOn: $enabled) {
                    Text("Enable quote overlays")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .toggleStyle(.switch)
                .onChange(of: enabled) { _, newValue in
                    Task { await updateSettings(enabled: newValue) }
                }

                if enabled {
                    // Style picker
                    stylePicker

                    // Detect button
                    Button {
                        Task { await detect() }
                    } label: {
                        HStack {
                            if isDetecting {
                                ProgressView()
                                    .scaleEffect(0.8)
                            }
                            Text(isDetecting ? "Detecting…" : (quotes.isEmpty ? "Detect Quotes" : "Re-detect"))
                        }
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(DesignTokens.accent.opacity(isDetecting ? 0.3 : 0.15))
                        .foregroundStyle(DesignTokens.accent)
                        .cornerRadius(DesignTokens.cornerRadius)
                    }
                    .disabled(isDetecting)

                    // Quotes list
                    if !quotes.isEmpty {
                        quotesListView
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
        .task {
            guard !isLoaded else { return }
            await loadExisting()
            isLoaded = true
        }
    }

    // MARK: - Style picker

    @ViewBuilder
    private var stylePicker: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Style")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(styles, id: \.id) { s in
                        Button {
                            style = s.id
                            Task { await updateSettings(style: s.id) }
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: s.icon)
                                    .font(.title3)
                                Text(s.label)
                                    .font(.caption2)
                            }
                            .frame(width: 72, height: 56)
                            .background(style == s.id ? DesignTokens.accent.opacity(0.15) : DesignTokens.background)
                            .foregroundStyle(style == s.id ? DesignTokens.accent : DesignTokens.textSecondary)
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(style == s.id ? DesignTokens.accent : Color.clear, lineWidth: 1.5)
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Quotes list

    @ViewBuilder
    private var quotesListView: some View {
        VStack(spacing: 6) {
            ForEach(quotes) { quote in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\u{201C}\(quote.text)\u{201D}")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textPrimary)
                        .lineLimit(3)

                    HStack {
                        if let attr = quote.attribution {
                            Text("— \(attr)")
                                .font(.caption2)
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        Spacer()
                        Text(formatDuration(quote.startS) + " → " + formatDuration(quote.endS))
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(DesignTokens.muted)

                        confidenceBadge(quote.confidence)
                    }
                }
                .padding(8)
                .background(DesignTokens.background)
                .cornerRadius(6)
            }
        }
    }

    @ViewBuilder
    private func confidenceBadge(_ confidence: Double) -> some View {
        let pct = Int(confidence * 100)
        let color: Color = confidence >= 0.8 ? .green : confidence >= 0.5 ? .orange : .red

        Text("\(pct)%")
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(color.opacity(0.15))
            .cornerRadius(3)
    }

    // MARK: - Actions

    private func loadExisting() async {
        do {
            let status = try await api.fetchQuotes(compositionId: composition.id)
            quotes = status.quotes
            style = status.style
            enabled = status.enabled
        } catch {
            // No existing quotes — that's fine
        }
    }

    private func detect() async {
        isDetecting = true
        errorMessage = nil
        defer { isDetecting = false }
        do {
            let response = try await api.detectQuotes(
                compositionId: composition.id,
                body: DetectQuotesRequest(style: style)
            )
            quotes = response.quotes
            if let s = response.style { style = s }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = error.localizedDescription
        }
    }

    private func updateSettings(enabled: Bool? = nil, style: String? = nil) async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.updateQuotes(
                compositionId: composition.id,
                body: UpdateQuotesRequest(enabled: enabled, style: style)
            )
        } catch {
            // Silently fail
        }
    }
}
