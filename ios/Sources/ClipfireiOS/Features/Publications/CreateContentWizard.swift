import SwiftUI

// MARK: - Wizard ViewModel

@MainActor
public final class CreateContentWizardViewModel: ObservableObject {
    enum WizardStep: Hashable {
        case selectPlatform
        case enterContent
    }

    @Published var step: WizardStep = .selectPlatform
    @Published var publications: [Publication] = []
    @Published var publishingAccounts: [PublishingAccount] = []
    @Published var selectedAccountIds: Set<String> = []
    @Published var selectedPublication: Publication?

    // Content fields
    @Published var topic = ""
    @Published var sourceContent = ""
    @Published var instructions = ""

    // Generation state
    @Published var isGenerating = false
    @Published var generatedArticle: Article?
    @Published var errorMessage: String?
    @Published var isLoading = false

    let apiClient: APIClient

    public init(api: APIClient) {
        self.apiClient = api
    }

    func loadPublishingAccounts() async {
        isLoading = true
        defer { isLoading = false }
        do {
            publishingAccounts = try await apiClient.fetchPublishingAccounts()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadPublications() async {
        do {
            publications = try await apiClient.fetchPublications()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleAccount(_ id: String) {
        if selectedAccountIds.contains(id) {
            selectedAccountIds.remove(id)
        } else {
            selectedAccountIds.insert(id)
        }
    }

    func advanceToContent() {
        step = .enterContent
    }

    func generateArticle() async -> Bool {
        guard let pub = selectedPublication else {
            errorMessage = "Please select a publication"
            return false
        }
        guard !topic.trimmingCharacters(in: .whitespaces).isEmpty else {
            errorMessage = "Please enter a topic"
            return false
        }

        isGenerating = true
        errorMessage = nil
        defer { isGenerating = false }

        do {
            let article = try await apiClient.createArticle(
                CreateArticleRequest(publicationId: pub.id, title: topic.trimmingCharacters(in: .whitespaces))
            )

            let generated = try await apiClient.generateArticle(
                id: article.id,
                request: GenerateArticleRequest(
                    topic: topic.trimmingCharacters(in: .whitespaces),
                    sourceContent: sourceContent.isEmpty ? nil : sourceContent,
                    instructions: instructions.isEmpty ? nil : instructions
                )
            )

            generatedArticle = generated
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

// MARK: - Wizard View

public struct CreateContentWizard: View {
    @StateObject private var viewModel: CreateContentWizardViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showArticleDetail = false
    private let onNavigateToPublish: (() -> Void)?

    public init(api: APIClient, onNavigateToPublish: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: CreateContentWizardViewModel(api: api))
        self.onNavigateToPublish = onNavigateToPublish
    }

    public var body: some View {
        NavigationStack {
            Group {
                switch viewModel.step {
                case .selectPlatform:
                    selectPlatformStep
                case .enterContent:
                    enterContentStep
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert("Error", isPresented: .init(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )) {
                Button("OK") { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .navigationDestination(isPresented: $showArticleDetail) {
                if let article = viewModel.generatedArticle {
                    ArticleDetailView(
                        articleId: article.id,
                        api: viewModel.apiClient,
                        onDismissWizard: { dismiss() }
                    )
                }
            }
        }
    }

    // MARK: - Step 1: Select Platform

    private var selectPlatformStep: some View {
        List {
            if viewModel.isLoading {
                Section {
                    HStack {
                        Spacer()
                        ProgressView()
                            .tint(DesignTokens.accent)
                        Spacer()
                    }
                    .listRowBackground(DesignTokens.surface)
                }
            } else if viewModel.publishingAccounts.isEmpty {
                Section {
                    VStack(spacing: DesignTokens.spacing) {
                        Image(systemName: "link.badge.plus")
                            .font(.system(size: 36))
                            .foregroundStyle(DesignTokens.muted)
                        Text("No publishing accounts connected")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.muted)
                        Text("Connect a Substack, Medium, Ghost, or WordPress account to get started.")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignTokens.largeSpacing)
                    .listRowBackground(DesignTokens.surface)
                }

                Section {
                    Button {
                        dismiss()
                        onNavigateToPublish?()
                    } label: {
                        HStack {
                            Spacer()
                            Text("Go to Accounts")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .listRowBackground(DesignTokens.accent)
                    .foregroundStyle(.white)
                }
            } else {
                Section("Select platforms to publish to") {
                    ForEach(viewModel.publishingAccounts) { account in
                        Button {
                            viewModel.toggleAccount(account.id)
                        } label: {
                            HStack {
                                PlatformBrandIcon(platform: account.platform, size: 32)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(account.displayName)
                                        .font(.body)
                                        .foregroundStyle(DesignTokens.textPrimary)
                                    Text(account.platform.capitalized)
                                        .font(.caption)
                                        .foregroundStyle(DesignTokens.muted)
                                }

                                Spacer()

                                Image(systemName: viewModel.selectedAccountIds.contains(account.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(viewModel.selectedAccountIds.contains(account.id) ? DesignTokens.accent : DesignTokens.muted)
                            }
                        }
                        .listRowBackground(DesignTokens.surface)
                    }
                }

                Section {
                    Button {
                        viewModel.advanceToContent()
                    } label: {
                        HStack {
                            Spacer()
                            Text("Next")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(viewModel.selectedAccountIds.isEmpty)
                    .listRowBackground(viewModel.selectedAccountIds.isEmpty ? DesignTokens.surface : DesignTokens.accent)
                    .foregroundStyle(.white)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Select Platform")
        .task {
            await viewModel.loadPublishingAccounts()
        }
    }

    // MARK: - Step 2: Enter Content

    private var enterContentStep: some View {
        List {
            Section("Publication") {
                if viewModel.publications.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView()
                            .tint(DesignTokens.accent)
                        Spacer()
                    }
                    .listRowBackground(DesignTokens.surface)
                } else {
                    ForEach(viewModel.publications) { pub in
                        Button {
                            viewModel.selectedPublication = pub
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pub.name)
                                        .font(.body)
                                        .foregroundStyle(DesignTokens.textPrimary)
                                    if let tagline = pub.tagline, !tagline.isEmpty {
                                        Text(tagline)
                                            .font(.caption)
                                            .foregroundStyle(DesignTokens.muted)
                                    }
                                }
                                Spacer()
                                if viewModel.selectedPublication?.id == pub.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(DesignTokens.accent)
                                } else {
                                    Image(systemName: "circle")
                                        .foregroundStyle(DesignTokens.muted)
                                }
                            }
                        }
                        .listRowBackground(DesignTokens.surface)
                    }
                }
            }

            Section("Topic") {
                TextField("What should the article be about?", text: $viewModel.topic, axis: .vertical)
                    .lineLimit(2...4)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .listRowBackground(DesignTokens.surface)
            }

            Section {
                DisclosureGroup {
                    TextField("Paste source material, notes, or references...", text: $viewModel.sourceContent, axis: .vertical)
                        .lineLimit(3...8)
                        .foregroundStyle(DesignTokens.textPrimary)
                        .listRowBackground(DesignTokens.surface)
                } label: {
                    Text("Source Material")
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .listRowBackground(DesignTokens.surface)
            }

            Section {
                DisclosureGroup {
                    TextField("Style, tone, length, or other instructions...", text: $viewModel.instructions, axis: .vertical)
                        .lineLimit(2...4)
                        .foregroundStyle(DesignTokens.textPrimary)
                        .listRowBackground(DesignTokens.surface)
                } label: {
                    Text("Additional Instructions")
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .listRowBackground(DesignTokens.surface)
            }

            Section {
                Button {
                    Task {
                        let success = await viewModel.generateArticle()
                        if success {
                            showArticleDetail = true
                        }
                    }
                } label: {
                    HStack {
                        Spacer()
                        if viewModel.isGenerating {
                            ProgressView()
                                .tint(.white)
                            Text("Generating...")
                                .foregroundStyle(.white)
                        } else {
                            Image(systemName: "sparkles")
                            Text("Generate Article")
                        }
                        Spacer()
                    }
                    .fontWeight(.semibold)
                }
                .disabled(viewModel.selectedPublication == nil || viewModel.topic.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isGenerating)
                .listRowBackground(
                    viewModel.selectedPublication == nil || viewModel.topic.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isGenerating
                        ? DesignTokens.surface
                        : DesignTokens.accent
                )
                .foregroundStyle(.white)
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Content")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    viewModel.step = .selectPlatform
                } label: {
                    Image(systemName: "chevron.left")
                }
            }
        }
        .task {
            await viewModel.loadPublications()
            if viewModel.selectedPublication == nil, let first = viewModel.publications.first {
                viewModel.selectedPublication = first
            }
        }
    }

}
