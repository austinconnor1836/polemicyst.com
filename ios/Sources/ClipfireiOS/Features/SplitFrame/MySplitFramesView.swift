import AVKit
import SwiftUI
import UIKit

/// List of the caller's Split-Frame renders. Backed by the server list
/// endpoint (`GET /api/split-frame`) rather than an on-device store —
/// Split-Frame draft state is transient, but every finished render lives
/// server-side and is durable across reinstalls.
///
/// UI follows the project's Card + CardHeader + CardContent convention. On
/// iPhone-class viewports we render a scroll list; on larger canvases the
/// grid adapts. Delete uses the standard confirmation + overlay pattern
/// documented in `polemicyst.com/CLAUDE.md` ("Deletion UX standard").
public struct MySplitFramesView: View {
    @StateObject private var viewModel: MySplitFramesViewModel

    // Deleting-id + delete-confirmation state, per the deletion UX convention.
    @State private var confirmingDeleteOf: SplitFrameComposition?
    @State private var deletingId: String?

    // Playback + polling.
    @State private var playingRow: SplitFrameComposition?
    @State private var pollingTasks: [String: Task<Void, Never>] = [:]

    public init(api: APIClient) {
        _viewModel = StateObject(wrappedValue: MySplitFramesViewModel(api: api))
    }

    public var body: some View {
        ScrollView {
            if viewModel.isLoadingInitial {
                loadingState.padding(.top, 80)
            } else if viewModel.rows.isEmpty {
                emptyState.padding(.top, 80)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 160), spacing: 12)],
                    spacing: 12
                ) {
                    ForEach(viewModel.rows) { row in
                        SplitFrameCard(
                            row: row,
                            deleting: deletingId == row.id,
                            onTap: {
                                guard row.isReady else { return }
                                playingRow = row
                            },
                            onDelete: { confirmingDeleteOf = row }
                        )
                    }
                }
                .padding()
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Split Frames")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await viewModel.reload()
        }
        .task {
            await viewModel.reloadIfNeeded()
            startPollingForInflightRows()
        }
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.didBecomeActiveNotification
        )) { _ in
            startPollingForInflightRows()
        }
        .sheet(item: $playingRow) { row in
            if let urlString = row.latestOutput?.s3Url, let url = URL(string: urlString) {
                SplitFramePlayerSheet(url: url)
            }
        }
        .alert(
            "Delete split frame?",
            isPresented: Binding(
                get: { confirmingDeleteOf != nil },
                set: { if !$0 { confirmingDeleteOf = nil } }
            ),
            presenting: confirmingDeleteOf
        ) { row in
            Button("Delete", role: .destructive) {
                Task { await performDelete(row) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text("\"\(row.title)\" will be removed from your account.")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "rectangle.tophalf.filled")
                .font(.system(size: 56))
                .foregroundStyle(DesignTokens.muted)
            Text("No split frames yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Renders you create from the + menu appear here.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView().tint(DesignTokens.accent)
            Text("Loading…")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.muted)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Delete

    private func performDelete(_ row: SplitFrameComposition) async {
        deletingId = row.id
        defer { deletingId = nil }
        do {
            try await viewModel.delete(id: row.id)
        } catch {
            // Non-fatal — the row stays in the list; the reload on next open
            // will reconcile if the server actually did delete it.
            NSLog("[SplitFrame] delete failed: %@", error.localizedDescription)
        }
    }

    // MARK: - Polling

    private func startPollingForInflightRows() {
        for row in viewModel.rows {
            let inflight = !row.isReady && !row.isFailed
            guard inflight else { continue }
            if pollingTasks[row.id] != nil { continue }
            let task = Task { @MainActor in
                await viewModel.pollUntilTerminal(id: row.id)
                pollingTasks[row.id] = nil
            }
            pollingTasks[row.id] = task
        }
    }
}

// MARK: - ViewModel

@MainActor
public final class MySplitFramesViewModel: ObservableObject {
    @Published public private(set) var rows: [SplitFrameComposition] = []
    @Published public private(set) var isLoadingInitial: Bool = true

    private let api: APIClient
    private var didLoadOnce = false

    public init(api: APIClient) {
        self.api = api
    }

    func reloadIfNeeded() async {
        if !didLoadOnce {
            await reload()
        }
    }

    public func reload() async {
        do {
            let list = try await api.fetchSplitFrameCompositions()
            self.rows = list
        } catch {
            NSLog("[SplitFrame] fetch list failed: %@", error.localizedDescription)
        }
        self.isLoadingInitial = false
        self.didLoadOnce = true
    }

    public func delete(id: String) async throws {
        try await api.deleteSplitFrameComposition(id: id)
        rows.removeAll { $0.id == id }
    }

    /// Polls one row every 5s until its output flips to `completed` or
    /// `failed`, or the caller cancels. Silent on network blips.
    public func pollUntilTerminal(id: String) async {
        let deadline = Date().addingTimeInterval(30 * 60)
        while Date() < deadline {
            if Task.isCancelled { return }
            do {
                let row = try await api.fetchSplitFrameComposition(id: id)
                if let idx = rows.firstIndex(where: { $0.id == id }) {
                    rows[idx] = row
                }
                if row.isReady || row.isFailed { return }
            } catch {
                // Row may have been deleted mid-poll — bail.
                if let apiErr = error as? APIError,
                   case .statusCode(let code) = apiErr, code == 404 {
                    rows.removeAll { $0.id == id }
                    return
                }
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }
}

// MARK: - Card

private struct SplitFrameCard: View {
    let row: SplitFrameComposition
    let deleting: Bool
    let onTap: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .topTrailing) {
                VStack(alignment: .leading, spacing: 8) {
                    thumbnailPlaceholder
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineLimit(1)
                        statusLabel
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                }
                .background(DesignTokens.surface)
                .cornerRadius(DesignTokens.cornerRadius)

                deleteButton
                    .padding(6)

                if deleting {
                    deletingOverlay
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!row.isReady && !row.isFailed)
    }

    /// 9:16 tinted placeholder. When we add real thumbnails later, this is
    /// where an S3 thumb goes.
    private var thumbnailPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(white: 0.14))
                .aspectRatio(9.0/16.0, contentMode: .fit)
            Image(systemName: row.isReady ? "play.circle.fill" : "rectangle.tophalf.filled")
                .font(.system(size: 32))
                .foregroundStyle(DesignTokens.muted)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    @ViewBuilder
    private var statusLabel: some View {
        let status = row.latestOutput?.status ?? row.status
        HStack(spacing: 4) {
            Circle().fill(statusColor).frame(width: 6, height: 6)
            Text(statusText(for: status))
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
        }
    }

    private var statusColor: Color {
        let status = row.latestOutput?.status ?? row.status
        switch status {
        case "completed": return .green
        case "failed": return .red
        case "rendering": return .yellow
        default: return DesignTokens.muted
        }
    }

    private func statusText(for status: String) -> String {
        switch status {
        case "completed": return "Ready"
        case "failed":
            if let err = row.latestOutput?.renderError, !err.isEmpty {
                return "Failed: \(err)"
            }
            return "Failed"
        case "rendering": return "Rendering…"
        case "pending": return "Queued"
        default: return status.capitalized
        }
    }

    /// Hover-revealed trash icon, keyed off the deletion UX pattern from
    /// `polemicyst.com/CLAUDE.md`. On touch devices we always show it —
    /// hover doesn't apply, and the button is small enough not to intrude.
    private var deleteButton: some View {
        Button {
            onDelete()
        } label: {
            Image(systemName: "trash.fill")
                .font(.caption)
                .foregroundStyle(.white)
                .padding(6)
                .background(Color.black.opacity(0.55))
                .clipShape(Circle())
        }
        .disabled(deleting)
        .buttonStyle(.plain)
    }

    private var deletingOverlay: some View {
        RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
            .fill(Color.black.opacity(0.55))
            .overlay {
                HStack(spacing: 8) {
                    ProgressView().tint(.white)
                    Text("Deleting…")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                }
            }
    }
}

// MARK: - Player sheet

private struct SplitFramePlayerSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VideoPlayer(player: AVPlayer(url: url))
                .ignoresSafeArea()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: url)
                    }
                }
        }
    }
}
