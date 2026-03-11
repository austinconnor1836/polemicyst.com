import SwiftUI

// MARK: - ViewModel

@MainActor
public final class ArticleDetailViewModel: ObservableObject {
    @Published public var article: Article?
    @Published public var isLoading = false
    @Published public var isGenerating = false
    @Published public var isGeneratingGraphics = false
    @Published public var isSaving = false
    @Published public var isPublishing = false
    @Published public var isRasterizing = false
    @Published public var errorMessage: String?

    @Published public var topic = ""
    @Published public var sourceContent = ""
    @Published public var instructions = ""
    @Published public var editTitle = ""
    @Published public var editBody = ""

    // Publishing accounts + history
    @Published public var publishingAccounts: [PublishingAccount] = []
    @Published public var publishes: [ArticlePublishRecord] = []

    private let api: APIClient
    private let articleId: String

    public init(articleId: String, api: APIClient) {
        self.articleId = articleId
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let art = try await api.fetchArticle(id: articleId)
            article = art
            editTitle = art.title
            editBody = art.bodyMarkdown ?? ""
        } catch {
            errorMessage = error.localizedDescription
        }
        // Load publish history and accounts in parallel
        async let publishesTask: () = loadPublishes()
        async let accountsTask: () = loadPublishingAccounts()
        _ = await (publishesTask, accountsTask)
    }

    private func loadPublishes() async {
        do {
            publishes = try await api.fetchArticlePublishes(articleId: articleId)
        } catch {
            print("[ArticleDetail] fetchPublishes error: \(error)")
        }
    }

    private func loadPublishingAccounts() async {
        do {
            publishingAccounts = try await api.fetchPublishingAccounts()
        } catch {
            print("[ArticleDetail] fetchPublishingAccounts error: \(error)")
        }
    }

    public func generate() async {
        guard !topic.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorMessage = "Enter a topic to generate the article"
            return
        }
        isGenerating = true
        defer { isGenerating = false }
        do {
            let updated = try await api.generateArticle(
                id: articleId,
                request: GenerateArticleRequest(
                    topic: topic.trimmingCharacters(in: .whitespaces),
                    sourceContent: sourceContent.trimmingCharacters(in: .whitespaces).isEmpty ? nil : sourceContent,
                    instructions: instructions.trimmingCharacters(in: .whitespaces).isEmpty ? nil : instructions
                )
            )
            article = updated
            editTitle = updated.title
            editBody = updated.bodyMarkdown ?? ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func generateGraphics() async {
        isGeneratingGraphics = true
        defer { isGeneratingGraphics = false }
        do {
            _ = try await api.generateGraphics(articleId: articleId)
            await load() // Reload to get graphics
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await api.updateArticle(
                id: articleId,
                title: editTitle,
                bodyMarkdown: editBody
            )
            article = updated
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func rasterizeGraphics() async {
        isRasterizing = true
        defer { isRasterizing = false }
        do {
            _ = try await api.rasterizeGraphics(articleId: articleId)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func publishToAccount(accountId: String, live: Bool) async {
        isPublishing = true
        defer { isPublishing = false }
        do {
            let result = try await api.publishArticleToAccount(
                articleId: articleId,
                publishingAccountId: accountId,
                publishLive: live
            )
            publishes.insert(result, at: 0)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func publish(live: Bool) async {
        isPublishing = true
        defer { isPublishing = false }
        do {
            let updated = try await api.publishArticle(articleId: articleId, publishLive: live)
            article = updated
            editTitle = updated.title
            editBody = updated.bodyMarkdown ?? ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public var hasContent: Bool {
        article?.bodyMarkdown != nil && !(article?.bodyMarkdown ?? "").isEmpty
    }

    public var hasUnrasteredGraphics: Bool {
        article?.graphics?.contains { $0.htmlContent != nil && $0.s3Url == nil } ?? false
    }

    /// Accounts not already published to
    public var availableAccounts: [PublishingAccount] {
        publishingAccounts.filter { account in
            account.connected && !publishes.contains { $0.publishingAccountId == account.id }
        }
    }
}

// MARK: - View

public struct ArticleDetailView: View {
    @StateObject private var viewModel: ArticleDetailViewModel
    @State private var showErrorAlert = false
    private let onDismissWizard: (() -> Void)?

    public init(articleId: String, api: APIClient, onDismissWizard: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: ArticleDetailViewModel(articleId: articleId, api: api))
        self.onDismissWizard = onDismissWizard
    }

    public var body: some View {
        Group {
            if viewModel.isLoading && viewModel.article == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.article != nil {
                ScrollView {
                    VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                        generationSection
                        if viewModel.hasContent {
                            contentSection
                            publishSection
                            graphicsSection
                        }
                    }
                    .padding()
                }
            } else {
                VStack(spacing: DesignTokens.spacing) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(DesignTokens.muted)
                    Text("Article not found")
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle(viewModel.article?.title ?? "Article")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onDismissWizard {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onDismissWizard() }
                }
            }
        }
        .task {
            await viewModel.load()
        }
        .onChange(of: viewModel.errorMessage) { showErrorAlert = $1 != nil }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    // MARK: Generation Section

    private var generationSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            sectionHeader("AI Generation", icon: "sparkles")

            VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                Text("Topic / Prompt")
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.muted)
                TextField("e.g. Analysis of the latest Supreme Court ruling...", text: $viewModel.topic, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
            }

            VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                Text("Source Material (optional)")
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.muted)
                TextField("Paste transcript or source text...", text: $viewModel.sourceContent, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...8)
            }

            VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                Text("Instructions (optional)")
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.muted)
                TextField("e.g. Focus on constitutional implications...", text: $viewModel.instructions)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: DesignTokens.spacing) {
                Button {
                    Task { await viewModel.generate() }
                } label: {
                    HStack(spacing: 6) {
                        if viewModel.isGenerating {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "sparkles")
                        }
                        Text(viewModel.hasContent ? "Regenerate" : "Generate")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.accent)
                .disabled(viewModel.topic.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isGenerating)

                if viewModel.hasContent {
                    Button {
                        Task { await viewModel.generateGraphics() }
                    } label: {
                        HStack(spacing: 6) {
                            if viewModel.isGeneratingGraphics {
                                ProgressView()
                                    .tint(DesignTokens.textPrimary)
                            } else {
                                Image(systemName: "photo.artframe")
                            }
                            Text("Graphics")
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.isGeneratingGraphics)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }

    // MARK: Content Section

    private var contentSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                sectionHeader("Article Content", icon: "doc.text")
                Spacer()
                Button {
                    Task { await viewModel.save() }
                } label: {
                    HStack(spacing: 4) {
                        if viewModel.isSaving {
                            ProgressView()
                                .tint(DesignTokens.textPrimary)
                        }
                        Text("Save")
                            .font(.subheadline.weight(.medium))
                    }
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.isSaving)
            }

            VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                Text("Title")
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.muted)
                TextField("Title", text: $viewModel.editTitle)
                    .textFieldStyle(.roundedBorder)
                    .font(.headline)
            }

            VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                Text("Body (Markdown)")
                    .font(.caption.weight(.medium))
                    .foregroundColor(DesignTokens.muted)
                TextEditor(text: $viewModel.editBody)
                    .font(.system(.caption, design: .monospaced))
                    .frame(minHeight: 300)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
            }

            if let model = viewModel.article?.generationModel {
                Text("Generated with \(model)")
                    .font(.caption)
                    .foregroundColor(DesignTokens.muted)
            }
        }
    }

    // MARK: Publish Section

    private var publishSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            sectionHeader("Publishing", icon: "paperplane")

            // Publish error banner
            if let error = viewModel.article?.publishError {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Publish Error")
                            .font(.caption.weight(.semibold))
                        Text(error)
                            .font(.caption2)
                    }
                }
                .foregroundColor(.red)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
            }

            // Publish history
            if !viewModel.publishes.isEmpty {
                ForEach(viewModel.publishes) { pub in
                    HStack(spacing: 10) {
                        PlatformBrandIcon(platform: pub.platform, size: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(pub.displayName)
                                    .font(.subheadline.weight(.medium))
                                statusBadge(pub.status)
                            }
                            if let error = pub.publishError {
                                Text(error)
                                    .font(.caption2)
                                    .foregroundColor(.red)
                            }
                            if let date = pub.publishedAt {
                                Text("Published \(date, style: .date)")
                                    .font(.caption2)
                                    .foregroundColor(DesignTokens.muted)
                            }
                        }
                        Spacer()
                    }
                    .padding(10)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                }
            } else {
                Text("Not published yet.")
                    .font(.caption)
                    .foregroundColor(DesignTokens.muted)
            }

            // Publish to account buttons
            HStack(spacing: DesignTokens.spacing) {
                if viewModel.hasUnrasteredGraphics {
                    Button {
                        Task { await viewModel.rasterizeGraphics() }
                    } label: {
                        HStack(spacing: 6) {
                            if viewModel.isRasterizing {
                                ProgressView()
                                    .tint(DesignTokens.textPrimary)
                            } else {
                                Image(systemName: "photo")
                            }
                            Text("Rasterize")
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.isRasterizing)
                }

                if !viewModel.availableAccounts.isEmpty {
                    Menu {
                        ForEach(viewModel.availableAccounts) { account in
                            Menu(account.displayName) {
                                Button {
                                    Task { await viewModel.publishToAccount(accountId: account.id, live: false) }
                                } label: {
                                    Label("Save as Draft", systemImage: "square.and.arrow.up")
                                }
                                Button {
                                    Task { await viewModel.publishToAccount(accountId: account.id, live: true) }
                                } label: {
                                    Label("Publish Live", systemImage: "paperplane.fill")
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if viewModel.isPublishing {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Image(systemName: "plus")
                            }
                            Text("Publish")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(DesignTokens.accent)
                    .disabled(viewModel.isPublishing)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }

    private func statusBadge(_ status: String) -> some View {
        Text(status.capitalized)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(statusColor(status).opacity(0.15))
            .foregroundColor(statusColor(status))
            .clipShape(Capsule())
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "draft": return .gray
        case "published": return .green
        case "failed": return .red
        default: return .gray
        }
    }

    // MARK: Graphics Section

    private var graphicsSection: some View {
        let graphics = viewModel.article?.graphics ?? []
        return Group {
            if !graphics.isEmpty {
                VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                    sectionHeader("Graphics", icon: "photo.artframe")

                    ForEach(graphics) { graphic in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(graphic.type.capitalized)
                                    .font(.caption2.weight(.medium))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(DesignTokens.accent.opacity(0.15))
                                    .foregroundColor(DesignTokens.accent)
                                    .clipShape(Capsule())
                                if let label = graphic.label {
                                    Text(label)
                                        .font(.caption)
                                        .foregroundColor(DesignTokens.muted)
                                }
                            }
                            if graphic.htmlContent != nil {
                                Text("HTML graphic generated")
                                    .font(.caption)
                                    .foregroundColor(DesignTokens.textSecondary)
                                    .padding()
                                    .frame(maxWidth: .infinity)
                                    .background(DesignTokens.surface)
                                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Helpers

    private func sectionHeader(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon)
            .font(.subheadline.weight(.semibold))
            .foregroundColor(DesignTokens.textPrimary)
    }
}
