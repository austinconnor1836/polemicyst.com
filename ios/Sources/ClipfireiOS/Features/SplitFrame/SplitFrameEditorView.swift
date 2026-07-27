import AVFoundation
import AVKit
import SwiftUI

/// Sheet-style Split-Frame composer. Two big tap tiles (video + image) sit
/// above a live 9:16 preview showing the picked video on top and picked image
/// on bottom, split cleanly at the midpoint. Optional caption field feeds
/// straight into the render manifest.
///
/// Fire-and-forget: tapping "Render" queues the job server-side and invokes
/// `onRenderDispatched`, letting the parent dismiss + switch surfaces. Same
/// UX contract as `StitchEditorView` (which fires the same closure right
/// before dismissing itself).
public struct SplitFrameEditorView: View {
    @StateObject private var viewModel: SplitFrameViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showVideoPicker = false
    @State private var showImagePicker = false
    @State private var showErrorAlert = false

    /// Fires when the render POST returns 202 and the placeholder row has been
    /// staged. Parent typically uses this to dismiss the sheet AND navigate to
    /// `MySplitFramesView` so the user sees their queued render immediately.
    private let onRenderDispatched: (() -> Void)?

    public init(api: APIClient, onRenderDispatched: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: SplitFrameViewModel(api: api))
        self.onRenderDispatched = onRenderDispatched
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    pickerTilesCard
                    previewCard
                    captionCard
                    renderButton
                }
                .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("New Split Frame")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .sheet(isPresented: $showVideoPicker) {
                SplitFrameVideoPicker { provider in
                    showVideoPicker = false
                    viewModel.handleVideoPicked(provider)
                }
                .ignoresSafeArea()
            }
            .sheet(isPresented: $showImagePicker) {
                SplitFrameImagePicker { provider in
                    showImagePicker = false
                    viewModel.handleImagePicked(provider)
                }
                .ignoresSafeArea()
            }
            .onAppear {
                viewModel.onRenderDispatched = {
                    onRenderDispatched?()
                    dismiss()
                }
            }
            .onChange(of: viewModel.stage) { _, stage in
                if case .failed = stage { showErrorAlert = true }
            }
            .alert("Something went wrong", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.stage = .idle }
            } message: {
                if case .failed(let m) = viewModel.stage { Text(m) }
            }
        }
    }

    // MARK: - Cards

    private var pickerTilesCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Assets").font(.headline).foregroundStyle(DesignTokens.textPrimary)
            HStack(spacing: DesignTokens.spacing) {
                pickTile(
                    title: "Pick video",
                    subtitle: viewModel.draft.videoLocalURL == nil
                        ? "Top half"
                        : "Ready — tap to change",
                    icon: "video.fill",
                    highlighted: viewModel.draft.videoLocalURL == nil
                ) {
                    showVideoPicker = true
                }
                pickTile(
                    title: "Pick image",
                    subtitle: viewModel.draft.imageLocalURL == nil
                        ? "Bottom half"
                        : "Ready — tap to change",
                    icon: "photo.fill",
                    highlighted: viewModel.draft.imageLocalURL == nil
                ) {
                    showImagePicker = true
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private func pickTile(
        title: String,
        subtitle: String,
        icon: String,
        highlighted: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(highlighted ? DesignTokens.accent : DesignTokens.textPrimary)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .padding(.horizontal, 12)
            .background(DesignTokens.background)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(
                        highlighted ? DesignTokens.accent.opacity(0.5) : Color.clear,
                        lineWidth: 1.5
                    )
            )
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Preview")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)
            SplitFramePreview(
                videoURL: viewModel.draft.videoLocalURL,
                imagePreview: viewModel.imagePreview,
                caption: viewModel.draft.caption
            )
            Text(previewCaption)
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var previewCaption: String {
        switch (viewModel.draft.videoLocalURL, viewModel.draft.imageLocalURL) {
        case (nil, nil): return "Pick a video and image to preview your split frame."
        case (_?, nil): return "Now pick an image for the bottom half."
        case (nil, _?): return "Now pick a video for the top half."
        case (_?, _?): return "Portrait 9:16 — 720 × 1280. Rendered server-side."
        }
    }

    private var captionCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Caption (optional)")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)
            TextField(
                "Text to overlay",
                text: $viewModel.draft.caption,
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .lineLimit(1...3)
            Text("Burned into the bottom portion of the composed frame.")
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var renderButton: some View {
        let enabled = viewModel.draft.isReadyToRender && !viewModel.stage.isBusy
        return Button {
            viewModel.render()
        } label: {
            HStack(spacing: 8) {
                if viewModel.stage.isBusy {
                    ProgressView().tint(.white)
                }
                Text(renderButtonLabel)
                    .font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(enabled ? DesignTokens.accent : DesignTokens.muted.opacity(0.5))
            .cornerRadius(DesignTokens.cornerRadius)
        }
        .disabled(!enabled)
        .buttonStyle(.plain)
    }

    private var renderButtonLabel: String {
        switch viewModel.stage {
        case .loadingVideo: return "Loading video…"
        case .loadingImage: return "Loading image…"
        case .dispatching: return "Uploading…"
        case .dispatched: return "Queued"
        default: return "Render Split Frame"
        }
    }
}

// MARK: - Preview subview (live 9:16 stack)

/// Shows the picked video (top half) muted-and-looping over the picked image
/// (bottom half). Uses a fixed 9:16 aspect frame so the preview matches the
/// server's output shape 1:1. Empty slots render a placeholder that spells
/// out which half is which.
private struct SplitFramePreview: View {
    let videoURL: URL?
    let imagePreview: UIImage?
    let caption: String

    var body: some View {
        // 9:16 preview. Aspect ratio is enforced so the two halves are equal,
        // matching the server render's 720×1280 canvas (equal-height halves).
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = width * 16 / 9

            VStack(spacing: 0) {
                topHalf
                    .frame(width: width, height: height / 2)
                    .clipped()
                bottomHalf
                    .frame(width: width, height: height / 2)
                    .clipped()
            }
            .frame(width: width, height: height)
            .overlay(alignment: .bottom) {
                if !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(caption)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.55))
                        .cornerRadius(6)
                        .padding(.bottom, height / 8)
                        .padding(.horizontal, 8)
                }
            }
            .background(Color.black)
            .cornerRadius(8)
            .overlay(alignment: .center) {
                Rectangle()
                    .fill(Color.white.opacity(0.15))
                    .frame(height: 1)
            }
        }
        .aspectRatio(9.0/16.0, contentMode: .fit)
    }

    @ViewBuilder
    private var topHalf: some View {
        if let videoURL {
            LoopingVideoPlayer(url: videoURL)
                .allowsHitTesting(false)
        } else {
            placeholder(
                icon: "video.fill",
                title: "Video"
            )
        }
    }

    @ViewBuilder
    private var bottomHalf: some View {
        if let image = imagePreview {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            placeholder(
                icon: "photo.fill",
                title: "Image"
            )
        }
    }

    private func placeholder(icon: String, title: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
            Text(title)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(Color.white.opacity(0.65))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: 0.15))
    }
}

/// Silent, looping preview of a picked video. Uses AVQueuePlayer +
/// `AVPlayerLooper` for a gap-free loop. Muted so the preview never fights
/// with the user's ringer switch — the composed output keeps the video's
/// original audio.
private struct LoopingVideoPlayer: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PlayerContainerView {
        let view = PlayerContainerView()
        view.configure(with: url)
        return view
    }

    func updateUIView(_ uiView: PlayerContainerView, context: Context) {
        uiView.configure(with: url)
    }

    final class PlayerContainerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        private var currentURL: URL?
        private var looper: AVPlayerLooper?
        private var queuePlayer: AVQueuePlayer?

        func configure(with url: URL) {
            if currentURL == url { return }
            currentURL = url

            let asset = AVURLAsset(url: url)
            let item = AVPlayerItem(asset: asset)
            let player = AVQueuePlayer(playerItem: item)
            player.isMuted = true
            player.actionAtItemEnd = .advance
            let playerLayer = layer as! AVPlayerLayer
            playerLayer.player = player
            playerLayer.videoGravity = .resizeAspectFill

            looper = AVPlayerLooper(player: player, templateItem: item)
            queuePlayer = player
            player.play()
        }
    }
}
