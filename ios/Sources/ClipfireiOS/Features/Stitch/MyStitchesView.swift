import AVFoundation
import AVKit
import SwiftUI

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
                        ProcessingPill()
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
        // The local MP4 doesn't exist until the renderer finishes its move.
        // Don't probe it during PHASE 1 of the fire-and-forget pipeline.
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
    var body: some View {
        HStack(spacing: 6) {
            ProgressView()
                .tint(.white)
                .scaleEffect(0.7)
            Text("Processing…")
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
