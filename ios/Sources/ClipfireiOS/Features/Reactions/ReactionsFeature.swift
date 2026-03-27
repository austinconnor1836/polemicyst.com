import SwiftUI

@MainActor
public final class CompositionsViewModel: ObservableObject {
    @Published public private(set) var compositions: [Composition] = []
    @Published public var isLoading = false
    @Published public var errorMessage: String?
    @Published public var deletingId: String?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            compositions = try await api.fetchCompositions()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load compositions: \(error.localizedDescription)"
        }
    }

    public func create() async -> Composition? {
        do {
            let comp = try await api.createComposition(body: CreateCompositionRequest())
            withAnimation { compositions.insert(comp, at: 0) }
            return comp
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return nil }
            errorMessage = "Failed to create composition: \(error.localizedDescription)"
        }
        return nil
    }

    public func deleteComposition(_ composition: Composition) async {
        deletingId = composition.id
        defer { deletingId = nil }
        do {
            try await api.deleteComposition(id: composition.id)
            withAnimation { compositions.removeAll { $0.id == composition.id } }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to delete composition: \(error.localizedDescription)"
        }
    }
}

public struct CompositionsListView: View {
    @StateObject private var viewModel: CompositionsViewModel
    @State private var showErrorAlert = false
    @State private var showDeleteAlert = false
    @State private var compositionToDelete: Composition?
    @State private var navigationPath = NavigationPath()

    private let api: APIClient

    public init(viewModel: CompositionsViewModel, api: APIClient) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.api = api
    }

    public var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if viewModel.compositions.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    compositionsList
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Reactions")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task {
                            if let comp = await viewModel.create() {
                                navigationPath.append(comp.id)
                            }
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .task { await viewModel.load() }
            .refreshable { await viewModel.load() }
            .overlay {
                if viewModel.isLoading && viewModel.compositions.isEmpty {
                    ProgressView().progressViewStyle(.circular)
                }
            }
            .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.errorMessage = nil }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .alert("Delete Composition", isPresented: $showDeleteAlert, presenting: compositionToDelete) { comp in
                Button("Delete", role: .destructive) {
                    Task { await viewModel.deleteComposition(comp) }
                }
                Button("Cancel", role: .cancel) { }
            } message: { comp in
                Text("Delete \"\(comp.title)\"? This cannot be undone.")
            }
            .navigationDestination(for: String.self) { compositionId in
                CompositionEditorView(compositionId: compositionId, api: api)
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: DesignTokens.spacing) {
            Image(systemName: "rectangle.on.rectangle.angled")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.muted)
            Text("No compositions yet")
                .font(.title3)
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Create a reaction composition to combine your commentary with reference clips.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private let columns = [
        GridItem(.adaptive(minimum: 160), spacing: DesignTokens.spacing)
    ]

    @ViewBuilder
    private var compositionsList: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: DesignTokens.spacing) {
                ForEach(viewModel.compositions) { comp in
                    compositionGridCell(comp)
                }
            }
            .padding(DesignTokens.spacing)
        }
    }

    private func compositionGridCell(_ comp: Composition) -> some View {
        let isDeleting = viewModel.deletingId == comp.id
        return NavigationLink(value: comp.id) {
            CompositionGridCell(composition: comp)
                .overlay(alignment: .topTrailing) {
                    Button {
                        compositionToDelete = comp
                        showDeleteAlert = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .black.opacity(0.6))
                    }
                    .padding(6)
                }
                .overlay {
                    if isDeleting {
                        ZStack {
                            RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                                .fill(.black.opacity(0.5))
                            VStack(spacing: 6) {
                                ProgressView()
                                    .tint(.white)
                                Text("Deleting…")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(isDeleting)
    }
}

struct CompositionGridCell: View {
    let composition: Composition

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Thumbnail
            ZStack {
                Rectangle()
                    .fill(DesignTokens.background)
                    .aspectRatio(16 / 9, contentMode: .fit)

                if let urlString = composition.creatorS3Url, let url = URL(string: urlString) {
                    AsyncImage(url: url) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: {
                        ProgressView().tint(DesignTokens.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                } else {
                    Image(systemName: "rectangle.on.rectangle.angled")
                        .font(.title2)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(composition.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(2)

                HStack(spacing: 4) {
                    statusBadge(composition.status)

                    if let trackCount = composition.tracks?.count, trackCount > 0 {
                        Text("\(trackCount) track\(trackCount == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }

                if let duration = composition.creatorDurationS {
                    Text(formatDuration(duration))
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
            .padding(DesignTokens.smallSpacing)
        }
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        let (label, color): (String, Color) = switch status {
        case "rendering": ("Rendering", .orange)
        case "completed": ("Completed", .green)
        case "failed": ("Failed", .red)
        default: ("Draft", DesignTokens.muted)
        }

        Text(label)
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .cornerRadius(4)
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
