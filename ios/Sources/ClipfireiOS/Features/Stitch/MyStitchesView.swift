import AVFoundation
import AVKit
import SwiftUI
import UIKit

public struct MyStitchesView: View {
    @StateObject private var store = LocalStitchStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var playingStitch: LocalStitch?
    @State private var confirmingDeleteOf: LocalStitch?
    @State private var publishingStitch: LocalStitch?

    private let api: APIClient?
    /// Optional retry handler — wired by the parent so the StitchCard's
    /// "Retry" button on a `.failed` row can re-fire the AI Suggest path
    /// without re-rendering the local MP4. Nil-safe: if the parent didn't
    /// wire it, the retry button still appears but is a no-op.
    private let onRetry: ((UUID) -> Void)?

    public init(api: APIClient? = nil, onRetry: ((UUID) -> Void)? = nil) {
        self.api = api
        self.onRetry = onRetry
    }

    public var body: some View {
        ScrollView {
            if store.stitches.isEmpty {
                emptyState
                    .padding(.top, 80)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 100), spacing: 10)],
                    spacing: 10
                ) {
                    ForEach(store.stitches) { stitch in
                        StitchCard(
                            stitch: stitch,
                            url: store.localURL(for: stitch),
                            canPublish: api != nil,
                            onTap: {
                                if stitch.processingState.isReady {
                                    playingStitch = stitch
                                }
                            },
                            onPublish: { publishingStitch = stitch },
                            onDelete: { confirmingDeleteOf = stitch },
                            onRetry: onRetry.map { handler in
                                { handler(stitch.id) }
                            }
                        )
                    }
                }
                .padding()
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("My Stitches")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $playingStitch) { stitch in
            StitchPlayerSheet(url: store.localURL(for: stitch))
        }
        .sheet(item: $publishingStitch) { stitch in
            if let api {
                VideoPublishSheet(
                    source: VideoPublishSheet.VideoSource(
                        id: stitch.serverCompositionId ?? stitch.id.uuidString,
                        kind: .stitch,
                        title: stitch.title,
                        durationS: stitch.durationS,
                        thumbnail: nil,
                        localFileURL: store.localURL(for: stitch),
                        serverCompositionId: stitch.serverCompositionId,
                        initialCaption: stitch.caption
                    ),
                    api: api
                )
            }
        }
        .alert(
            "Delete stitch?",
            isPresented: Binding(
                get: { confirmingDeleteOf != nil },
                set: { if !$0 { confirmingDeleteOf = nil } }
            ),
            presenting: confirmingDeleteOf
        ) { stitch in
            Button("Delete", role: .destructive) {
                store.remove(id: stitch.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: { stitch in
            Text("\"\(stitch.title)\" will be removed from this device.")
        }
        .onAppear {
            // Rejoin any server renders that were already in flight (user
            // backgrounded before the worker finished, then came back).
            resumePollingForInflightStitches()
        }
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.didBecomeActiveNotification
        )) { _ in
            resumePollingForInflightStitches()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "rectangle.split.3x1")
                .font(.system(size: 56))
                .foregroundStyle(DesignTokens.muted)
            Text("No stitches yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Stitches you render appear here.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.muted)
        }
        .frame(maxWidth: .infinity)
    }

    /// For every locally-tracked stitch in `.queued` or `.renderingOnServer`,
    /// kick off a poll task that updates its `processingState` as the server
    /// progresses. Deduped via `StitchPollCoordinator.shared` so the same id
    /// doesn't double-poll if we get foreground events back-to-back.
    private func resumePollingForInflightStitches() {
        guard let api else { return }
        for stitch in store.stitches {
            guard let compositionId = stitch.serverCompositionId else { continue }
            switch stitch.processingState {
            case .queued, .renderingOnServer:
                StitchPollCoordinator.shared.beginPollIfNeeded(
                    stitchId: stitch.id,
                    compositionId: compositionId,
                    layoutKey: stitch.layoutKey,
                    api: api,
                    destURL: store.localURL(for: stitch)
                )
            default:
                break
            }
        }
    }
}

// MARK: - Poll coordinator (foreground-only)

/// Process-wide ledger of which stitches we already have a poll task running for,
/// so a repeated `.onAppear` / foreground event doesn't spawn duplicate pollers.
/// Tasks self-deregister on completion via the deferred cleanup in `beginPollIfNeeded`.
@MainActor
final class StitchPollCoordinator {
    static let shared = StitchPollCoordinator()
    private var active: [UUID: Task<Void, Never>] = [:]
    private init() {}

    /// Start polling for one stitch if not already polling. Idempotent.
    func beginPollIfNeeded(
        stitchId: UUID,
        compositionId: String,
        layoutKey: String,
        api: APIClient,
        destURL: URL
    ) {
        if active[stitchId] != nil { return }
        let task = Task { @MainActor [weak self] in
            defer { self?.active[stitchId] = nil }
            let outcome = await StitchEditorViewModel.pollForServerRender(
                compositionId: compositionId,
                layoutKey: layoutKey,
                stitchId: stitchId,
                api: api
            )
            switch outcome {
            case .completed(let output):
                if let s3 = output.s3Url {
                    LocalStitchStore.shared.setOutputS3Url(id: stitchId, url: s3)
                    if let url = URL(string: s3) {
                        do {
                            try await StitchEditorViewModel.downloadOutput(from: url, to: destURL, api: api)
                            LocalStitchStore.shared.setProcessingState(id: stitchId, .ready)
                        } catch {
                            LocalStitchStore.shared.setProcessingState(
                                id: stitchId,
                                .failed("Couldn't download the rendered video — tap to retry")
                            )
                        }
                    } else {
                        LocalStitchStore.shared.setProcessingState(
                            id: stitchId,
                            .failed("Server returned an invalid output URL")
                        )
                    }
                } else {
                    LocalStitchStore.shared.setProcessingState(
                        id: stitchId,
                        .failed("Server output is missing its S3 URL")
                    )
                }
            case .failed(let message):
                LocalStitchStore.shared.setProcessingState(id: stitchId, .failed(message))
            case .timedOut:
                // Leave the row in `.renderingOnServer` so the next foreground
                // event picks it back up. Don't transition to .failed on a
                // foreground-only timeout — the worker may still be running.
                break
            case .cancelled:
                break
            }
        }
        active[stitchId] = task
    }
}

private struct StitchCard: View {
    let stitch: LocalStitch
    let url: URL
    let canPublish: Bool
    let onTap: () -> Void
    let onPublish: () -> Void
    let onDelete: () -> Void
    let onRetry: (() -> Void)?

    @State private var thumbnail: UIImage?
    @State private var showFailureDetail = false

    private var isProcessing: Bool { !stitch.processingState.isReady }
    private var failureMessage: String? { stitch.processingState.failureMessage }

    /// Human-readable status pill text for the current `processingState`.
    private var processingLabel: String {
        switch stitch.processingState {
        case .uploadingClips(let p):
            return "Uploading \(Int((p * 100).rounded()))%"
        case .queued:
            return "Queued"
        case .renderingOnServer:
            return "Rendering on server…"
        case .ready:
            return ""
        case .failed:
            return ""
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onTap) {
                ZStack {
                    Color.black
                    if let thumbnail {
                        Image(uiImage: thumbnail)
                            .resizable()
                            .scaledToFill()
                    }
                    if isProcessing {
                        // Soft dim over the thumbnail while the pipeline is mid-flight.
                        Color.black.opacity(0.35)
                    } else {
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(.white.opacity(0.9))
                    }
                }
                .aspectRatio(stitch.layoutKey == "landscape" ? 16.0 / 9.0 : 9.0 / 16.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                    Button(action: onDelete) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .black.opacity(0.7))
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                }
                .overlay(alignment: .bottomLeading) {
                    if isProcessing, failureMessage == nil {
                        ProcessingPill(label: processingLabel)
                            .padding(6)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if !isProcessing {
                        Text(formatStitchDuration(stitch.durationS))
                            .font(.caption2)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.black.opacity(0.7))
                            .clipShape(Capsule())
                            .padding(6)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(isProcessing)

            if !isProcessing {
                Text(stitch.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(1)
            }

            if let failureMessage {
                VStack(alignment: .leading, spacing: 4) {
                    Button {
                        showFailureDetail = true
                    } label: {
                        HStack(alignment: .top, spacing: 4) {
                            Text(failureMessage)
                                .font(.caption2)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.leading)
                                .lineLimit(3)
                            Image(systemName: "info.circle")
                                .font(.caption2)
                                .foregroundStyle(.red.opacity(0.7))
                        }
                    }
                    .buttonStyle(.plain)
                    if let onRetry {
                        Button(action: onRetry) {
                            Label("Retry", systemImage: "arrow.clockwise")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: 28)
                                .background(DesignTokens.accent)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 2)
            } else if canPublish && !isProcessing {
                Button(action: onPublish) {
                    Label("Publish", systemImage: "paperplane.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 28)
                        .background(DesignTokens.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
        }
        .task(id: url) {
            await loadThumbnail()
        }
        .sheet(isPresented: $showFailureDetail) {
            FailureDetailSheet(message: failureMessage ?? "")
        }
    }

    private func loadThumbnail() async {
        // The local MP4 doesn't exist until the server render has been downloaded.
        // Don't probe it while we're still in any pre-ready state.
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let asset = AVURLAsset(url: url)
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 720, height: 720)
        let time = CMTime(seconds: 0.1, preferredTimescale: 600)
        do {
            let (cg, _) = try await gen.image(at: time)
            await MainActor.run { self.thumbnail = UIImage(cgImage: cg) }
        } catch {
            // leave placeholder
        }
    }
}

/// Modal that shows the full render-failure message — unlimited line count, scrollable,
/// with a "Copy" button that drops the text on the system pasteboard so it can be pasted
/// into a chat / diagnostic note without retyping.
private struct FailureDetailSheet: View {
    let message: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Render failure")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text(message)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(DesignTokens.surface)
                        .cornerRadius(8)
                    Button {
                        UIPasteboard.general.string = message
                        copied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                    } label: {
                        Label(copied ? "Copied" : "Copy details", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(copied ? Color.green : DesignTokens.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct ProcessingPill: View {
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            ProgressView()
                .tint(.white)
                .scaleEffect(0.7)
            Text(label.isEmpty ? "Processing…" : label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.7))
        .clipShape(Capsule())
    }
}

private struct StitchPlayerSheet: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        NavigationStack {
            Group {
                if let player {
                    VideoPlayer(player: player)
                        .ignoresSafeArea()
                        .background(.black)
                } else {
                    Color.black
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        player?.pause()
                        dismiss()
                    }
                }
            }
            .onAppear {
                // Use the playback category so audio plays even when the silent switch
                // is on — the most common "missing audio" cause is the phone being muted.
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
                try? AVAudioSession.sharedInstance().setActive(true)
                let p = AVPlayer(url: url)
                p.volume = 1.0
                player = p
                p.play()
            }
            .onDisappear {
                player?.pause()
                try? AVAudioSession.sharedInstance().setActive(false)
            }
        }
    }
}

private func formatStitchDuration(_ s: Double) -> String {
    let total = Int(s.rounded())
    let m = total / 60
    let sec = total % 60
    return String(format: "%d:%02d", m, sec)
}
