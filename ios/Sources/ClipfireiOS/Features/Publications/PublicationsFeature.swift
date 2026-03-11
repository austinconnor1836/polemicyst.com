import SwiftUI

// MARK: - ViewModel

@MainActor
public final class PublicationsViewModel: ObservableObject {
    @Published public var publications: [Publication] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?

    public let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        if ScreenshotMode.isActive {
            publications = MockData.publications
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            publications = try await api.fetchPublications()
        } catch let error as APIError where error.isUpgradeRequired {
            upgradeError = error
        } catch let error as DecodingError {
            print("[Publications] Decode error: \(error)")
            errorMessage = error.localizedDescription
        } catch {
            print("[Publications] Load error: \(error)")
            errorMessage = error.localizedDescription
        }
    }

    public func create(name: String, tagline: String?) async -> Bool {
        do {
            _ = try await api.createPublication(
                CreatePublicationRequest(name: name, tagline: tagline)
            )
            await load()
            return true
        } catch {
            print("[Publications] Create error: \(error)")
            errorMessage = error.localizedDescription
            return false
        }
    }

    public func delete(id: String) async {
        do {
            try await api.deletePublication(id: id)
            publications.removeAll { $0.id == id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Publications List View

public struct PublicationsListView: View {
    @StateObject private var viewModel: PublicationsViewModel
    @State private var showingCreate = false
    @State private var newName = ""
    @State private var newTagline = ""
    @State private var isCreating = false
    @State private var deletingId: String?
    @State private var publicationToDelete: Publication?
    @State private var showDeleteAlert = false
    @State private var showErrorAlert = false

    public init(viewModel: PublicationsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.publications.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.publications.isEmpty {
                    emptyState
                } else {
                    publicationsList
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Publications")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingCreate) {
                createSheet
            }
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
            .sheet(item: $viewModel.upgradeError) { error in
                UpgradePromptView(
                    message: error.localizedDescription,
                    quotaLimit: error.quotaLimit,
                    quotaUsage: error.quotaUsage,
                    onDismiss: { viewModel.upgradeError = nil }
                )
            }
            .navigationDestination(for: String.self) { pubId in
                PublicationDetailView(publicationId: pubId, api: viewModel.api)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: DesignTokens.spacing) {
            Image(systemName: "newspaper")
                .font(.system(size: 48))
                .foregroundColor(DesignTokens.muted)
            Text("No Publications")
                .font(.title3.weight(.semibold))
                .foregroundColor(DesignTokens.textPrimary)
            Text("Create a publication to start generating AI-powered articles")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                showingCreate = true
            } label: {
                Label("Create Publication", systemImage: "plus")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.accent)
            .padding(.top, DesignTokens.smallSpacing)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var publicationsList: some View {
        List {
            ForEach(viewModel.publications) { pub in
                ZStack {
                    NavigationLink(value: pub.id) {
                        publicationRow(pub)
                    }

                    if deletingId == pub.id {
                        RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                HStack(spacing: 8) {
                                    ProgressView()
                                    Text("Deleting…")
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(DesignTokens.textPrimary)
                                }
                            }
                    }
                }
                .listRowBackground(DesignTokens.surface)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        publicationToDelete = pub
                        showDeleteAlert = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .disabled(deletingId != nil)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .alert("Delete Publication", isPresented: $showDeleteAlert, presenting: publicationToDelete) { pub in
            Button("Delete", role: .destructive) {
                Task {
                    deletingId = pub.id
                    await viewModel.delete(id: pub.id)
                    deletingId = nil
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: { pub in
            Text("Delete \"\(pub.name)\"? This will also delete all its articles. This cannot be undone.")
        }
    }

    private func publicationRow(_ pub: Publication) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(pub.name)
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)
                if pub.isDefault {
                    Text("Default")
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(DesignTokens.accent.opacity(0.2))
                        .foregroundColor(DesignTokens.accent)
                        .clipShape(Capsule())
                }
            }
            if let tagline = pub.tagline, !tagline.isEmpty {
                Text(tagline)
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }
            Text("\(pub._count?.articles ?? 0) article\(pub._count?.articles == 1 ? "" : "s")")
                .font(.caption)
                .foregroundColor(DesignTokens.muted)
        }
        .padding(.vertical, 4)
    }

    private var createSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Publication Name", text: $newName)
                    TextField("Tagline (optional)", text: $newTagline)
                }
                Section {
                    Text("A starter config document will be generated. You can customize it after creation.")
                        .font(.caption)
                        .foregroundColor(DesignTokens.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("New Publication")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showingCreate = false
                        newName = ""
                        newTagline = ""
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            isCreating = true
                            _ = await viewModel.create(
                                name: newName.trimmingCharacters(in: .whitespaces),
                                tagline: newTagline.trimmingCharacters(in: .whitespaces).isEmpty ? nil : newTagline.trimmingCharacters(in: .whitespaces)
                            )
                            isCreating = false
                            showingCreate = false
                            newName = ""
                            newTagline = ""
                        }
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
