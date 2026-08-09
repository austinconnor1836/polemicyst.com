import SwiftUI

/// Sheet-style composer for the Polemicyst Graphic.
///
/// The user pastes plain text into ONE box and taps Generate. The server
/// SYNCHRONOUSLY typesets it into the fixed Polemicyst brand card (cream card,
/// Spectral serif, hairline-ruled body, `@polemicyst` footer) and returns one
/// or more 1080×1350 PNG pages. A short post is a single card; a long post is an
/// Instagram carousel. NO AI/LLM anywhere in the path.
///
/// Two visual states share this view: the editor (paste + Generate) and the
/// result (swipeable carousel preview + Save / Share / Regenerate). Structure +
/// DesignTokens mirror `SplitFrameEditorView`.
public struct PolemicystGraphicEditorView: View {
    @StateObject private var viewModel: PolemicystGraphicViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var carouselIndex = 0
    @State private var showErrorAlert = false
    @State private var saveMessage: String?
    @State private var showSaveAlert = false

    public init(api: APIClient) {
        _viewModel = StateObject(wrappedValue: PolemicystGraphicViewModel(api: api))
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    if viewModel.hasResult {
                        resultSection
                    } else {
                        editorSection
                    }
                }
                .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle(viewModel.hasResult ? "Your Graphic" : "New Graphic")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .onChange(of: viewModel.stage) { _, stage in
                if case .failed = stage { showErrorAlert = true }
                if case .result = stage { carouselIndex = 0 }
            }
            .alert("Something went wrong", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.stage = .idle }
            } message: {
                if case .failed(let message) = viewModel.stage { Text(message) }
            }
            .alert("Save to Photos", isPresented: $showSaveAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                if let saveMessage { Text(saveMessage) }
            }
        }
    }

    // MARK: - Editor

    private var editorSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
            pasteCard
            optionsCard
            generateButton
        }
    }

    private var pasteCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Your text")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Paste your argument. Blank lines start a new paragraph; a line with only \u{201C}---\u{201D} forces a new carousel page.")
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)

            ZStack(alignment: .topLeading) {
                if viewModel.text.isEmpty {
                    Text("Paste your text\u{2026}")
                        .foregroundStyle(DesignTokens.muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 10)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $viewModel.text)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 220)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .font(.body)
            }
            .padding(8)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
        }
        .padding()
        .background(DesignTokens.surface.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }

    private var optionsCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Toggle(isOn: $viewModel.showPageIndicator) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Page indicator")
                        .font(.body)
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text("Show \u{201C}1 / N\u{201D} in the footer on multi-page carousels")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
            .tint(DesignTokens.accent)
        }
        .padding()
        .background(DesignTokens.surface.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }

    private var generateButton: some View {
        Button {
            viewModel.generate()
        } label: {
            HStack {
                if viewModel.stage.isGenerating {
                    ProgressView()
                        .tint(.white)
                    Text("Generating\u{2026}")
                } else {
                    Image(systemName: "text.quote")
                    Text("Generate")
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(viewModel.canGenerate ? DesignTokens.accent : DesignTokens.surface)
            .foregroundStyle(viewModel.canGenerate ? .white : DesignTokens.muted)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
        }
        .disabled(!viewModel.canGenerate)
    }

    // MARK: - Result

    private var resultSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
            carousel
            if viewModel.resultUrls.count > 1 {
                Text("\(viewModel.resultUrls.count) pages \u{00B7} swipe to preview")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            actionButtons
        }
    }

    private var carousel: some View {
        TabView(selection: $carouselIndex) {
            ForEach(Array(viewModel.resultUrls.enumerated()), id: \.offset) { index, urlString in
                AsyncImage(url: URL(string: urlString)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                    case .failure:
                        placeholderTile(systemImage: "exclamationmark.triangle", label: "Couldn't load page \(index + 1)")
                    default:
                        placeholderTile(systemImage: "photo", label: nil, showsSpinner: true)
                    }
                }
                .padding(.horizontal, 4)
                .tag(index)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: viewModel.resultUrls.count > 1 ? .automatic : .never))
        .indexViewStyle(.page(backgroundDisplayMode: .interactive))
        // 1080 : 1350 == 4 : 5 portrait aspect ratio of the brand card.
        .aspectRatio(1080.0 / 1350.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
    }

    private func placeholderTile(systemImage: String, label: String?, showsSpinner: Bool = false) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                .fill(DesignTokens.surface)
            VStack(spacing: DesignTokens.smallSpacing) {
                if showsSpinner {
                    ProgressView().tint(DesignTokens.accent)
                } else {
                    Image(systemName: systemImage)
                        .font(.largeTitle)
                        .foregroundStyle(DesignTokens.muted)
                }
                if let label {
                    Text(label)
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: DesignTokens.spacing) {
            HStack(spacing: DesignTokens.spacing) {
                Button {
                    Task { await save() }
                } label: {
                    actionLabel(
                        systemImage: viewModel.isSaving ? "hourglass" : "square.and.arrow.down",
                        title: viewModel.isSaving ? "Saving\u{2026}" : "Save",
                        filled: true
                    )
                }
                .disabled(viewModel.pageImages.isEmpty || viewModel.isSaving)

                if viewModel.shareURLs.isEmpty {
                    actionLabel(systemImage: "square.and.arrow.up", title: "Share", filled: false)
                        .opacity(0.5)
                } else {
                    ShareLink(items: viewModel.shareURLs) {
                        actionLabel(systemImage: "square.and.arrow.up", title: "Share", filled: false)
                    }
                }
            }

            Button {
                viewModel.regenerate()
            } label: {
                actionLabel(
                    systemImage: viewModel.stage.isGenerating ? "arrow.triangle.2.circlepath" : "arrow.clockwise",
                    title: viewModel.stage.isGenerating ? "Regenerating\u{2026}" : "Regenerate",
                    filled: false
                )
            }
            .disabled(viewModel.stage.isGenerating)

            Button {
                viewModel.startOver()
            } label: {
                Text("Edit text")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
        }
    }

    private func actionLabel(systemImage: String, title: String, filled: Bool) -> some View {
        HStack {
            Image(systemName: systemImage)
            Text(title)
        }
        .font(.headline)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(filled ? DesignTokens.accent : DesignTokens.surface)
        .foregroundStyle(filled ? .white : DesignTokens.textPrimary)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }

    private func save() async {
        do {
            try await viewModel.saveAllToPhotos()
            let count = viewModel.pageImages.count
            saveMessage = count > 1 ? "Saved \(count) pages to Photos." : "Saved to Photos."
        } catch {
            saveMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        showSaveAlert = true
    }
}
