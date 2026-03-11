import SwiftUI

// MARK: - ViewModel

@MainActor
public final class TruthAnalysisViewModel: ObservableObject {
    @Published public private(set) var result: TruthAnalysisResult?
    @Published public private(set) var isLoading = false
    @Published public var errorMessage: String?
    @Published public var provider = "gemini"

    let api: APIClient
    let feedVideoId: String
    let clipId: String?

    public init(api: APIClient, feedVideoId: String, clipId: String? = nil) {
        self.api = api
        self.feedVideoId = feedVideoId
        self.clipId = clipId
    }

    public func loadExisting() async {
        do {
            let response = try await api.fetchTruthAnalysis(feedVideoId: feedVideoId, clipId: clipId)
            if let r = response.result {
                result = r
            }
        } catch {
            // No existing analysis — that's fine
        }
    }

    public func runAnalysis() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await api.runTruthAnalysis(
                feedVideoId: feedVideoId,
                clipId: clipId,
                provider: provider
            )
            if let r = response.result {
                result = r
            } else if let err = response.error {
                errorMessage = err
            }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch let error as URLError where error.code == .timedOut {
            errorMessage = "Analysis timed out. Try again — it may take up to 2 minutes."
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Analysis failed: \(error.localizedDescription)"
        }
    }

    public func reset() {
        result = nil
        errorMessage = nil
    }
}

// MARK: - View

public struct TruthAnalysisView: View {
    @StateObject private var viewModel: TruthAnalysisViewModel

    public init(api: APIClient, feedVideoId: String, clipId: String? = nil) {
        _viewModel = StateObject(wrappedValue: TruthAnalysisViewModel(
            api: api,
            feedVideoId: feedVideoId,
            clipId: clipId
        ))
    }

    public var body: some View {
        Group {
            if let result = viewModel.result {
                resultsView(result)
            } else if viewModel.isLoading {
                loadingView
            } else {
                emptyView
            }
        }
        .task { await viewModel.loadExisting() }
    }

    // MARK: - Empty state

    private var emptyView: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Label {
                Text("Verify with AI")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
            } icon: {
                Image(systemName: "checkmark.shield")
                    .foregroundStyle(DesignTokens.muted)
            }

            Text("Analyze the transcript for assertions, logical fallacies, bias, and fact-checking needs.")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            HStack(spacing: DesignTokens.smallSpacing) {
                Picker("Provider", selection: $viewModel.provider) {
                    Text("Gemini").tag("gemini")
                    Text("Ollama").tag("ollama")
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 180)

                Button {
                    Task { await viewModel.runAnalysis() }
                } label: {
                    Label("Analyze", systemImage: "sparkles")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.accent)
            }

            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Loading state

    private var loadingView: some View {
        AnalysisLoadingView()
            .padding(DesignTokens.spacing)
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Results

    private func resultsView(_ result: TruthAnalysisResult) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            // Header
            HStack {
                Label {
                    Text("Verify with AI")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.textPrimary)
                } icon: {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(DesignTokens.muted)
                }

                Spacer()

                biasLevelBadge(result.overallBiasLevel)
                credibilityBadge(result.overallCredibility)
            }

            // Summary
            Text(result.summary)
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            // Assertions
            if !result.assertions.isEmpty {
                collapsibleSection("Assertions", count: result.assertions.count, defaultOpen: true) {
                    ForEach(result.assertions) { assertion in
                        assertionRow(assertion)
                    }
                }
            }

            // Key Assumptions
            if !result.keyAssumptions.isEmpty {
                collapsibleSection("Key Assumptions", count: result.keyAssumptions.count) {
                    ForEach(result.keyAssumptions, id: \.self) { assumption in
                        HStack(alignment: .top, spacing: 6) {
                            Text("\u{2022}")
                                .foregroundStyle(DesignTokens.muted)
                            Text(assumption)
                                .font(.caption)
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                }
            }

            // Fallacies
            if !result.fallacies.isEmpty {
                collapsibleSection("Logical Fallacies", count: result.fallacies.count) {
                    ForEach(result.fallacies) { fallacy in
                        fallacyRow(fallacy)
                    }
                }
            }

            // Biases
            if !result.biases.isEmpty {
                collapsibleSection("Bias Indicators", count: result.biases.count) {
                    ForEach(result.biases) { bias in
                        biasRow(bias)
                    }
                }
            }

            // Fact checks
            if !result.recommendedFactChecks.isEmpty {
                collapsibleSection("Recommended Fact Checks", count: result.recommendedFactChecks.count) {
                    ForEach(Array(result.recommendedFactChecks.enumerated()), id: \.offset) { index, check in
                        HStack(alignment: .top, spacing: 6) {
                            Text("\(index + 1).")
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                                .frame(width: 20, alignment: .leading)
                            Text(check)
                                .font(.caption)
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                }
            }

            // Footer buttons
            HStack(spacing: DesignTokens.smallSpacing) {
                Button {
                    viewModel.reset()
                } label: {
                    Label("Re-run analysis", systemImage: "arrow.clockwise")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
                .tint(DesignTokens.muted)

                NavigationLink {
                    AnalysisChatView(
                        api: viewModel.api,
                        feedVideoId: viewModel.feedVideoId,
                        clipId: viewModel.clipId
                    )
                } label: {
                    Label("Chat about this", systemImage: "bubble.left.and.bubble.right")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
                .tint(DesignTokens.accent)
            }
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Row Views

    private func assertionRow(_ assertion: TruthAssertion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 6) {
                categoryBadge(assertion.category)
                Text(assertion.text)
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            if assertion.factCheckNeeded {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                    Text(assertion.factCheckReason ?? "Needs fact-checking")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        }
        .padding(DesignTokens.smallSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    private func fallacyRow(_ fallacy: TruthFallacy) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                severityBadge(fallacy.severity)
                Text(fallacy.name)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            Text(fallacy.description)
                .font(.caption2)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding(DesignTokens.smallSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    private func biasRow(_ bias: TruthBias) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(bias.type)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
                if let direction = bias.direction {
                    Text(direction)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(DesignTokens.background)
                        .cornerRadius(4)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
            Text(bias.description)
                .font(.caption2)
                .foregroundStyle(DesignTokens.textSecondary)
            Text("Evidence: \(bias.evidence)")
                .font(.caption2)
                .italic()
                .foregroundStyle(DesignTokens.muted)
        }
        .padding(DesignTokens.smallSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    // MARK: - Badges

    private func categoryBadge(_ category: String) -> some View {
        let (label, color) = categoryStyle(category)
        return Text(label)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .cornerRadius(4)
    }

    private func categoryStyle(_ category: String) -> (String, Color) {
        switch category {
        case "factual": return ("factual", .blue)
        case "opinion": return ("opinion", .gray)
        case "assumption": return ("assumption", .orange)
        case "claim": return ("claim", .purple)
        default: return (category, DesignTokens.muted)
        }
    }

    private func severityBadge(_ severity: String) -> some View {
        let (label, color) = severityStyle(severity)
        return Text(label)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .cornerRadius(4)
    }

    private func severityStyle(_ severity: String) -> (String, Color) {
        switch severity {
        case "minor": return ("minor", .yellow)
        case "moderate": return ("moderate", .orange)
        case "major": return ("major", .red)
        default: return (severity, DesignTokens.muted)
        }
    }

    private func biasLevelBadge(_ level: String) -> some View {
        let color: Color = switch level {
        case "low": .green
        case "moderate": .orange
        case "high": .red
        default: DesignTokens.muted
        }
        return Text("Bias: \(level)")
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .cornerRadius(4)
    }

    private func credibilityBadge(_ score: Double) -> some View {
        let color: Color = score >= 7 ? .green : score >= 4 ? .orange : .red
        return Text("\(Int(score))/10")
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundStyle(color)
            .cornerRadius(4)
    }

    // MARK: - Collapsible section

    private func collapsibleSection<Content: View>(
        _ title: String,
        count: Int,
        defaultOpen: Bool = false,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        CollapsibleSectionView(title: title, count: count, defaultOpen: defaultOpen, content: content)
    }
}

// MARK: - Collapsible Section Helper

private struct CollapsibleSectionView<Content: View>: View {
    let title: String
    let count: Int
    @State private var isOpen: Bool
    let content: () -> Content

    init(title: String, count: Int, defaultOpen: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.count = count
        _isOpen = State(initialValue: defaultOpen)
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isOpen.toggle() }
            } label: {
                HStack {
                    Text("\(title) (\(count))")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                }
                .padding(.vertical, DesignTokens.smallSpacing)
            }
            .buttonStyle(.plain)

            if isOpen {
                VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                    content()
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, DesignTokens.smallSpacing)
        .background(DesignTokens.background.opacity(0.5))
        .cornerRadius(8)
    }
}

// MARK: - Animated Loading View

private struct AnalysisLoadingView: View {
    private static let steps = [
        "Sending transcript to AI...",
        "Extracting assertions and claims...",
        "Checking for logical fallacies...",
        "Analyzing bias indicators...",
        "Evaluating overall credibility...",
        "Compiling results...",
    ]

    @State private var currentStep = 0
    @State private var elapsedSeconds = 0
    @State private var dotCount = 0

    private let stepTimer = Timer.publish(every: 8, on: .main, in: .common).autoconnect()
    private let secondTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let dotTimer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Label {
                Text("Verify with AI")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
            } icon: {
                Image(systemName: "checkmark.shield")
                    .foregroundStyle(DesignTokens.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Animated step indicator
            HStack(spacing: DesignTokens.smallSpacing) {
                ProgressView()
                    .tint(DesignTokens.accent)
                    .controlSize(.small)
                Text(Self.steps[currentStep])
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .contentTransition(.numericText())
            }

            // Progress dots
            HStack(spacing: 4) {
                ForEach(0..<Self.steps.count, id: \.self) { index in
                    Circle()
                        .fill(index <= currentStep ? DesignTokens.accent : DesignTokens.muted.opacity(0.3))
                        .frame(width: 6, height: 6)
                }
            }

            // Elapsed time + reassurance
            Text(elapsedLabel)
                .font(.caption2)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .onReceive(stepTimer) { _ in
            withAnimation(.easeInOut(duration: 0.3)) {
                if currentStep < Self.steps.count - 1 {
                    currentStep += 1
                }
            }
        }
        .onReceive(secondTimer) { _ in
            elapsedSeconds += 1
        }
        .onReceive(dotTimer) { _ in
            dotCount = (dotCount + 1) % 4
        }
    }

    private var elapsedLabel: String {
        if elapsedSeconds < 10 {
            return "This usually takes 30-60 seconds\(String(repeating: ".", count: dotCount))"
        } else {
            let m = elapsedSeconds / 60
            let s = elapsedSeconds % 60
            let time = m > 0 ? "\(m)m \(s)s" : "\(s)s"
            return "Elapsed: \(time) — still working\(String(repeating: ".", count: dotCount))"
        }
    }
}
