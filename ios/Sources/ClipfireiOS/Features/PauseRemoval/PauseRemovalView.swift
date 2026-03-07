import SwiftUI

@MainActor
public final class PauseRemovalViewModel: ObservableObject {
    @Published public var estimatedCount: Int = 5
    @Published public var isSubmitting = false
    @Published public var isLoading = false
    @Published public var jobs: [PauseRemovalJob] = []
    @Published public var errorMessage: String?
    @Published public var successMessage: String?

    let api: APIClient
    let feedVideoId: String
    private var pollTimer: Timer?

    public init(api: APIClient, feedVideoId: String) {
        self.api = api
        self.feedVideoId = feedVideoId
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.fetchPauseRemovalJobs(feedVideoId: feedVideoId)
            jobs = response.jobs
            startPollingIfNeeded()
        } catch {
            errorMessage = "Unable to load pause removal history"
        }
    }

    public func submit() async {
        isSubmitting = true
        errorMessage = nil
        successMessage = nil
        defer { isSubmitting = false }
        do {
            let request = PauseRemovalRequest(estimatedPauseCount: estimatedCount)
            _ = try await api.triggerPauseRemoval(feedVideoId: feedVideoId, request: request)
            successMessage = "Pause removal job queued!"
            await load()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Failed to start pause removal"
        }
    }

    var hasActiveJob: Bool {
        jobs.contains { $0.status == "queued" || $0.status == "processing" }
    }

    private func startPollingIfNeeded() {
        pollTimer?.invalidate()
        guard hasActiveJob else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.load()
            }
        }
    }

    deinit {
        pollTimer?.invalidate()
    }
}

public struct PauseRemovalView: View {
    @StateObject private var viewModel: PauseRemovalViewModel

    public init(viewModel: PauseRemovalViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                    inputSection
                    resultsSection
                }
                .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Remove Pauses")
            .navigationBarTitleDisplayMode(.inline)
            .task { await viewModel.load() }
        }
    }

    @ViewBuilder
    private var inputSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Roughly how many pauses should be removed?")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Give a ballpark estimate. The system may remove fewer or more pauses depending on the audio.")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            HStack(spacing: DesignTokens.spacing) {
                Stepper(value: $viewModel.estimatedCount, in: 1...500) {
                    Text("\(viewModel.estimatedCount) pauses")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .tint(DesignTokens.accent)
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)

            Button {
                Task { await viewModel.submit() }
            } label: {
                HStack {
                    if viewModel.isSubmitting || viewModel.hasActiveJob {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    } else {
                        Image(systemName: "scissors")
                    }
                    Text(viewModel.isSubmitting ? "Starting…" :
                            viewModel.hasActiveJob ? "In progress…" : "Remove Pauses")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.accent)
            .disabled(viewModel.isSubmitting || viewModel.hasActiveJob)

            if let msg = viewModel.successMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(.green)
            }
            if let err = viewModel.errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private var resultsSection: some View {
        if viewModel.isLoading && viewModel.jobs.isEmpty {
            HStack {
                ProgressView()
                Text("Loading history…")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }

        ForEach(viewModel.jobs) { job in
            PauseRemovalJobCard(job: job)
        }
    }
}

struct PauseRemovalJobCard: View {
    let job: PauseRemovalJob

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            HStack {
                statusBadge
                Spacer()
                Text("~\(job.estimatedPauseCount) est.")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            if job.status == "queued" || job.status == "processing" {
                HStack(spacing: 6) {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .scaleEffect(0.7)
                    Text(job.status == "queued" ? "Waiting in queue…" : "Analyzing audio…")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            if job.status == "failed", let error = job.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if job.status == "completed" {
                completedContent
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch job.status {
            case "queued": return ("Queued", .orange)
            case "processing": return ("Processing", .blue)
            case "completed": return ("Done", .green)
            case "failed": return ("Failed", .red)
            default: return (job.status, .gray)
            }
        }()

        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .cornerRadius(6)
    }

    @ViewBuilder
    private var completedContent: some View {
        let removed = job.removedPauses ?? []

        HStack(spacing: DesignTokens.spacing) {
            Label("\(removed.count) removed", systemImage: "speaker.slash")
                .font(.caption)
                .foregroundStyle(DesignTokens.textPrimary)

            if let totalRemoved = job.totalRemovedSeconds {
                Label(formatDuration(totalRemoved) + " cut", systemImage: "scissors")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }

        if let orig = job.originalDurationS, let result = job.resultDurationS {
            Text("\(formatDuration(orig)) → \(formatDuration(result))")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)
        }

        // Timeline bar
        if let orig = job.originalDurationS, orig > 0, !removed.isEmpty {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.green.opacity(0.2))
                        .frame(height: 16)

                    ForEach(Array(removed.enumerated()), id: \.offset) { _, pause in
                        let left = CGFloat(pause.start / orig) * geo.size.width
                        let width = max(CGFloat(pause.duration / orig) * geo.size.width, 1)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color.red.opacity(0.5))
                            .frame(width: width, height: 16)
                            .offset(x: left)
                    }
                }
            }
            .frame(height: 16)
        }

        if removed.isEmpty {
            Text("No significant pauses found.")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)
        }

        if let url = job.resultS3Url, let link = URL(string: url) {
            Link(destination: link) {
                Label("Download Result", systemImage: "arrow.down.circle")
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(DesignTokens.accent.opacity(0.15))
                    .foregroundStyle(DesignTokens.accent)
                    .cornerRadius(6)
            }
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let m = Int(seconds) / 60
        let s = seconds.truncatingRemainder(dividingBy: 60)
        return m > 0 ? "\(m)m \(String(format: "%.1f", s))s" : "\(String(format: "%.1f", s))s"
    }
}
