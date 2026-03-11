import SwiftUI

// MARK: - ViewModel

@MainActor
public final class AnalysisChatViewModel: ObservableObject {
    @Published public private(set) var messages: [AnalysisChatMessage] = []
    @Published public private(set) var analysis: TruthAnalysisResult?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isSending = false
    @Published public var errorMessage: String?

    let api: APIClient
    let feedVideoId: String
    let clipId: String?

    public init(api: APIClient, feedVideoId: String, clipId: String? = nil) {
        self.api = api
        self.feedVideoId = feedVideoId
        self.clipId = clipId
    }

    public func loadChat() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.fetchAnalysisChat(feedVideoId: feedVideoId, clipId: clipId)
            if let chatMessages = response.chat?.messages {
                messages = chatMessages
            }
            analysis = response.analysis
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Unable to load chat: \(error.localizedDescription)"
        }
    }

    public func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }

        isSending = true
        errorMessage = nil

        // Optimistic user message
        let userMsg = AnalysisChatMessage(
            id: UUID().uuidString,
            role: "user",
            content: trimmed,
            createdAt: Date()
        )
        messages.append(userMsg)

        do {
            let response = try await api.sendAnalysisChatMessage(
                feedVideoId: feedVideoId,
                message: trimmed,
                clipId: clipId
            )
            let assistantMsg = AnalysisChatMessage(
                id: UUID().uuidString,
                role: "assistant",
                content: response.message.content,
                createdAt: Date()
            )
            messages.append(assistantMsg)
        } catch let error as APIError {
            // Remove optimistic message on error
            messages.removeLast()
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled {
                messages.removeLast()
                return
            }
            messages.removeLast()
            errorMessage = "Failed to send message: \(error.localizedDescription)"
        }

        isSending = false
    }
}

// MARK: - View

public struct AnalysisChatView: View {
    @StateObject private var viewModel: AnalysisChatViewModel
    @State private var inputText = ""
    @FocusState private var isInputFocused: Bool

    public init(api: APIClient, feedVideoId: String, clipId: String? = nil) {
        _viewModel = StateObject(wrappedValue: AnalysisChatViewModel(
            api: api,
            feedVideoId: feedVideoId,
            clipId: clipId
        ))
    }

    public var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoading {
                Spacer()
                ProgressView()
                    .tint(DesignTokens.muted)
                Spacer()
            } else if viewModel.analysis == nil {
                noAnalysisView
            } else {
                chatContent
            }
        }
        .background(DesignTokens.background)
        .navigationTitle("Analysis Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.loadChat() }
    }

    // MARK: - No analysis state

    private var noAnalysisView: some View {
        VStack(spacing: DesignTokens.spacing) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.muted.opacity(0.5))
            Text("No analysis found")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Run \"Verify with AI\" on this video first, then come back to chat about the results.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
        }
    }

    // MARK: - Chat content

    private var chatContent: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: DesignTokens.spacing) {
                        // Analysis summary banner
                        if let analysis = viewModel.analysis {
                            analysisBanner(analysis)
                        }

                        // Suggestion chips when empty
                        if viewModel.messages.isEmpty {
                            suggestionsView
                        }

                        // Messages
                        ForEach(Array(viewModel.messages.enumerated()), id: \.element.id) { _, msg in
                            messageBubble(msg)
                        }

                        // Typing indicator
                        if viewModel.isSending {
                            typingIndicator
                        }

                        // Scroll anchor
                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding(DesignTokens.spacing)
                }
                .onChange(of: viewModel.messages.count) {
                    withAnimation {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.isSending) {
                    if viewModel.isSending {
                        withAnimation {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                    }
                }
            }

            // Error message
            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, DesignTokens.spacing)
                    .padding(.bottom, 4)
            }

            // Input bar
            inputBar
        }
    }

    // MARK: - Analysis banner

    private func analysisBanner(_ analysis: TruthAnalysisResult) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Analysis Summary")
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundStyle(DesignTokens.muted)

            Text(analysis.summary)
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            HStack(spacing: DesignTokens.smallSpacing) {
                Text("\(analysis.assertions.count) assertions")
                Text("\u{00B7}")
                Text("\(analysis.fallacies.count) fallacies")
                Text("\u{00B7}")
                Text("\(analysis.biases.count) biases")
            }
            .font(.caption2)
            .foregroundStyle(DesignTokens.muted)
        }
        .padding(DesignTokens.spacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Suggestions

    private var suggestionsView: some View {
        VStack(spacing: DesignTokens.smallSpacing) {
            Text("Ask about the analysis")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            FlowLayout(spacing: DesignTokens.smallSpacing) {
                ForEach([
                    "What are the strongest claims?",
                    "Which fallacies are most concerning?",
                    "How biased is this content?",
                    "What should I fact-check first?"
                ], id: \.self) { suggestion in
                    Button {
                        inputText = suggestion
                        isInputFocused = true
                    } label: {
                        Text(suggestion)
                            .font(.caption)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(DesignTokens.surface)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .cornerRadius(16)
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(DesignTokens.muted.opacity(0.3), lineWidth: 1)
                            )
                    }
                }
            }
        }
    }

    // MARK: - Message bubble

    private func messageBubble(_ msg: AnalysisChatMessage) -> some View {
        HStack {
            if msg.role == "user" { Spacer(minLength: 40) }

            Text(msg.content)
                .font(.subheadline)
                .foregroundStyle(msg.role == "user" ? .white : DesignTokens.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    msg.role == "user"
                        ? DesignTokens.accent
                        : DesignTokens.surface
                )
                .cornerRadius(18)

            if msg.role == "assistant" { Spacer(minLength: 40) }
        }
    }

    // MARK: - Typing indicator

    private var typingIndicator: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(DesignTokens.muted.opacity(0.5))
                        .frame(width: 6, height: 6)
                        .scaleEffect(viewModel.isSending ? 1.0 : 0.5)
                        .animation(
                            .easeInOut(duration: 0.5)
                                .repeatForever()
                                .delay(Double(i) * 0.15),
                            value: viewModel.isSending
                        )
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(DesignTokens.surface)
            .cornerRadius(18)

            Spacer(minLength: 40)
        }
    }

    // MARK: - Input bar

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: DesignTokens.smallSpacing) {
            TextField("Ask about the analysis...", text: $inputText, axis: .vertical)
                .lineLimit(1...5)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
                .cornerRadius(20)
                .foregroundStyle(DesignTokens.textPrimary)
                .focused($isInputFocused)
                .onSubmit {
                    Task { await sendMessage() }
                }

            Button {
                Task { await sendMessage() }
            } label: {
                Image(systemName: viewModel.isSending ? "hourglass" : "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(
                        inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isSending
                            ? DesignTokens.muted
                            : DesignTokens.accent
                    )
            }
            .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isSending)
        }
        .padding(.horizontal, DesignTokens.spacing)
        .padding(.vertical, DesignTokens.smallSpacing)
        .background(DesignTokens.background)
    }

    private func sendMessage() async {
        let text = inputText
        inputText = ""
        await viewModel.send(text)
    }
}

// MARK: - FlowLayout (simple wrapping layout)

private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: ProposedViewSize(result.sizes[index])
            )
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews) -> ArrangementResult {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var sizes: [CGSize] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentX + size.width > maxWidth, currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            positions.append(CGPoint(x: currentX, y: currentY))
            sizes.append(size)
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
        }

        return ArrangementResult(
            positions: positions,
            sizes: sizes,
            size: CGSize(width: maxWidth, height: currentY + lineHeight)
        )
    }

    private struct ArrangementResult {
        var positions: [CGPoint]
        var sizes: [CGSize]
        var size: CGSize
    }
}
