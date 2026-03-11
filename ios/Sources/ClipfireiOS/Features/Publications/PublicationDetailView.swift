import SwiftUI

// MARK: - ViewModel

@MainActor
public final class PublicationDetailViewModel: ObservableObject {
    @Published public var publication: Publication?
    @Published public var articles: [Article] = []
    @Published public var isLoading = false
    @Published public var isSaving = false
    @Published public var errorMessage: String?

    @Published public var editName: String = ""
    @Published public var editTagline: String = ""
    @Published public var editConfig: String = ""

    // Substack connection
    @Published public var substackCookie: String = ""
    @Published public var substackSubdomain: String = ""
    @Published public var isConnecting = false
    @Published public var isDisconnecting = false
    @Published public var isVerifying = false
    @Published public var substackVerified: Bool?

    public let api: APIClient
    public let publicationId: String

    public init(publicationId: String, api: APIClient) {
        self.publicationId = publicationId
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let pub = try await api.fetchPublication(id: publicationId)
            publication = pub
            editName = pub.name
            editTagline = pub.tagline ?? ""
            editConfig = pub.configMarkdown
            // Pre-fill subdomain from URL
            if let url = pub.substackUrl, let host = URL(string: url)?.host {
                substackSubdomain = host.components(separatedBy: ".").first ?? ""
            }
        } catch {
            print("[PublicationDetail] fetchPublication error: \(error)")
            errorMessage = error.localizedDescription
            return
        }
        do {
            articles = try await api.fetchArticles(publicationId: publicationId)
        } catch {
            print("[PublicationDetail] fetchArticles error: \(error)")
            // Non-fatal — still show the publication
        }
        // Auto-verify if connected
        if publication?.substackConnected == true {
            await verifySubstack()
        }
    }

    public func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await api.updatePublication(
                id: publicationId,
                body: UpdatePublicationRequest(
                    name: editName.trimmingCharacters(in: .whitespaces),
                    tagline: editTagline.trimmingCharacters(in: .whitespaces).isEmpty ? nil : editTagline.trimmingCharacters(in: .whitespaces),
                    configMarkdown: editConfig
                )
            )
            publication = updated
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public var hasChanges: Bool {
        guard let pub = publication else { return false }
        return editName != pub.name ||
            editTagline != (pub.tagline ?? "") ||
            editConfig != pub.configMarkdown
    }

    public func deleteArticle(id: String) async {
        do {
            try await api.deleteArticle(id: id)
            articles.removeAll { $0.id == id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: Substack

    public func connectSubstack() async {
        let cookie = substackCookie.trimmingCharacters(in: .whitespaces)
        let subdomain = substackSubdomain.trimmingCharacters(in: .whitespaces)
        guard !cookie.isEmpty, !subdomain.isEmpty else {
            errorMessage = "Both cookie and subdomain are required"
            return
        }
        isConnecting = true
        defer { isConnecting = false }
        do {
            let result = try await api.connectSubstack(publicationId: publicationId, cookie: cookie, subdomain: subdomain)
            substackCookie = ""
            substackVerified = true
            if let name = result.publicationName {
                errorMessage = nil
                print("[PublicationDetail] Connected to \(name)")
            }
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func disconnectSubstack() async {
        isDisconnecting = true
        defer { isDisconnecting = false }
        do {
            try await api.disconnectSubstack(publicationId: publicationId)
            substackVerified = nil
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func verifySubstack() async {
        isVerifying = true
        defer { isVerifying = false }
        do {
            let result = try await api.verifySubstack(publicationId: publicationId)
            substackVerified = result.connected
            if result.expired {
                errorMessage = "Substack session expired — please reconnect"
                await load()
            }
        } catch {
            substackVerified = false
        }
    }
}

// MARK: - View

public struct PublicationDetailView: View {
    @StateObject private var viewModel: PublicationDetailViewModel
    @State private var selectedTab = 0
    @State private var showErrorAlert = false

    public init(publicationId: String, api: APIClient) {
        _viewModel = StateObject(wrappedValue: PublicationDetailViewModel(publicationId: publicationId, api: api))
    }

    public var body: some View {
        Group {
            if viewModel.isLoading && viewModel.publication == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.publication != nil {
                VStack(spacing: 0) {
                    // Tab picker
                    Picker("Section", selection: $selectedTab) {
                        Text("Config").tag(0)
                        Text("Articles (\(viewModel.articles.count))").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .padding()

                    if selectedTab == 0 {
                        configEditor
                    } else {
                        articlesTab
                    }
                }
            } else {
                VStack(spacing: DesignTokens.spacing) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(DesignTokens.muted)
                    Text("Publication not found")
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle(viewModel.publication?.name ?? "Publication")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load()
        }
        .onChange(of: viewModel.errorMessage) { showErrorAlert = $1 != nil }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    // MARK: Config Editor Tab

    private var configEditor: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                // Name & tagline
                VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                    Text("Name")
                        .font(.caption.weight(.medium))
                        .foregroundColor(DesignTokens.muted)
                    TextField("Publication Name", text: $viewModel.editName)
                        .textFieldStyle(.roundedBorder)

                    Text("Tagline")
                        .font(.caption.weight(.medium))
                        .foregroundColor(DesignTokens.muted)
                    TextField("Tagline", text: $viewModel.editTagline)
                        .textFieldStyle(.roundedBorder)
                }

                // Config markdown
                VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                    Text("Publication Config")
                        .font(.caption.weight(.medium))
                        .foregroundColor(DesignTokens.muted)
                    TextEditor(text: $viewModel.editConfig)
                        .font(.system(.caption, design: .monospaced))
                        .frame(minHeight: 400)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                }

                // Save button
                Button {
                    Task { await viewModel.save() }
                } label: {
                    HStack {
                        if viewModel.isSaving {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(viewModel.isSaving ? "Saving..." : "Save Config")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.accent)
                .disabled(!viewModel.hasChanges || viewModel.isSaving)
            }
            .padding()
        }
    }

    // MARK: Articles Tab

    private var articlesTab: some View {
        Group {
            if viewModel.articles.isEmpty {
                VStack(spacing: DesignTokens.spacing) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 40))
                        .foregroundColor(DesignTokens.muted)
                    Text("No articles yet")
                        .foregroundColor(DesignTokens.textSecondary)
                    NavigationLink(value: "new-article") {
                        Label("Create Article", systemImage: "plus")
                            .font(.subheadline.weight(.medium))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(DesignTokens.accent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(viewModel.articles) { article in
                        NavigationLink(value: "article-\(article.id)") {
                            articleRow(article)
                        }
                        .listRowBackground(DesignTokens.surface)
                    }
                    .onDelete { indexSet in
                        Task {
                            for index in indexSet {
                                await viewModel.deleteArticle(id: viewModel.articles[index].id)
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .toolbar {
            if selectedTab == 1 {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink(value: "new-article") {
                        Image(systemName: "plus")
                    }
                }
            }
        }
        .navigationDestination(for: String.self) { value in
            if value == "new-article" {
                NewArticleView(publicationId: viewModel.publicationId, api: viewModel.api) {
                    Task { await viewModel.load() }
                }
            } else if value.hasPrefix("article-") {
                let articleId = String(value.dropFirst("article-".count))
                ArticleDetailView(articleId: articleId, api: viewModel.api)
            }
        }
    }

    // MARK: Substack Tab

    private var substackTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                if viewModel.publication?.substackConnected == true {
                    // Connected state
                    VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Connected")
                                .font(.headline)
                                .foregroundColor(DesignTokens.textPrimary)
                        }

                        if let url = viewModel.publication?.substackUrl {
                            Text(url)
                                .font(.caption)
                                .foregroundColor(DesignTokens.accent)
                        }

                        if let verified = viewModel.substackVerified {
                            HStack(spacing: 4) {
                                Image(systemName: verified ? "checkmark.shield" : "exclamationmark.triangle")
                                    .foregroundColor(verified ? .green : .orange)
                                Text(verified ? "Session verified" : "Session may be expired")
                                    .font(.caption)
                                    .foregroundColor(DesignTokens.muted)
                            }
                        }

                        HStack(spacing: DesignTokens.spacing) {
                            Button {
                                Task { await viewModel.verifySubstack() }
                            } label: {
                                HStack(spacing: 4) {
                                    if viewModel.isVerifying {
                                        ProgressView()
                                            .tint(DesignTokens.textPrimary)
                                    }
                                    Text("Verify")
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(viewModel.isVerifying)

                            Button(role: .destructive) {
                                Task { await viewModel.disconnectSubstack() }
                            } label: {
                                HStack(spacing: 4) {
                                    if viewModel.isDisconnecting {
                                        ProgressView()
                                            .tint(.red)
                                    }
                                    Text("Disconnect")
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(viewModel.isDisconnecting)
                        }
                    }
                } else {
                    // Not connected state
                    VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                        Text("Connect your Substack to publish articles directly.")
                            .font(.subheadline)
                            .foregroundColor(DesignTokens.textSecondary)

                        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                            Text("Subdomain")
                                .font(.caption.weight(.medium))
                                .foregroundColor(DesignTokens.muted)
                            TextField("e.g. yourpublication", text: $viewModel.substackSubdomain)
                                .textFieldStyle(.roundedBorder)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                            Text("The part before .substack.com")
                                .font(.caption2)
                                .foregroundColor(DesignTokens.muted)
                        }

                        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
                            Text("Session Cookie")
                                .font(.caption.weight(.medium))
                                .foregroundColor(DesignTokens.muted)
                            SecureField("Paste connect.sid value", text: $viewModel.substackCookie)
                                .textFieldStyle(.roundedBorder)
                            Text("Substack > DevTools > Cookies > connect.sid")
                                .font(.caption2)
                                .foregroundColor(DesignTokens.muted)
                        }

                        Button {
                            Task { await viewModel.connectSubstack() }
                        } label: {
                            HStack {
                                if viewModel.isConnecting {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text(viewModel.isConnecting ? "Connecting..." : "Connect Substack")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(DesignTokens.accent)
                        .disabled(
                            viewModel.substackCookie.trimmingCharacters(in: .whitespaces).isEmpty ||
                            viewModel.substackSubdomain.trimmingCharacters(in: .whitespaces).isEmpty ||
                            viewModel.isConnecting
                        )
                    }
                }
            }
            .padding()
        }
    }

    private func articleRow(_ article: Article) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(article.title)
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(2)
                Spacer()
                statusBadge(article.status)
            }
            Text("Updated \(article.updatedAt, style: .relative) ago")
                .font(.caption)
                .foregroundColor(DesignTokens.muted)
        }
        .padding(.vertical, 4)
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
        case "generating": return .yellow
        case "review": return .blue
        case "published": return .green
        default: return .gray
        }
    }
}
