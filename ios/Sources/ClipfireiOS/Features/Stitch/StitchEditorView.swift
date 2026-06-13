import AVFoundation
import Combine
import Photos
import PhotosUI
import SwiftUI

// MARK: - Wizard steps

private enum StitchStep: Hashable {
    case text
    case cutout
    case myStitches
}

// MARK: - ViewModel

@MainActor
public final class StitchEditorViewModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case loading        // loading a freshly picked clip into the timeline
        case rendering(Double)
        case uploading(Double)
        case saving
        case completed(String)  // composition id
        case failed(String)

        public var isBusy: Bool {
            switch self {
            case .loading, .rendering, .uploading, .saving: return true
            default: return false
            }
        }
    }

    @Published public var timeline = StitchTimeline()
    @Published public var title: String = ""
    @Published public var stage: Stage = .idle

    private let api: APIClient
    public var apiClient: APIClient { api }
    private let uploader: VideoUploadService
    private let renderer = StitchRenderer()
    private var currentRenderTask: Task<Void, Never>?
    private var timelineSubscription: AnyCancellable?
    /// Umbrella task that copies all picked clips' files in the background. Render awaits this.
    private var copyTask: Task<Void, Never>?
    /// Tasks that upload each clip as a server-side `CompositionTrack` so transcription
    /// kicks off WHILE the user is still editing. Keyed by the local clip id so we can
    /// cancel them if the user removes the clip before the upload finishes.
    private var trackUploadTasks: [UUID: Task<Void, Never>] = [:]
    /// Serializes lazy creation of the server `Composition`. The first clip-add (or the
    /// first reopen of a draft without a stored composition id) races a single create
    /// against itself otherwise.
    private var ensureCompositionTask: Task<String?, Never>?

    public init(api: APIClient) {
        self.api = api
        self.uploader = VideoUploadService(api: api)
        // SwiftUI doesn't auto-forward changes from nested ObservableObjects. Without this,
        // edits to timeline.pendingClipCount / timeline.clips don't trigger view re-renders
        // until something on the ViewModel itself changes.
        timelineSubscription = timeline.objectWillChange.sink { [weak self] in
            guard let self else { return }
            self.objectWillChange.send()
            // Persist the in-progress draft after each mutation so it survives reinstalls.
            self.persistDraft()
        }

        // Restore an in-progress draft, if any.
        if let draft = StitchDraftStore.load() {
            timeline.applyDraft(draft)
            title = draft.title
            // If the draft restored clips that already have local files but never got a
            // server CompositionTrack (eg. they were added in an older app version, or
            // the side-channel failed last session), kick off the uploads now so the
            // user's eventual AI Suggest tap gets transcript-backed copy.
            for clip in timeline.clips {
                if clip.serverTrackId == nil, let url = clip.sourceURL, clip.durationS > 0 {
                    startServerTrackUpload(clipId: clip.id, localURL: url, durationS: clip.durationS)
                }
            }
        }
    }

    private func persistDraft() {
        // Skip persistence while a render is in flight — the snapshot is being consumed.
        if case .rendering = stage { return }
        if case .uploading = stage { return }
        let draft = timeline.currentDraft(title: title)
        if draft.isEmpty {
            StitchDraftStore.clear()
        } else {
            StitchDraftStore.save(draft)
        }
    }

    // MARK: Clip picking

    /// Accept picks from the UIKit-backed `StitchClipPicker`. Cells appear instantly with
    /// PHPicker preview thumbnails (no Photos auth, no PhotosPicker). The slower
    /// `loadFileRepresentation` runs in the background per clip; render awaits any
    /// still-pending copies before composing.
    public func addClips(from providers: [NSItemProvider]) async {
        guard !providers.isEmpty else { return }

        let clipIds: [UUID] = providers.map { _ in UUID() }
        // 1) Insert skeleton cells RIGHT NOW so the user sees something instantly.
        for clipId in clipIds {
            timeline.addClip(StitchClip(
                id: clipId,
                sourceURL: nil,
                photoAssetIdentifier: nil,
                durationS: 0
            ))
        }

        // 2) Kick off the preview-image + file-copy work for each clip in parallel.
        copyTask?.cancel()
        copyTask = Task { [weak self] in
            await withTaskGroup(of: Void.self) { group in
                for (idx, provider) in providers.enumerated() {
                    let clipId = clipIds[idx]
                    group.addTask { [weak self] in
                        await self?.loadFromProvider(clipId: clipId, provider: provider)
                    }
                }
            }
        }
    }

    /// Loads the preview image (fast, sets `previewImages[clipId]`) and the underlying
    /// file (slow, sets the clip's `sourceURL` + `durationS`) for one picked item.
    private func loadFromProvider(clipId: UUID, provider: NSItemProvider) async {
        // Preview thumbnail — typically a few hundred milliseconds, no file copy.
        if let preview = await ItemProviderLoader.loadPreviewImage(provider) {
            timeline.previewImages[clipId] = preview
        }
        // Actual file — required by the renderer, blocks render but not the grid.
        guard let url = await ItemProviderLoader.loadMovieFile(provider) else {
            timeline.removeClip(id: clipId)
            timeline.previewImages.removeValue(forKey: clipId)
            return
        }
        let avAsset = AVURLAsset(url: url)
        let durationS = (try? await avAsset.load(.duration)).map { CMTimeGetSeconds($0) } ?? 0
        timeline.updateClipSourceURL(id: clipId, url: url)
        timeline.updateClipDuration(id: clipId, durationS: durationS)

        // Side-channel: upload this clip to the server as a CompositionTrack now so
        // transcription kicks off while the user is still editing. By the time they
        // tap Publish → AI Suggest, the per-track transcripts are populated and the
        // suggestion can be content-aware. Local preview/render is unaffected — the
        // renderer reads `sourceURL` (local file) for the actual composition.
        startServerTrackUpload(clipId: clipId, localURL: url, durationS: durationS)
    }

    // MARK: Server side-channel (composition + tracks)

    /// Returns the server `Composition` id for the current draft, creating it on first
    /// call. Subsequent calls return the cached id. Safe to call concurrently — all
    /// callers share the same in-flight task. Returns nil if creation failed.
    private func ensureServerComposition() async -> String? {
        if let id = timeline.serverCompositionId { return id }
        if let task = ensureCompositionTask {
            return await task.value
        }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = CreateCompositionRequest(
            title: trimmedTitle.isEmpty ? nil : trimmedTitle,
            mode: "stitch"
        )
        let api = self.api
        let task = Task<String?, Never> { [weak self] in
            let result = try? await api.createComposition(body: body)
            await MainActor.run { [weak self] in
                guard let self else { return }
                if let result {
                    self.timeline.serverCompositionId = result.id
                }
                self.ensureCompositionTask = nil
            }
            return result?.id
        }
        ensureCompositionTask = task
        return await task.value
    }

    /// Fire-and-forget background upload of a single clip to the server as a
    /// CompositionTrack. Stores the resulting server track id on the timeline clip so
    /// removal can fire DELETE later. Silent on failure — local editing isn't blocked.
    private func startServerTrackUpload(clipId: UUID, localURL: URL, durationS: Double) {
        trackUploadTasks[clipId]?.cancel()
        let api = self.api
        let uploader = self.uploader
        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            // Lazy-create the composition before the upload so we have somewhere to attach.
            guard let compositionId = await self.ensureServerComposition() else { return }
            // Resolve dimensions + hasAudio from the local asset (cheap; no extra probe roundtrip).
            let (width, height, hasAudio) = await Self.probeLocalAsset(url: localURL)
            do {
                let upload = try await uploader.upload(
                    fileURL: localURL,
                    prefix: "compositions/\(compositionId)/raw/",
                    contentType: "video/mp4",
                    deleteAfterUpload: false,
                    progress: nil
                )
                if Task.isCancelled { return }
                let track = try await api.addTrack(
                    compositionId: compositionId,
                    body: CreateTrackRequest(
                        s3Key: upload.s3Key,
                        s3Url: upload.s3Url,
                        durationS: durationS,
                        label: nil,
                        width: width,
                        height: height,
                        hasAudio: hasAudio,
                        trackType: "reference"
                    )
                )
                await MainActor.run { [weak self] in
                    self?.timeline.updateClipServerTrackId(id: clipId, serverTrackId: track.id)
                }
            } catch {
                // Silent failure — transcription side-channel is best-effort. The render
                // path still works; AI suggest just falls back to title-only context for
                // this clip. Logged so it's visible in the Xcode console during dev.
                #if DEBUG
                print("[StitchEditor] track upload failed for clip \(clipId): \(error)")
                #endif
            }
        }
        trackUploadTasks[clipId] = task
    }

    /// Probes a local video file for width/height/hasAudio. Returns nils on failure —
    /// the track endpoint accepts null for these fields.
    private static func probeLocalAsset(url: URL) async -> (Int?, Int?, Bool?) {
        let asset = AVURLAsset(url: url)
        let videoTracks = (try? await asset.loadTracks(withMediaType: .video)) ?? []
        let audioTracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []
        var width: Int? = nil
        var height: Int? = nil
        if let videoTrack = videoTracks.first {
            if let size = try? await videoTrack.load(.naturalSize),
               let transform = try? await videoTrack.load(.preferredTransform) {
                let applied = size.applying(transform)
                width = Int(abs(applied.width).rounded())
                height = Int(abs(applied.height).rounded())
            }
        }
        return (width, height, !audioTracks.isEmpty)
    }

    /// Remove a clip from the timeline AND fire DELETE /tracks/<id> for its server-side
    /// counterpart if one exists. Cancels any in-flight upload task for the clip first
    /// so we don't race the delete against a still-pending POST.
    public func removeClip(id: UUID) {
        // Look up the server track id BEFORE the timeline drops the clip.
        let serverTrackId = timeline.clips.first(where: { $0.id == id })?.serverTrackId
        let compositionId = timeline.serverCompositionId

        // Cancel any in-flight upload for this clip.
        trackUploadTasks[id]?.cancel()
        trackUploadTasks.removeValue(forKey: id)

        timeline.removeClip(id: id)
        timeline.previewImages.removeValue(forKey: id)

        if let serverTrackId, let compositionId {
            let api = self.api
            Task.detached { @Sendable in
                try? await api.deleteTrack(
                    compositionId: compositionId,
                    trackId: serverTrackId
                )
            }
        }
    }

    /// Called by render() before taking a snapshot — awaits the umbrella copyTask so every
    /// clip has its sourceURL populated by the time we hand off to the renderer.
    private func waitForPendingFileLoads() async {
        if let copyTask {
            await copyTask.value
        }
    }

    public func setCutoutSource(from item: PhotosPickerItem, clipId: UUID) async {
        stage = .loading
        do {
            guard let movie = try await item.loadTransferable(type: CompositionVideoTransferable.self) else {
                stage = .failed("Could not load the cutout video")
                return
            }
            let durationS = try await loadDuration(url: movie.url)
            timeline.setCutout(CutoutOverlay(
                clipId: clipId,
                sourceURL: movie.url,
                sourceDurationS: durationS
            ))
            stage = .idle
        } catch {
            stage = .failed("Failed to load cutout: \(error.localizedDescription)")
        }
    }

    private func loadDuration(url: URL) async throws -> Double {
        let asset = AVURLAsset(url: url)
        let d = try await asset.load(.duration)
        return CMTimeGetSeconds(d)
    }

    // MARK: Render

    public func render() {
        currentRenderTask?.cancel()
        let chosenTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let api = self.api
        currentRenderTask = Task { [weak self] in
            guard let self else { return }
            do {
                self.stage = .rendering(0)
                // Wait for any clip file copies still in flight (fast-path additions kick
                // these off in the background so the grid populates instantly).
                await self.waitForPendingFileLoads()
                let snap = self.timeline.snapshot()
                // Snapshot the server composition id BEFORE we reset the timeline below.
                // This may be nil if no clip-add ever triggered the side-channel create
                // (eg. the user picked clips before sign-in succeeded). Fall back to
                // creating one in the post-render upload path in that case.
                let existingCompositionId = self.timeline.serverCompositionId
                let outputURL = try await self.renderer.render(snapshot: snap) { p in
                    Task { @MainActor [weak self] in
                        switch p.phase {
                        case .composing: self?.stage = .rendering(0)
                        case .exporting: self?.stage = .rendering(p.fraction)
                        case .completed: self?.stage = .rendering(1)
                        case .failed: break
                        }
                    }
                }

                // Move the rendered MP4 into the persistent local stitches directory.
                let stitchId = UUID()
                let filename = "\(stitchId.uuidString).mp4"
                let stitchesDir = LocalStitchStore.stitchesDir
                try? FileManager.default.createDirectory(
                    at: stitchesDir,
                    withIntermediateDirectories: true
                )
                let destURL = stitchesDir.appendingPathComponent(filename)
                try? FileManager.default.removeItem(at: destURL)
                try FileManager.default.moveItem(at: outputURL, to: destURL)

                let durationS = snap.clips.reduce(0) { $0 + $1.effectiveDurationS }
                let layoutKey = snap.layout == .mobile ? "mobile" : "landscape"
                // Wire the LocalStitch up to its server Composition NOW (if we have one
                // from the side-channel). That way the publish sheet sees a non-nil
                // serverCompositionId from the moment the stitch lands in My Stitches —
                // no race against the post-render upload.
                let stitch = LocalStitch(
                    id: stitchId,
                    title: chosenTitle.isEmpty ? "Untitled stitch" : chosenTitle,
                    layoutKey: layoutKey,
                    durationS: durationS,
                    localFilename: filename,
                    serverCompositionId: existingCompositionId
                )
                LocalStitchStore.shared.add(stitch)

                // Stitch shipped — drop the in-progress draft so the next session starts fresh.
                StitchDraftStore.clear()
                self.timeline = StitchTimeline()
                self.title = ""
                // The render task is done; drop any leftover side-channel handles too.
                self.trackUploadTasks.removeAll()

                // From the user's perspective this is done. Surface success and dismiss.
                self.stage = .completed(stitchId.uuidString)

                // Fire-and-forget background upload of the FINAL rendered MP4. Failures
                // are silent; we retry on next launch.
                let uploader = self.uploader
                Task.detached { @Sendable in
                    await Self.uploadInBackground(
                        stitch: stitch,
                        localURL: destURL,
                        durationS: durationS,
                        layoutKey: layoutKey,
                        title: chosenTitle,
                        existingCompositionId: existingCompositionId,
                        api: api,
                        uploader: uploader
                    )
                }
            } catch is CancellationError {
                self.stage = .idle
            } catch {
                self.stage = .failed(error.localizedDescription)
            }
        }
    }

    /// Silent background upload: pushes the rendered MP4 to S3, attaches it to the
    /// server-side Composition (creating one only if the side-channel didn't already),
    /// records the composition id back into the LocalStitch. No UI is shown.
    private static func uploadInBackground(
        stitch: LocalStitch,
        localURL: URL,
        durationS: Double,
        layoutKey: String,
        title: String,
        existingCompositionId: String?,
        api: APIClient,
        uploader: VideoUploadService
    ) async {
        do {
            let upload = try await uploader.upload(
                fileURL: localURL,
                prefix: "stitch/\(stitch.id.uuidString)/",
                contentType: "video/mp4",
                deleteAfterUpload: false,
                progress: nil
            )
            let compositionId: String
            if let existingCompositionId {
                compositionId = existingCompositionId
            } else {
                // Fallback: side-channel never created one (eg. first clip-add raced a
                // network outage). Create now so the rendered output has somewhere to go.
                let composition = try await api.createComposition(
                    body: CreateCompositionRequest(
                        title: title.isEmpty ? nil : title,
                        mode: "stitch"
                    )
                )
                compositionId = composition.id
            }
            try await api.saveClientRender(
                compositionId: compositionId,
                body: ClientCompleteRenderRequest(
                    layout: layoutKey,
                    s3Key: upload.s3Key,
                    s3Url: upload.s3Url,
                    durationMs: Int(durationS * 1000)
                )
            )
            await MainActor.run {
                var updated = stitch
                updated.serverCompositionId = compositionId
                LocalStitchStore.shared.update(updated)
            }
        } catch {
            // Silent failure — the LocalStitch remains in `pendingUploads` and will be retried
            // on the next app launch by whatever surface owns the retry loop.
        }
    }

    public func cancel() {
        currentRenderTask?.cancel()
        currentRenderTask = nil
        stage = .idle
    }

    // MARK: - Test-only hooks
    //
    // These thin wrappers expose the side-channel internals to the unit-test bundle.
    // They're `internal` (default access) so they're only callable from this module
    // via `@testable import ClipfireiOS` — not part of the public API.

    func ensureServerCompositionForTesting() async -> String? {
        await ensureServerComposition()
    }

    func startServerTrackUploadForTesting(clipId: UUID, localURL: URL, durationS: Double) {
        startServerTrackUpload(clipId: clipId, localURL: localURL, durationS: durationS)
    }

    func awaitPendingTrackUploadsForTesting() async {
        let tasks = Array(trackUploadTasks.values)
        for task in tasks {
            await task.value
        }
    }
}

// MARK: - Root view (step 1: Clips)

public struct StitchEditorView: View {
    @StateObject private var viewModel: StitchEditorViewModel
    @State private var path = NavigationPath()
    @Environment(\.dismiss) private var dismiss
    @State private var showClipPicker = false
    @State private var showErrorAlert = false

    public init(api: APIClient) {
        _viewModel = StateObject(wrappedValue: StitchEditorViewModel(api: api))
    }

    public var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    StepHeader(current: 1, total: 3, label: "Select Clips")
                    clipsCard
                    nextButton(
                        label: "Next: Text Overlays",
                        enabled: !viewModel.timeline.clips.isEmpty
                    ) {
                        path.append(StitchStep.text)
                    }
                }
                .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("New Stitch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .navigationDestination(for: StitchStep.self) { step in
                switch step {
                case .text:
                    StitchTextStepView(viewModel: viewModel) {
                        path.append(StitchStep.cutout)
                    }
                case .cutout:
                    StitchCutoutStepView(viewModel: viewModel)
                case .myStitches:
                    MyStitchesView(api: viewModel.apiClient)
                }
            }
            .sheet(isPresented: $showClipPicker) {
                StitchClipPicker(maxSelectionCount: 0) { providers in
                    showClipPicker = false
                    Task { await viewModel.addClips(from: providers) }
                }
                .ignoresSafeArea()
            }
            .onChange(of: viewModel.stage) { _, stage in
                if case .failed = stage { showErrorAlert = true }
                if case .completed = stage {
                    // Replace the entire wizard stack with the My Stitches view so the user
                    // can see their freshly rendered stitch (and any previous ones) without
                    // dismissing the sheet.
                    path = NavigationPath([StitchStep.myStitches])
                }
            }
            .alert("Something went wrong", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.stage = .idle }
            } message: {
                if case .failed(let m) = viewModel.stage { Text(m) }
            }
        }
    }

    private var clipsCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Clips").font(.headline).foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Button {
                    showClipPicker = true
                } label: {
                    Label("Add", systemImage: "plus.circle.fill")
                        .foregroundStyle(DesignTokens.accent)
                }
            }

            let pending = viewModel.timeline.pendingClipCount
            let hasContent = !viewModel.timeline.clips.isEmpty || pending > 0
            if !hasContent {
                Text("Pick videos from Photos in the order you want them to play.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 80), spacing: 6)],
                    spacing: 6
                ) {
                    ForEach(Array(viewModel.timeline.clips.enumerated()), id: \.element.id) { index, clip in
                        ClipThumbCell(
                            order: index + 1,
                            clip: clip,
                            cachedPreview: viewModel.timeline.previewImages[clip.id],
                            onRemove: { viewModel.removeClip(id: clip.id) }
                        )
                    }
                    ForEach(0..<pending, id: \.self) { offset in
                        PendingClipCell(order: viewModel.timeline.clips.count + offset + 1)
                    }
                }
                if !viewModel.timeline.clips.isEmpty {
                    Text("Total: \(formatDuration(viewModel.timeline.totalDurationS))")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                        .padding(.top, 4)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}

// MARK: - Step 2: Text Overlays (per clip)

private struct StitchTextStepView: View {
    @ObservedObject var viewModel: StitchEditorViewModel
    let onNext: () -> Void
    @State private var addingTextForClipId: UUID?
    @State private var editingOverlayId: UUID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                StepHeader(current: 2, total: 3, label: "Text Overlays")
                Text("Tap a clip's Text button to add an overlay. Tap an existing chip to drag/pinch its position and size like Instagram. This step is optional.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)

                VStack(spacing: DesignTokens.spacing) {
                    ForEach(Array(viewModel.timeline.clips.enumerated()), id: \.element.id) { index, clip in
                        ClipOverlayRow(
                            order: index + 1,
                            clip: clip,
                            cachedPreview: viewModel.timeline.previewImages[clip.id],
                            overlays: viewModel.timeline.textOverlays.filter { $0.clipId == clip.id },
                            onAddText: { addingTextForClipId = clip.id },
                            onEditOverlay: { id in editingOverlayId = id },
                            onRemoveOverlay: { id in viewModel.timeline.removeTextOverlay(id: id) }
                        )
                    }
                }

                nextButton(label: "Next: Cutout", enabled: true, action: onNext)
            }
            .padding()
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Text Overlays")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: Binding(
            get: { addingTextForClipId.map { ClipIdWrapper(id: $0) } },
            set: { addingTextForClipId = $0?.id }
        )) { wrapper in
            AddTextOverlaySheet(clipId: wrapper.id) { overlay in
                viewModel.timeline.addTextOverlay(overlay)
                addingTextForClipId = nil
                // After adding, immediately open the positioning editor (Instagram pattern).
                editingOverlayId = overlay.id
            }
        }
        .fullScreenCover(item: Binding(
            get: { editingOverlayId.map { ClipIdWrapper(id: $0) } },
            set: { editingOverlayId = $0?.id }
        )) { wrapper in
            if let overlay = viewModel.timeline.textOverlays.first(where: { $0.id == wrapper.id }),
               let clip = viewModel.timeline.clips.first(where: { $0.id == overlay.clipId }) {
                TextOverlayEditorView(
                    clip: clip,
                    cachedPreview: viewModel.timeline.previewImages[clip.id],
                    layout: viewModel.timeline.layout,
                    overlay: Binding(
                        get: {
                            viewModel.timeline.textOverlays.first(where: { $0.id == wrapper.id }) ?? overlay
                        },
                        set: { newValue in
                            viewModel.timeline.updateTextOverlay(newValue)
                        }
                    )
                )
            }
        }
    }
}

private struct ClipIdWrapper: Identifiable {
    let id: UUID
}

private struct ClipOverlayRow: View {
    let order: Int
    let clip: StitchClip
    let cachedPreview: UIImage?
    let overlays: [TextOverlay]
    let onAddText: () -> Void
    let onEditOverlay: (UUID) -> Void
    let onRemoveOverlay: (UUID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            HStack(spacing: DesignTokens.spacing) {
                StitchThumbnail(clip: clip, cachedPreview: cachedPreview)
                    .cornerRadius(8)
                    .frame(width: 80, height: 80)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Clip \(order)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text(formatDuration(clip.effectiveDurationS))
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
                Spacer()
                Button {
                    onAddText()
                } label: {
                    Label("Text", systemImage: "textformat")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(DesignTokens.accent)
                }
            }

            if !overlays.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(overlays) { overlay in
                        Button {
                            onEditOverlay(overlay.id)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: overlay.hasBackground ? "textformat.alt" : "textformat")
                                    .foregroundStyle(DesignTokens.muted)
                                    .font(.caption)
                                Text(overlay.text)
                                    .font(.caption)
                                    .foregroundStyle(DesignTokens.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
                                    .font(.caption2)
                                    .foregroundStyle(DesignTokens.muted)
                                Button {
                                    onRemoveOverlay(overlay.id)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.red)
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(DesignTokens.background)
                            .cornerRadius(6)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 88)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}

private struct AddTextOverlaySheet: View {
    let clipId: UUID
    let onAdd: (TextOverlay) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String = ""
    @State private var withBackground: Bool = true
    @State private var backgroundColor: Color = .black.opacity(0.6)
    @State private var textColor: Color = .white

    var body: some View {
        NavigationStack {
            Form {
                Section("Text") {
                    TextField("Type your overlay text", text: $text, axis: .vertical)
                        .lineLimit(1...4)
                }
                Section("Colors") {
                    ColorPicker("Text color", selection: $textColor, supportsOpacity: true)
                    Toggle("Show background", isOn: $withBackground)
                    if withBackground {
                        ColorPicker("Background color", selection: $backgroundColor, supportsOpacity: true)
                    }
                }
                Section("Preview") {
                    HStack {
                        Spacer()
                        Text(text.isEmpty ? "Sample text" : text)
                            .font(.headline)
                            .foregroundStyle(textColor)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(withBackground ? backgroundColor : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Spacer()
                    }
                    .frame(minHeight: 60)
                    .listRowBackground(Color.black.opacity(0.8))
                }
            }
            .navigationTitle("Add Text")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        onAdd(TextOverlay(
                            clipId: clipId,
                            text: trimmed,
                            backgroundColor: withBackground ? backgroundColor : nil,
                            textColor: textColor
                        ))
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

// MARK: - Step 3: Cutout + Title + Render

private struct StitchCutoutStepView: View {
    @ObservedObject var viewModel: StitchEditorViewModel
    @State private var cutoutPickerItem: PhotosPickerItem?
    @State private var pickingForClipId: UUID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                StepHeader(current: 3, total: 3, label: "Cutout + Render")
                Text("Optionally overlay a person-cutout (background removed) on top of one clip. Then set a title and render.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)

                cutoutCard
                titleCard
                renderCard
            }
            .padding()
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Cutout + Render")
        .navigationBarTitleDisplayMode(.inline)
        .photosPicker(
            isPresented: Binding(
                get: { pickingForClipId != nil },
                set: { if !$0 { pickingForClipId = nil } }
            ),
            selection: $cutoutPickerItem,
            matching: .videos,
            photoLibrary: .shared()
        )
        .onChange(of: cutoutPickerItem) { _, item in
            guard let item, let clipId = pickingForClipId else { return }
            cutoutPickerItem = nil
            pickingForClipId = nil
            Task { await viewModel.setCutoutSource(from: item, clipId: clipId) }
        }
    }

    private var cutoutCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Cutout Overlay").font(.headline).foregroundStyle(DesignTokens.textPrimary)

            if let cutout = viewModel.timeline.cutoutOverlay,
               let clip = viewModel.timeline.clips.first(where: { $0.id == cutout.clipId }),
               let clipIndex = viewModel.timeline.clips.firstIndex(where: { $0.id == cutout.clipId }) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: DesignTokens.spacing) {
                        StitchThumbnail(sourceURL: cutout.sourceURL)
                            .cornerRadius(8)
                            .frame(width: 80, height: 80)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Over Clip \(clipIndex + 1)")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text(formatDuration(clip.effectiveDurationS))
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            viewModel.timeline.setCutout(nil)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.red)
                                .font(.title3)
                        }
                        .buttonStyle(.plain)
                    }

                    HStack {
                        Text("Scale")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                        Slider(
                            value: Binding(
                                get: { Double(cutout.scale) },
                                set: { newValue in
                                    var c = cutout
                                    c.scale = CGFloat(newValue)
                                    viewModel.timeline.updateCutout(c)
                                }
                            ),
                            in: 0.2...1.0
                        )
                    }
                }
            } else {
                Text("Pick which clip to overlay onto:")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 80), spacing: 6)],
                    spacing: 6
                ) {
                    ForEach(Array(viewModel.timeline.clips.enumerated()), id: \.element.id) { index, clip in
                        Button {
                            pickingForClipId = clip.id
                        } label: {
                            StitchThumbnail(clip: clip)
                                .cornerRadius(8)
                                .overlay(alignment: .topLeading) {
                                    Text("\(index + 1)")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Color.black.opacity(0.7))
                                        .clipShape(Capsule())
                                        .padding(4)
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("Skip this step if you don't want a cutout overlay.")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var titleCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Title").font(.headline).foregroundStyle(DesignTokens.textPrimary)
            TextField("Optional title", text: $viewModel.title)
                .textFieldStyle(.roundedBorder)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var renderCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            switch viewModel.stage {
            case .idle:
                Button {
                    viewModel.render()
                } label: {
                    Text("Render Stitch")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(viewModel.timeline.canRender ? DesignTokens.accent : DesignTokens.muted)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
                .disabled(!viewModel.timeline.canRender)
                .buttonStyle(.plain)
            case .failed(let message):
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text("Render failed: \(message)")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(10)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(8)
                    Button {
                        viewModel.render()
                    } label: {
                        Text("Try again")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(DesignTokens.accent)
                            .cornerRadius(DesignTokens.cornerRadius)
                    }
                    .buttonStyle(.plain)
                }
            case .loading:
                ProgressLine(label: "Loading…", progress: nil)
            case .rendering(let f):
                ProgressLine(label: "Rendering on device…", progress: f)
                Button(role: .destructive) { viewModel.cancel() } label: {
                    Text("Cancel").foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            case .uploading(let f):
                ProgressLine(label: "Uploading…", progress: f)
            case .saving:
                ProgressLine(label: "Saving…", progress: nil)
            case .completed:
                Label("Saved to your library", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}

// MARK: - Step header / Next button

private struct StepHeader: View {
    let current: Int
    let total: Int
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Step \(current) of \(total)")
                .font(.caption.weight(.medium))
                .foregroundStyle(DesignTokens.muted)
            Text(label)
                .font(.title3.weight(.semibold))
                .foregroundStyle(DesignTokens.textPrimary)
        }
    }
}

private func nextButton(label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button {
        action()
    } label: {
        HStack {
            Text(label)
                .font(.headline)
            Image(systemName: "arrow.right")
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(enabled ? DesignTokens.accent : DesignTokens.muted)
        .cornerRadius(DesignTokens.cornerRadius)
    }
    .disabled(!enabled)
    .buttonStyle(.plain)
}

// MARK: - Clip thumbnail cell

/// Square thumbnail. Prefers `PHImageManager` (fast, uses Photos' cached thumbnails) when
/// a `photoIdentifier` is provided; falls back to `AVAssetImageGenerator` on a sandbox
/// file URL otherwise.
struct StitchThumbnail: View {
    let sourceURL: URL?
    let photoIdentifier: String?
    let cachedPreview: UIImage?
    @State private var image: UIImage?

    init(clip: StitchClip, cachedPreview: UIImage? = nil) {
        self.sourceURL = clip.sourceURL
        self.photoIdentifier = clip.photoAssetIdentifier
        self.cachedPreview = cachedPreview
    }

    init(sourceURL: URL?, photoIdentifier: String? = nil) {
        self.sourceURL = sourceURL
        self.photoIdentifier = photoIdentifier
        self.cachedPreview = nil
    }

    private var displayedImage: UIImage? { cachedPreview ?? image }

    var body: some View {
        ZStack {
            Color.black
            if let img = displayedImage {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
            } else {
                ProgressView().tint(DesignTokens.muted)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipped()
        .task(id: photoIdentifier) {
            if displayedImage == nil { await loadThumbnail() }
        }
        .task(id: sourceURL) {
            if displayedImage == nil { await loadThumbnail() }
        }
    }

    private func loadThumbnail() async {
        // Guard Photos APIs on explicit auth status. Without this guard, calling
        // PHAsset/PHImageManager when auth is missing has been correlated with crashes
        // on iOS 26.5. With auth granted, we get instant cached thumbnails.
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        let mayUsePhotos = (status == .authorized || status == .limited)

        if mayUsePhotos, let id = photoIdentifier {
            let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
            if let asset = fetch.firstObject {
                let options = PHImageRequestOptions()
                options.deliveryMode = .opportunistic
                options.isNetworkAccessAllowed = true
                options.resizeMode = .fast
                let img: UIImage? = await withCheckedContinuation { continuation in
                    PHImageManager.default().requestImage(
                        for: asset,
                        targetSize: CGSize(width: 360, height: 360),
                        contentMode: .aspectFill,
                        options: options
                    ) { image, _ in
                        continuation.resume(returning: image)
                    }
                }
                if let img {
                    await MainActor.run { self.image = img }
                    return
                }
            }
        }

        guard let url = sourceURL else { return }
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 360, height: 360)
        let time = CMTime(seconds: 0.1, preferredTimescale: 600)
        do {
            let (cg, _) = try await generator.image(at: time)
            await MainActor.run { self.image = UIImage(cgImage: cg) }
        } catch {
            // leave placeholder
        }
    }
}

/// Placeholder shown while a picked clip is still being copied out of Photos.
private struct PendingClipCell: View {
    let order: Int

    var body: some View {
        ZStack {
            Color.black.opacity(0.6)
            VStack(spacing: 6) {
                ProgressView().tint(.white)
                Text("Loading")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.8))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .cornerRadius(8)
        .overlay(alignment: .topLeading) {
            Text("\(order)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.black.opacity(0.7))
                .clipShape(Capsule())
                .padding(4)
        }
    }
}

private struct ClipThumbCell: View {
    let order: Int
    let clip: StitchClip
    let cachedPreview: UIImage?
    let onRemove: () -> Void

    var body: some View {
        StitchThumbnail(clip: clip, cachedPreview: cachedPreview)
            .cornerRadius(8)
            .overlay(alignment: .topLeading) {
                Text("\(order)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.black.opacity(0.7))
                    .clipShape(Capsule())
                    .padding(4)
            }
            .overlay(alignment: .topTrailing) {
                Button {
                    onRemove()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.7))
                }
                .buttonStyle(.plain)
                .padding(4)
            }
            .overlay(alignment: .bottomTrailing) {
                if clip.effectiveDurationS > 0 {
                    Text(formatDuration(clip.effectiveDurationS))
                        .font(.caption2)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.black.opacity(0.7))
                        .clipShape(Capsule())
                        .padding(4)
                }
            }
    }
}

// MARK: - Helpers

private struct ProgressLine: View {
    let label: String
    let progress: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if let progress {
                    Text("\(Int(progress * 100))%")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
            if let progress {
                ProgressView(value: progress)
            } else {
                ProgressView()
            }
        }
    }
}

private func formatDuration(_ s: Double) -> String {
    let total = Int(s.rounded())
    let m = total / 60
    let sec = total % 60
    return String(format: "%d:%02d", m, sec)
}
