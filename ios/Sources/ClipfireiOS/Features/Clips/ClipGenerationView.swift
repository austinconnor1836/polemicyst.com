import SwiftUI

@MainActor
public final class ClipGenerationViewModel: ObservableObject {
    @Published public var selectedVideo: FeedVideo?
    @Published public var videos: [FeedVideo] = []
    @Published public var isLoading = false
    @Published public var isGenerating = false
    @Published public var resultMessage: String?
    @Published public var errorMessage: String?
    @Published public var upgradeError: APIError?

    // Generation options
    @Published public var targetPlatform = "all"
    @Published public var contentStyle = "auto"
    @Published public var scoringMode = "heuristic"
    @Published public var llmProvider = "ollama"
    @Published public var saferClips = false
    @Published public var includeAudio = false

    private let api: APIClient
    public let userId: String

    public init(api: APIClient, userId: String = "") {
        self.api = api
        self.userId = userId
    }

    public func loadVideos() async {
        isLoading = true
        defer { isLoading = false }
        do {
            videos = try await api.fetchFeedVideos()
        } catch {
            errorMessage = "Failed to load videos: \(error.localizedDescription)"
        }
    }

    public func generate() async {
        guard let video = selectedVideo else {
            errorMessage = "Select a video first"
            return
        }

        isGenerating = true
        defer { isGenerating = false }

        let request = TriggerClipRequest(
            feedVideoId: video.id,
            userId: userId,
            scoringMode: scoringMode,
            includeAudio: includeAudio,
            saferClips: saferClips,
            targetPlatform: targetPlatform,
            contentStyle: contentStyle,
            llmProvider: llmProvider
        )

        do {
            let response = try await api.triggerClip(request)
            resultMessage = response.message
        } catch let error as APIError {
            if error.isUpgradeRequired {
                upgradeError = error
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = "Failed to start clip generation: \(error.localizedDescription)"
        }
    }
}

public struct ClipGenerationView: View {
    @StateObject private var viewModel: ClipGenerationViewModel
    @Environment(\.dismiss) private var dismiss

    public init(viewModel: ClipGenerationViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            Form {
                videoSection
                platformSection
                scoringSection
                optionsSection
                generateSection
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Generate Clip")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .task { await viewModel.loadVideos() }
            .alert("Error", isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            .alert("Job Started", isPresented: Binding(
                get: { viewModel.resultMessage != nil },
                set: { if !$0 { viewModel.resultMessage = nil } }
            )) {
                Button("OK", role: .cancel) {
                    dismiss()
                }
            } message: {
                Text(viewModel.resultMessage ?? "")
            }
            .sheet(item: $viewModel.upgradeError) { error in
                UpgradePromptView(
                    message: error.localizedDescription,
                    quotaLimit: error.quotaLimit,
                    quotaUsage: error.quotaUsage,
                    onDismiss: { viewModel.upgradeError = nil }
                )
                .presentationDetents([.medium])
            }
        }
    }

    @ViewBuilder
    private var videoSection: some View {
        Section {
            if viewModel.isLoading {
                HStack {
                    ProgressView()
                    Text("Loading videos…")
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else if viewModel.videos.isEmpty {
                Text("No feed videos available")
                    .foregroundStyle(DesignTokens.muted)
            } else {
                Picker("Source Video", selection: $viewModel.selectedVideo) {
                    Text("Select a video…").tag(nil as FeedVideo?)
                    ForEach(viewModel.videos) { video in
                        Text(video.title ?? video.id)
                            .tag(video as FeedVideo?)
                            .lineLimit(1)
                    }
                }
            }
        } header: {
            Text("Source")
        }
    }

    @ViewBuilder
    private var platformSection: some View {
        Section {
            Picker("Target Platform", selection: $viewModel.targetPlatform) {
                Text("All").tag("all")
                Text("Reels").tag("reels")
                Text("Shorts").tag("shorts")
                Text("YouTube").tag("youtube")
            }

            Picker("Content Style", selection: $viewModel.contentStyle) {
                Text("Auto-detect").tag("auto")
                Text("Politics").tag("politics")
                Text("Comedy").tag("comedy")
                Text("Education").tag("education")
                Text("Podcast").tag("podcast")
                Text("Gaming").tag("gaming")
                Text("Vlog").tag("vlog")
                Text("Other").tag("other")
            }
        } header: {
            Text("Platform & Style")
        }
    }

    @ViewBuilder
    private var scoringSection: some View {
        Section {
            Picker("Scoring Mode", selection: $viewModel.scoringMode) {
                Text("Heuristic").tag("heuristic")
                Text("Hybrid").tag("hybrid")
                Text("Gemini").tag("gemini")
            }

            Picker("LLM Provider", selection: $viewModel.llmProvider) {
                Text("Ollama").tag("ollama")
                Text("Gemini").tag("gemini")
            }
        } header: {
            Text("Scoring")
        }
    }

    @ViewBuilder
    private var optionsSection: some View {
        Section {
            Toggle("Safer Clips", isOn: $viewModel.saferClips)
            Toggle("Include Audio", isOn: $viewModel.includeAudio)
        } header: {
            Text("Options")
        }
    }

    @ViewBuilder
    private var generateSection: some View {
        Section {
            Button {
                Task { await viewModel.generate() }
            } label: {
                HStack {
                    if viewModel.isGenerating {
                        ProgressView()
                            .progressViewStyle(.circular)
                    }
                    Text(viewModel.isGenerating ? "Generating…" : "Generate Clip")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
            }
            .disabled(viewModel.selectedVideo == nil || viewModel.isGenerating)
        }
    }
}

extension FeedVideo: Hashable {
    public static func == (lhs: FeedVideo, rhs: FeedVideo) -> Bool {
        lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
