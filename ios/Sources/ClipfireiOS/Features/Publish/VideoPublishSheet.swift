import AVFoundation
import AVKit
import SwiftUI
import UIKit

/// Generic "publish a video" sheet. Reachable from MyStitches (today) and from Clips /
/// Reactions (future). Lets the user pick platforms, write a caption, and queue a publish.
public struct VideoPublishSheet: View {
    public struct PlatformOption: Identifiable, Equatable {
        public let id: String
        public let label: String
        public let systemIcon: String
        public let captionLimit: Int?  // nil = no enforced limit in UI

        public static let allPlatforms: [PlatformOption] = [
            .init(id: "youtube",   label: "YouTube Shorts", systemIcon: "play.rectangle.fill", captionLimit: nil),
            .init(id: "instagram", label: "Instagram Reels", systemIcon: "camera.fill",         captionLimit: 2200),
            .init(id: "twitter",   label: "X (Twitter)",     systemIcon: "bird.fill",           captionLimit: 280),
            .init(id: "bluesky",   label: "Bluesky",         systemIcon: "cloud.fill",          captionLimit: 300),
            .init(id: "tiktok",    label: "TikTok",          systemIcon: "music.note",          captionLimit: 2200),
        ]
    }

    public struct VideoSource {
        public let id: String  // composition id or clip id
        public let kind: Kind
        public let title: String
        public let durationS: Double
        public let thumbnail: UIImage?
        public let localFileURL: URL?  // for preview playback before upload, when available
        /// Server-side Composition id when known (stitches that have finished
        /// their silent background upload). Used by the AI suggest path to
        /// pull the per-track transcripts and build a stitched transcript
        /// prompt — without it the LLM sees just the title and generates
        /// generic copy. Optional because freshly-rendered stitches publish
        /// before the upload finishes.
        public let serverCompositionId: String?

        public enum Kind: String { case stitch, clip, reaction }

        public init(
            id: String,
            kind: Kind,
            title: String,
            durationS: Double,
            thumbnail: UIImage? = nil,
            localFileURL: URL? = nil,
            serverCompositionId: String? = nil
        ) {
            self.id = id
            self.kind = kind
            self.title = title
            self.durationS = durationS
            self.thumbnail = thumbnail
            self.localFileURL = localFileURL
            self.serverCompositionId = serverCompositionId
        }
    }

    let source: VideoSource
    let api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var title: String = ""
    @State private var caption: String = ""
    @State private var selectedPlatforms: Set<String> = []
    @State private var isPublishing = false
    @State private var isGenerating = false
    @State private var resultMessage: String?
    @State private var showResult = false
    @State private var showPreview = false

    public init(source: VideoSource, api: APIClient) {
        self.source = source
        self.api = api
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    previewCard
                    aiSuggestButton
                    titleCard
                    captionCard
                    platformsCard
                    publishButton
                }
                .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Publish Video")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                // Read the user's "auto-generate publish meta" preference and trigger the
                // AI suggest on open if enabled. Failure is silent — the manual button is
                // always available as fallback.
                if let settings = try? await api.fetchAutomationSettings(),
                   settings.autoGeneratePublishMeta,
                   title.isEmpty, caption.isEmpty {
                    await suggestWithAI()
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.disabled(isPublishing)
                }
            }
            .alert("Publish", isPresented: $showResult, presenting: resultMessage) { _ in
                Button("OK", role: .cancel) {
                    resultMessage = nil
                    if !isPublishing { dismiss() }
                }
            } message: { msg in
                Text(msg)
            }
            .sheet(isPresented: $showPreview) {
                if let url = source.localFileURL {
                    NavigationStack {
                        VideoPlayer(player: AVPlayer(url: url))
                            .ignoresSafeArea()
                            .background(.black)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("Done") { showPreview = false }
                                }
                            }
                    }
                }
            }
        }
    }

    // MARK: - Cards

    private var previewCard: some View {
        HStack(spacing: DesignTokens.spacing) {
            ZStack {
                Color.black
                if let img = source.thumbnail {
                    Image(uiImage: img).resizable().scaledToFill()
                }
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.white.opacity(0.9))
            }
            .frame(width: 80, height: 80)
            .cornerRadius(8)
            .clipped()
            .onTapGesture { if source.localFileURL != nil { showPreview = true } }

            VStack(alignment: .leading, spacing: 4) {
                Text(source.title).font(.subheadline.weight(.semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text(formatPublishDuration(source.durationS))
                    .font(.caption).foregroundStyle(DesignTokens.muted)
                Text(source.kind.rawValue.capitalized)
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(DesignTokens.accent.opacity(0.2))
                    .foregroundStyle(DesignTokens.accent)
                    .clipShape(Capsule())
            }
            Spacer()
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var aiSuggestButton: some View {
        Button {
            Task { await suggestWithAI() }
        } label: {
            HStack(spacing: 6) {
                if isGenerating {
                    ProgressView().tint(.white).scaleEffect(0.8)
                } else {
                    Image(systemName: "sparkles")
                }
                Text(isGenerating ? "Drafting…" : "Suggest title & caption with AI")
                    .font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(
                LinearGradient(
                    colors: [.purple, DesignTokens.accent],
                    startPoint: .leading, endPoint: .trailing
                )
            )
            .cornerRadius(DesignTokens.cornerRadius)
        }
        .buttonStyle(.plain)
        .disabled(isGenerating || isPublishing)
    }

    private var titleCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Title").font(.headline).foregroundStyle(DesignTokens.textPrimary)
            TextField("Video title", text: $title)
                .textFieldStyle(.roundedBorder)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var captionCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            HStack {
                Text("Caption").font(.headline).foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if let limit = effectiveCharLimit {
                    Text("\(caption.count)/\(limit)")
                        .font(.caption2)
                        .foregroundStyle(isOverLimit ? .red : DesignTokens.muted)
                }
            }
            TextField("What's this clip about?", text: $caption, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var platformsCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Platforms").font(.headline).foregroundStyle(DesignTokens.textPrimary)
            ForEach(PlatformOption.allPlatforms) { p in
                Button {
                    if selectedPlatforms.contains(p.id) {
                        selectedPlatforms.remove(p.id)
                    } else {
                        selectedPlatforms.insert(p.id)
                    }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: p.systemIcon)
                            .font(.title3)
                            .foregroundStyle(DesignTokens.accent)
                            .frame(width: 28)
                        Text(p.label)
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                        Image(systemName: selectedPlatforms.contains(p.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedPlatforms.contains(p.id) ? DesignTokens.accent : DesignTokens.muted)
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                if p.id != PlatformOption.allPlatforms.last?.id {
                    Divider().background(DesignTokens.muted.opacity(0.2))
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var publishButton: some View {
        Button {
            Task { await publish() }
        } label: {
            HStack {
                if isPublishing {
                    ProgressView().tint(.white)
                }
                Text(isPublishing ? "Queuing…" : "Publish")
                    .font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(canPublish ? DesignTokens.accent : DesignTokens.muted)
            .cornerRadius(DesignTokens.cornerRadius)
        }
        .buttonStyle(.plain)
        .disabled(!canPublish || isPublishing)
    }

    // MARK: - Derived

    private var canPublish: Bool {
        !selectedPlatforms.isEmpty && !isOverLimit
    }

    private var effectiveCharLimit: Int? {
        var limit: Int? = nil
        for p in PlatformOption.allPlatforms where selectedPlatforms.contains(p.id) {
            if let l = p.captionLimit {
                limit = min(limit ?? l, l)
            }
        }
        return limit
    }

    private var isOverLimit: Bool {
        guard let l = effectiveCharLimit else { return false }
        return caption.count > l
    }

    // MARK: - Network

    private func publish() async {
        isPublishing = true
        defer { isPublishing = false }
        do {
            let request = PublishVideoRequest(
                sourceKind: source.kind.rawValue,
                sourceId: source.id,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                caption: caption.trimmingCharacters(in: .whitespacesAndNewlines),
                platforms: Array(selectedPlatforms).sorted()
            )
            let response = try await api.publishVideo(request)
            resultMessage = "Queued on \(response.queuedPlatforms.count) platform\(response.queuedPlatforms.count == 1 ? "" : "s"). You'll see results in Settings → Publishing soon."
            showResult = true
        } catch {
            resultMessage = "Failed to queue publish: \(error.localizedDescription)"
            showResult = true
        }
    }

    private func suggestWithAI() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            // For stitched compositions, pull the server Composition so we can
            // build the per-source stitched transcript (creator + each track).
            // Without this the LLM only sees the title and produces generic
            // copy — the bug PR #296 fixed on the web side. Failure is silent;
            // we just fall back to title-only context (same as before).
            var stitchedTranscript: String? = nil
            if source.kind == .stitch, let compId = source.serverCompositionId {
                if let composition = try? await api.fetchComposition(id: compId) {
                    let outputTranscript = composition.outputs?
                        .compactMap { $0.transcript }
                        .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    stitchedTranscript = CompositionTranscript.buildStitched(
                        composition: composition,
                        fallback: outputTranscript
                    )
                }
            }

            let contextParts = [
                source.title,
                caption.trimmingCharacters(in: .whitespacesAndNewlines),
                stitchedTranscript ?? "",
            ]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")

            let request = GenerateMetaRequest(
                context: contextParts.isEmpty ? "A short video the user wants to publish to social media." : contextParts,
                platforms: selectedPlatforms.isEmpty ? ["youtube", "instagram", "twitter", "bluesky", "tiktok"] : Array(selectedPlatforms).sorted(),
                seedTitle: title.isEmpty ? nil : title
            )
            let response = try await api.generatePublishMeta(request)
            if !response.title.isEmpty { title = response.title }
            if !response.caption.isEmpty { caption = response.caption }
        } catch {
            resultMessage = "AI suggestion failed: \(error.localizedDescription)"
            showResult = true
        }
    }
}

private func formatPublishDuration(_ s: Double) -> String {
    let total = Int(s.rounded())
    let m = total / 60
    let sec = total % 60
    return String(format: "%d:%02d", m, sec)
}
