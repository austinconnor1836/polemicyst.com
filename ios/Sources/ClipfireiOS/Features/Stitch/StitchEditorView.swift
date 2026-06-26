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

    /// Fired the moment a render is queued (LocalStitch inserted into the store
    /// with `.uploadingClips(progress: 0)`). The parent presenter uses this to
    /// dismiss the editor sheet and switch to the Stitches tab — the render
    /// itself keeps running in the background.
    public var onRenderDispatched: (() -> Void)?

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

        // Restore an in-progress draft, if any. Editor stays fully local — no eager
        // server upload on restore. Raw clips only hit S3 at render/publish time.
        if let draft = StitchDraftStore.load() {
            timeline.applyDraft(draft)
            title = draft.title
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
        //    In freezeReveal mode the second clip (the "creator" slot) defaults to
        //    background-removed on so the preset works without any extra taps. The
        //    reference clip defaults to off (its full frame is the backdrop).
        let existingClipCount = timeline.clips.count
        let isFreezeReveal = timeline.style == .freezeReveal
        for (offset, clipId) in clipIds.enumerated() {
            let finalIndex = existingClipCount + offset
            let bgOnByDefault = isFreezeReveal && finalIndex == 1
            timeline.addClip(StitchClip(
                id: clipId,
                sourceURL: nil,
                photoAssetIdentifier: nil,
                durationS: 0,
                removeBackground: bgOnByDefault
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

    /// Loads the underlying file (sets the clip's `sourceURL` + `durationS`) for one
    /// picked item. Local-only: the file is copied into the draft directory and that's
    /// it. The raw clip is NOT uploaded to the server here — that only happens at
    /// render/publish time, so editing stays offline and instant.
    ///
    /// No preview-image loading: the Step 1 grid uses a static placeholder cell so the
    /// user can move to Step 2 the moment they tap a clip. Steps 2 and 3 lazy-load their
    /// own thumbnails via `StitchThumbnail` when those views appear.
    private func loadFromProvider(clipId: UUID, provider: NSItemProvider) async {
        let result = await ItemProviderLoader.loadMovieFile(provider)
        switch result {
        case .failure(let error):
            // Drop the skeleton cell and surface why. Common cause for long videos:
            // the file lives in iCloud and Photos times out the download.
            timeline.removeClip(id: clipId)
            timeline.previewImages.removeValue(forKey: clipId)
            stage = .failed(error.localizedDescription)
            // POST to local Mac so Claude can see exactly which UTI / load API failed.
            StitchRemoteLogger.log("clip-load-failed", payload: [
                "clipId": clipId.uuidString,
                "registeredTypes": provider.registeredTypeIdentifiers,
                "message": error.localizedDescription,
                "error": StitchRemoteLogger.flatten(error),
            ])
        case .success(let url):
            let avAsset = AVURLAsset(url: url)
            let durationS = (try? await avAsset.load(.duration)).map { CMTimeGetSeconds($0) } ?? 0
            timeline.updateClipSourceURL(id: clipId, url: url)
            timeline.updateClipDuration(id: clipId, durationS: durationS)
            // In freezeReveal mode, eagerly seed the cutout the moment the creator
            // clip's file is ready — this lets the user tap Render straight from
            // Step 1 / Step 2 without ever opening Step 3 and still get a sensible
            // centered default. The manifest builder otherwise throws code=2.
            ensureFreezeRevealCutout()
        }
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

    // MARK: Style switching + auto-seeding

    /// Switches the composition style. When moving to `.freezeReveal`, drops any clips
    /// past the second so the wizard's 2-slot UI matches state. Doesn't auto-seed the
    /// text overlay or the cutout — those happen lazily as the user reaches steps 2 and 3.
    public func setStyle(_ newStyle: StitchStyle) {
        guard timeline.style != newStyle else { return }
        timeline.style = newStyle
        if newStyle == .freezeReveal && timeline.clips.count > 2 {
            // Snapshot ids first — removeClip mutates `timeline.clips`, so iterating
            // a slice of it while removing would be undefined.
            let extraIds = timeline.clips.dropFirst(2).map(\.id)
            for id in extraIds {
                removeClip(id: id)
            }
        }
        // If the user already has the two clips with sourceURLs loaded, seed the
        // cutout right now so Render works without ever opening Step 3.
        if newStyle == .freezeReveal {
            ensureFreezeRevealCutout()
        }
    }

    /// Lazily seed the "STITCH INCOMING" text overlay on the reference clip the first time
    /// the user reaches the text step in `.freezeReveal` mode. Idempotent — if the user has
    /// already deleted the auto-seeded overlay (or replaced its text), do nothing.
    public func ensureFreezeRevealTextOverlay() {
        guard timeline.style == .freezeReveal,
              let referenceClip = timeline.clips.first else { return }
        let alreadyHasOverlay = timeline.textOverlays.contains { $0.clipId == referenceClip.id }
        if alreadyHasOverlay { return }
        let overlay = TextOverlay(
            clipId: referenceClip.id,
            text: "STITCH INCOMING",
            backgroundColor: Color.black.opacity(0.75),
            textColor: .white,
            fontSize: 96,
            position: CGPoint(x: 0.5, y: 0.18)
        )
        timeline.addTextOverlay(overlay)
    }

    /// Eagerly seed the cutout for freezeReveal mode the moment both clips' files are
    /// loaded. The cutout points to the reference clip (so removal cascades correctly
    /// via the existing logic) and uses the creator clip's video file as the segmented
    /// source. Idempotent — once a cutout exists (auto-seeded or user-positioned) this
    /// is a no-op.
    ///
    /// The default `(0.5, 0.5)` position + `0.6` scale gives the creator a visually-
    /// centered presentation that's the focal point but still leaves the frozen ref
    /// frame readable around the edges. Step 3 lets the user fine-tune, but Render
    /// works without ever opening Step 3 — previously the manifest builder threw
    /// `freezeRevealMissingCutout` (code=2) when Render was tapped without a cutout.
    public func ensureFreezeRevealCutout() {
        guard timeline.style == .freezeReveal,
              timeline.clips.count >= 2,
              let referenceClip = timeline.clips.first,
              let creatorClip = timeline.clips.dropFirst().first,
              let creatorURL = creatorClip.sourceURL else { return }
        if timeline.cutoutOverlay != nil { return }
        timeline.setCutout(CutoutOverlay(
            clipId: referenceClip.id,
            sourceURL: creatorURL,
            sourceDurationS: creatorClip.effectiveDurationS,
            position: CGPoint(x: 0.5, y: 0.5),
            scale: 0.6
        ))
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

    /// Fire-and-forget render dispatch.
    ///
    /// The editor returns control to the caller in milliseconds — a placeholder
    /// `LocalStitch` is inserted into the store with `.uploadingClips(progress: 0)`,
    /// the editor's `onRenderDispatched` closure fires (the parent uses it to
    /// dismiss + switch tabs), and the upload → POST manifest → server-poll →
    /// download → transcript-wait → generate-meta chain runs in a detached
    /// background task that mutates the stitch's `processingState` as it
    /// progresses.
    public func render() {
        currentRenderTask?.cancel()
        let chosenTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let api = self.api
        let uploader = self.uploader

        // STEP 1 (synchronous from the UI's POV): seed a placeholder stitch in
        // the store and dismiss the editor. We need the snapshot — and that
        // needs the in-flight clip copies finished — so we still await
        // briefly. The vast majority of the time those tasks are already done
        // by the time the user makes it to the render step.
        Task { [weak self] in
            guard let self else { return }
            await self.waitForPendingFileLoads()
            let snap = self.timeline.snapshot()
            guard !snap.clips.isEmpty else {
                self.stage = .failed("No clips to render")
                return
            }
            let existingCompositionId = self.timeline.serverCompositionId
            let durationS = snap.clips.reduce(0) { $0 + $1.effectiveDurationS }
            let layoutKey = snap.layout == .mobile ? "mobile" : "landscape"

            let stitchId = UUID()
            let filename = "\(stitchId.uuidString).mp4"
            let stitchesDir = LocalStitchStore.stitchesDir
            try? FileManager.default.createDirectory(
                at: stitchesDir,
                withIntermediateDirectories: true
            )
            let destURL = stitchesDir.appendingPathComponent(filename)

            let stitch = LocalStitch(
                id: stitchId,
                title: chosenTitle.isEmpty ? "Untitled stitch" : chosenTitle,
                caption: nil,
                layoutKey: layoutKey,
                durationS: durationS,
                localFilename: filename,
                serverCompositionId: existingCompositionId,
                processingState: .uploadingClips(progress: 0)
            )
            LocalStitchStore.shared.add(stitch)

            // Reset editor + dismiss BEFORE the heavy work kicks off. Crucial: clear ONLY
            // the JSON manifest here — the detached renderer below still holds URLs to the
            // clip files via its snapshot. Deleting them now causes -11800/-17913 at export
            // time (the snapshot's URLs point at vanished files). Files are removed in
            // runRenderPipeline once Phase 1 reads them.
            StitchDraftStore.clearManifestOnly()
            self.timeline = StitchTimeline()
            self.title = ""
            self.trackUploadTasks.removeAll()
            self.stage = .completed(stitchId.uuidString)
            self.onRenderDispatched?()

            // STEP 2: heavy lifting in a detached background task. The editor
            // is gone at this point; all UI updates happen via the store
            // mutating `processingState` on the LocalStitch row in
            // MyStitchesView.
            self.currentRenderTask = Task.detached { @Sendable in
                await Self.runRenderPipeline(
                    stitchId: stitchId,
                    snapshot: snap,
                    destURL: destURL,
                    durationS: durationS,
                    layoutKey: layoutKey,
                    chosenTitle: chosenTitle,
                    existingCompositionId: existingCompositionId,
                    api: api,
                    uploader: uploader
                )
            }
        }
    }

    /// The full post-dispatch pipeline. Lives on the type (not the instance)
    /// because the editor view-model is gone by the time most of these phases
    /// run. Every phase boundary updates the store on the main actor.
    ///
    /// Server-side render flow:
    ///   A. Ensure server `Composition` exists, then upload every clip to S3
    ///      and POST `/api/compositions/<id>/tracks` for each → `.uploadingClips`.
    ///   B. Build a `StitchManifest` and POST `/api/compositions/<id>/stitch-render`
    ///      → `.queued`.
    ///   C. Poll `GET /api/compositions/<id>` every 5s until the layout's
    ///      `CompositionOutput.status` lands on `completed` or `failed` →
    ///      `.renderingOnServer`.
    ///   D. Download the output S3 MP4 to `destURL` so the local play card
    ///      works unchanged.
    ///   E. Wait briefly for transcripts on any audio-bearing track (needed for
    ///      AI Suggest copy quality).
    ///   F. Call generate-meta to seed title + caption → `.ready`.
    private static func runRenderPipeline(
        stitchId: UUID,
        snapshot: StitchTimelineSnapshot,
        destURL: URL,
        durationS: Double,
        layoutKey: String,
        chosenTitle: String,
        existingCompositionId: String?,
        api: APIClient,
        uploader: VideoUploadService
    ) async {
        // Memory-warning observer — kept from the old local-render flow because the
        // multipart upload can OOM on extremely long source files. Worth knowing
        // about in the logs even though we no longer composite locally.
        let memWarningObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: nil
        ) { _ in
            StitchRemoteLogger.log("render-phase", payload: [
                "phase": "memory-warning",
                "stitchId": stitchId.uuidString,
            ])
        }
        defer { NotificationCenter.default.removeObserver(memWarningObserver) }

        // PHASE A — ensure composition + upload every clip as a CompositionTrack.
        StitchRemoteLogger.log("render-phase", payload: [
            "phase": "phase-a-start",
            "stitchId": stitchId.uuidString,
            "clipCount": snapshot.clips.count,
        ])
        await MainActor.run {
            LocalStitchStore.shared.setProcessingState(id: stitchId, .uploadingClips(progress: 0))
        }

        // Ensure we have a server composition before any uploads. If the timeline
        // already has one (e.g. the editor was reopened on an existing draft) we
        // reuse it; otherwise we POST /api/compositions now.
        let compositionId: String
        do {
            if let existingCompositionId {
                compositionId = existingCompositionId
            } else {
                let composition = try await api.createComposition(
                    body: CreateCompositionRequest(
                        title: chosenTitle.isEmpty ? nil : chosenTitle,
                        mode: "stitch"
                    )
                )
                compositionId = composition.id
            }
            await MainActor.run {
                LocalStitchStore.shared.setServerCompositionId(id: stitchId, compositionId: compositionId)
            }
        } catch {
            await failPipeline(stitchId: stitchId, phase: "phase-a-create-composition", error: error)
            return
        }

        // For every clip, ensure a server track id. Clips picked in this session
        // start with sourceURL set and serverTrackId nil — we upload them here.
        // Clips that were re-loaded from a draft might already have a serverTrackId
        // set (from the previous build's eager upload path), in which case we trust
        // it and skip the upload. Track IDs are accumulated into a map that's then
        // fed to the manifest builder.
        var trackIdForClip: [UUID: String] = [:]
        let totalClips = max(1, snapshot.clips.count)
        var completedClips = 0
        for clip in snapshot.clips {
            if let existing = clip.serverTrackId, !existing.isEmpty {
                trackIdForClip[clip.id] = existing
                completedClips += 1
                await MainActor.run {
                    LocalStitchStore.shared.setProcessingState(
                        id: stitchId,
                        .uploadingClips(progress: Double(completedClips) / Double(totalClips))
                    )
                }
                continue
            }
            guard let sourceURL = clip.sourceURL else {
                await failPipeline(
                    stitchId: stitchId,
                    phase: "phase-a-missing-source",
                    error: StitchRenderError.exportFailed("A clip never finished copying — try again.")
                )
                return
            }

            do {
                let upload = try await uploader.upload(
                    fileURL: sourceURL,
                    prefix: "compositions/\(compositionId)/raw/",
                    contentType: "video/mp4",
                    deleteAfterUpload: false,
                    progress: nil
                )
                let (width, height, hasAudio) = await Self.probeLocalAssetForRender(url: sourceURL)
                let track = try await api.addTrack(
                    compositionId: compositionId,
                    body: CreateTrackRequest(
                        s3Key: upload.s3Key,
                        s3Url: upload.s3Url,
                        durationS: clip.durationS,
                        label: nil,
                        width: width,
                        height: height,
                        hasAudio: hasAudio,
                        trackType: "reference"
                    )
                )
                trackIdForClip[clip.id] = track.id
                completedClips += 1
                await MainActor.run {
                    LocalStitchStore.shared.setProcessingState(
                        id: stitchId,
                        .uploadingClips(progress: Double(completedClips) / Double(totalClips))
                    )
                }
            } catch {
                await failPipeline(stitchId: stitchId, phase: "phase-a-upload-clip", error: error)
                return
            }
        }
        StitchRemoteLogger.log("render-phase", payload: [
            "phase": "phase-a-done",
            "stitchId": stitchId.uuidString,
            "uploadedClips": completedClips,
        ])

        // PHASE B — build manifest + POST /stitch-render.
        let manifest: StitchManifest
        do {
            manifest = try StitchManifestBuilder.build(
                snapshot: snapshot,
                trackIdForClip: trackIdForClip,
                title: chosenTitle.isEmpty ? nil : chosenTitle
            )
        } catch {
            await failPipeline(stitchId: stitchId, phase: "phase-b-build-manifest", error: error)
            return
        }
        StitchRemoteLogger.log("render-phase", payload: [
            "phase": "phase-b-post-start",
            "stitchId": stitchId.uuidString,
            "compositionId": compositionId,
            "layout": layoutKey,
        ])
        do {
            _ = try await api.startStitchRender(
                compositionId: compositionId,
                manifest: manifest
            )
        } catch {
            await failPipeline(stitchId: stitchId, phase: "phase-b-post-start", error: error)
            return
        }
        await MainActor.run {
            LocalStitchStore.shared.setProcessingState(id: stitchId, .queued)
        }

        // PHASE C — poll until the layout's CompositionOutput resolves. Reuses the
        // shared poll helper so MyStitchesView can rejoin after a foreground.
        let pollOutcome = await Self.pollForServerRender(
            compositionId: compositionId,
            layoutKey: layoutKey,
            stitchId: stitchId,
            api: api
        )
        switch pollOutcome {
        case .failed(let message):
            await MainActor.run {
                LocalStitchStore.shared.setProcessingState(id: stitchId, .failed(message))
            }
            StitchRemoteLogger.log("render-failed", payload: [
                "stitchId": stitchId.uuidString,
                "phase": "phase-c-poll",
                "message": message,
            ])
            return
        case .timedOut:
            await MainActor.run {
                LocalStitchStore.shared.setProcessingState(
                    id: stitchId,
                    .failed("Server render didn't finish in time — check Stitches later")
                )
            }
            return
        case .cancelled:
            return
        case .completed(let output):
            // Persist the S3 URL even before the download, so a crash during the
            // download still leaves us able to retry from the URL.
            if let url = output.s3Url {
                await MainActor.run {
                    LocalStitchStore.shared.setOutputS3Url(id: stitchId, url: url)
                }
            }

            // PHASE D — download the rendered MP4 into the local stitches dir so
            // the existing play card / publish flow works without code changes.
            if let s3UrlString = output.s3Url, let s3URL = URL(string: s3UrlString) {
                do {
                    try await Self.downloadOutput(from: s3URL, to: destURL, api: api)
                } catch {
                    await failPipeline(stitchId: stitchId, phase: "phase-d-download", error: error)
                    return
                }
            } else {
                await failPipeline(
                    stitchId: stitchId,
                    phase: "phase-d-no-url",
                    error: StitchRenderError.exportFailed("Server output is missing its S3 URL")
                )
                return
            }

            // Now safe to drop source clip files — the server has its copies and the
            // result MP4 is local. Keep error swallowed; if files were already gone
            // (re-attached editor) the user doesn't care.
            let sourceURLs = snapshot.clips.compactMap(\.sourceURL)
            StitchDraftStore.removeFiles(urls: sourceURLs)
            StitchRemoteLogger.log("render-succeeded", payload: [
                "stitchId": stitchId.uuidString,
                "durationS": durationS,
                "style": snapshot.style.rawValue,
                "clipCount": snapshot.clips.count,
                "textOverlayCount": snapshot.textOverlays.count,
                "compositionId": compositionId,
            ])
        }

        // PHASE E — wait for transcripts so generate-meta has context.
        StitchRemoteLogger.log("render-phase", payload: [
            "phase": "phase-e-transcripts-start", "stitchId": stitchId.uuidString,
        ])
        await Self.waitForTranscripts(compositionId: compositionId, api: api)
        StitchRemoteLogger.log("render-phase", payload: [
            "phase": "phase-e-transcripts-done", "stitchId": stitchId.uuidString,
        ])

        // PHASE F — generate-meta. Errors here are not terminal-fatal because the
        // user can re-run AI Suggest later; we mark ready with the placeholder
        // title and surface a retry via the StitchCard.
        do {
            let response = try await VideoPublishSheet.generateMeta(
                api: api,
                kind: .stitch,
                seedTitle: chosenTitle,
                seedCaption: "",
                serverCompositionId: compositionId,
                platforms: ["youtube", "instagram", "twitter", "bluesky", "tiktok"]
            )
            await MainActor.run {
                LocalStitchStore.shared.setTitleAndCaption(
                    id: stitchId,
                    title: response.title,
                    caption: response.caption
                )
            }
        } catch {
            StitchRemoteLogger.log("render-phase", payload: [
                "phase": "phase-f-generate-meta-failed",
                "stitchId": stitchId.uuidString,
                "error": StitchRemoteLogger.flatten(error),
            ])
            await MainActor.run {
                LocalStitchStore.shared.setProcessingState(
                    id: stitchId,
                    .failed("Couldn't generate copy — tap to retry")
                )
            }
        }
    }

    /// Probe a local video for width/height/hasAudio so the CompositionTrack row
    /// has accurate metadata. Duplicates the instance method so this static path
    /// doesn't need a live view-model.
    private static func probeLocalAssetForRender(url: URL) async -> (Int?, Int?, Bool?) {
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

    /// Result of one full server-render poll.
    enum ServerRenderOutcome {
        case completed(CompositionOutput)
        case failed(String)
        case timedOut
        case cancelled
    }

    /// Poll `GET /api/compositions/<id>` every 5s for up to 30 minutes until the
    /// composition's output for the requested layout resolves. Shared by both the
    /// in-flight pipeline (phase C) and `MyStitchesView`'s resume-on-foreground
    /// loop — pulling this out makes both callers use the exact same status logic.
    static func pollForServerRender(
        compositionId: String,
        layoutKey: String,
        stitchId: UUID,
        api: APIClient
    ) async -> ServerRenderOutcome {
        let deadline = Date().addingTimeInterval(30 * 60)
        var lastReportedRendering = false
        while Date() < deadline {
            if Task.isCancelled { return .cancelled }
            do {
                let composition = try await api.fetchComposition(id: compositionId)
                if let output = (composition.outputs ?? []).first(where: { $0.layout == layoutKey }) {
                    switch output.status {
                    case "completed":
                        return .completed(output)
                    case "failed":
                        let msg = output.renderError ?? "Server render failed"
                        return .failed(msg)
                    case "rendering":
                        if !lastReportedRendering {
                            await MainActor.run {
                                LocalStitchStore.shared.setProcessingState(
                                    id: stitchId,
                                    .renderingOnServer(progress: nil)
                                )
                            }
                            lastReportedRendering = true
                        }
                    case "pending":
                        // Worker hasn't picked up yet — keep state as .queued (set by caller).
                        break
                    default:
                        break
                    }
                }
            } catch {
                // Network blip — keep trying until the deadline.
            }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
        return .timedOut
    }

    /// Download the server-rendered MP4 to the local stitches directory. We hit
    /// the S3 URL directly — the server returns either a presigned URL or a
    /// public-bucket URL via the same field, and both stream the bytes fine
    /// without an auth header.
    static func downloadOutput(from url: URL, to destURL: URL, api: APIClient) async throws {
        // If the server returned a relative proxy URL (the upload path returns
        // these for raw track files), resolve it against the API base. The
        // CompositionOutput.s3Url today is a fully-qualified S3 URL, but the
        // fallback keeps us safe if that shape ever changes.
        let resolved: URL
        if url.scheme == nil {
            resolved = api.baseURL.appending(path: url.path)
        } else {
            resolved = url
        }
        var request = URLRequest(url: resolved)
        // Local dev: any localhost/LAN URL gets the auth token because the proxy
        // path needs it. Public S3 URLs ignore it. Safe either way.
        if let token = api.tokenStorage?.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (tempURL, response) = try await api.session.download(for: request)
        defer { try? FileManager.default.removeItem(at: tempURL) }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw StitchRenderError.exportFailed("Output download failed: HTTP \(http.statusCode)")
        }
        try? FileManager.default.removeItem(at: destURL)
        try FileManager.default.moveItem(at: tempURL, to: destURL)
    }

    /// Helper to turn an in-pipeline thrown error into a logged failure + a
    /// terminal `.failed` state on the row. Keeps the pipeline body skim-able.
    private static func failPipeline(stitchId: UUID, phase: String, error: Error) async {
        let msg = describeRenderError(error)
        NSLog("[Stitch] pipeline failed at %@: %@", phase, msg)
        StitchRemoteLogger.log("render-failed", payload: [
            "stitchId": stitchId.uuidString,
            "phase": phase,
            "message": msg,
            "error": StitchRemoteLogger.flatten(error),
        ])
        await MainActor.run {
            LocalStitchStore.shared.setProcessingState(id: stitchId, .failed(msg))
        }
    }

    /// Poll `/api/compositions/<id>` every 3s until every audio-bearing track
    /// has a non-empty transcript OR a 90s budget elapses. Best-effort —
    /// returns on timeout so the pipeline can still call generate-meta.
    private static func waitForTranscripts(compositionId: String, api: APIClient) async {
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            if Task.isCancelled { return }
            do {
                let composition = try await api.fetchComposition(id: compositionId)
                let audioTracks = (composition.tracks ?? []).filter { $0.hasAudio }
                let allReady = !audioTracks.isEmpty && audioTracks.allSatisfy { track in
                    if let segments = track.transcriptJson, !segments.isEmpty { return true }
                    return false
                }
                if allReady || audioTracks.isEmpty { return }
            } catch {
                // Network blip — keep trying until the deadline.
            }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
    }

    /// Pretty-print any render error so the user-visible alert names the actual failure
    /// instead of just "The operation could not be completed". `StitchRenderError` cases
    /// already carry their own message; raw NSErrors get domain + code + reason + underlying
    /// flattened into one line.
    private static func describeRenderError(_ error: Error) -> String {
        if let stitch = error as? StitchRenderError {
            return stitch.errorDescription ?? "\(stitch)"
        }
        let ns = error as NSError
        var parts: [String] = ["\(ns.domain) code=\(ns.code)"]
        if !ns.localizedDescription.isEmpty {
            parts.append(ns.localizedDescription)
        }
        if let reason = ns.localizedFailureReason, !reason.isEmpty {
            parts.append("reason: \(reason)")
        }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            parts.append("underlying: \(underlying.domain) code=\(underlying.code) — \(underlying.localizedDescription)")
        }
        return parts.joined(separator: " | ")
    }

    /// Re-run JUST the generate-meta step for a previously-failed stitch.
    /// Wired from `MyStitchesView`'s retry button. Static + standalone so the
    /// retry surface doesn't need a live editor view-model. Safe to call
    /// repeatedly.
    public static func retryGenerateMeta(stitchId: UUID, api: APIClient) {
        Task { @MainActor in
            guard let stitch = LocalStitchStore.shared.stitches.first(where: { $0.id == stitchId }),
                  let compositionId = stitch.serverCompositionId else { return }
            let chosenTitle = stitch.title
            // No dedicated "generating meta" state any more — we surface the same
            // indeterminate spinner used during server-side rendering, since from
            // the user's POV they're both "AI is doing something, please wait".
            LocalStitchStore.shared.setProcessingState(id: stitchId, .renderingOnServer(progress: nil))
            Task.detached { @Sendable in
                do {
                    let response = try await VideoPublishSheet.generateMeta(
                        api: api,
                        kind: .stitch,
                        seedTitle: chosenTitle,
                        seedCaption: "",
                        serverCompositionId: compositionId,
                        platforms: ["youtube", "instagram", "twitter", "bluesky", "tiktok"]
                    )
                    await MainActor.run {
                        LocalStitchStore.shared.setTitleAndCaption(
                            id: stitchId,
                            title: response.title,
                            caption: response.caption
                        )
                    }
                } catch {
                    await MainActor.run {
                        LocalStitchStore.shared.setProcessingState(
                            id: stitchId,
                            .failed("Couldn't generate copy — tap to retry")
                        )
                    }
                }
            }
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

    /// Optional dispatch hook — fires when the user taps "Render Stitch" and
    /// the placeholder LocalStitch has landed in the store. The parent uses it
    /// to dismiss this sheet and switch to the Stitches tab so the user sees
    /// the in-progress row right away (W025).
    private let onRenderDispatched: (() -> Void)?

    public init(api: APIClient, onRenderDispatched: (() -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: StitchEditorViewModel(api: api))
        self.onRenderDispatched = onRenderDispatched
    }

    public var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    StepHeader(current: 1, total: 3, label: "Select Clips")
                    styleCard
                    clipsCard
                    nextButton(
                        label: "Next: Text Overlays",
                        enabled: !viewModel.timeline.clips.isEmpty
                            && (viewModel.timeline.style != .freezeReveal
                                || viewModel.timeline.clips.count >= 2)
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
                    MyStitchesView(api: viewModel.apiClient, onRetry: { [api = viewModel.apiClient] stitchId in
                        StitchEditorViewModel.retryGenerateMeta(stitchId: stitchId, api: api)
                    })
                }
            }
            .sheet(isPresented: $showClipPicker) {
                // Cap selection to the remaining freeze-reveal slots so a multi-pick
                // can't blow past Reference + Creator. `0` = unlimited (PHPicker semantics).
                let remaining: Int = {
                    guard viewModel.timeline.style == .freezeReveal else { return 0 }
                    return max(0, 2 - viewModel.timeline.clips.count - viewModel.timeline.pendingClipCount)
                }()
                StitchClipPicker(maxSelectionCount: remaining) { providers in
                    showClipPicker = false
                    Task { await viewModel.addClips(from: providers) }
                }
                .ignoresSafeArea()
            }
            .onAppear {
                // Bridge the view-model's dispatch hook to the SwiftUI side. We
                // dismiss the sheet AND forward to the parent so it can switch
                // tabs (W025).
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

    private var styleCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Style").font(.headline).foregroundStyle(DesignTokens.textPrimary)
            Picker(
                "Style",
                selection: Binding(
                    get: { viewModel.timeline.style },
                    set: { viewModel.setStyle($0) }
                )
            ) {
                ForEach(StitchStyle.allCases) { style in
                    Text(style.label).tag(style)
                }
            }
            .pickerStyle(.segmented)
            Text(viewModel.timeline.style.summary)
                .font(.caption)
                .foregroundStyle(DesignTokens.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var clipsCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Clips").font(.headline).foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                let canAdd: Bool = {
                    guard viewModel.timeline.style == .freezeReveal else { return true }
                    return viewModel.timeline.clips.count + viewModel.timeline.pendingClipCount < 2
                }()
                Button {
                    showClipPicker = true
                } label: {
                    Label("Add", systemImage: "plus.circle.fill")
                        .foregroundStyle(canAdd ? DesignTokens.accent : DesignTokens.muted)
                }
                .disabled(!canAdd)
            }

            let pending = viewModel.timeline.pendingClipCount
            let hasContent = !viewModel.timeline.clips.isEmpty || pending > 0
            let isFreezeReveal = viewModel.timeline.style == .freezeReveal
            if !hasContent {
                Text(isFreezeReveal
                    ? "Pick your reference video first, then your creator video."
                    : "Pick videos from Photos in the order you want them to play.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 80), spacing: 6)],
                    spacing: 6
                ) {
                    ForEach(Array(viewModel.timeline.clips.enumerated()), id: \.element.id) { index, clip in
                        VStack(spacing: 4) {
                            ClipThumbCell(
                                order: index + 1,
                                clip: clip,
                                cachedPreview: viewModel.timeline.previewImages[clip.id],
                                onRemove: { viewModel.removeClip(id: clip.id) },
                                onToggleBackground: {
                                    viewModel.timeline.setRemoveBackground(
                                        id: clip.id,
                                        enabled: !clip.removeBackground
                                    )
                                }
                            )
                            if let label = freezeRevealRoleLabel(forIndex: index) {
                                Text(label)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(DesignTokens.muted)
                            }
                        }
                    }
                    ForEach(0..<pending, id: \.self) { offset in
                        let pendingIndex = viewModel.timeline.clips.count + offset
                        VStack(spacing: 4) {
                            PendingClipCell(order: pendingIndex + 1)
                            if let label = freezeRevealRoleLabel(forIndex: pendingIndex) {
                                Text(label)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(DesignTokens.muted)
                            }
                        }
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

    private func freezeRevealRoleLabel(forIndex index: Int) -> String? {
        guard viewModel.timeline.style == .freezeReveal else { return nil }
        switch index {
        case 0: return "Reference"
        case 1: return "Creator"
        default: return nil
        }
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
                Text(viewModel.timeline.style == .freezeReveal
                    ? "We've seeded a “STITCH INCOMING” overlay on the reference clip. Tap it to drag/resize, edit the text, or remove it."
                    : "Tap a clip's Text button to add an overlay. Tap an existing chip to drag/pinch its position and size like Instagram. This step is optional.")
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
        .task { viewModel.ensureFreezeRevealTextOverlay() }
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
    @State private var editingFreezeRevealCutout = false

    private var isFreezeReveal: Bool { viewModel.timeline.style == .freezeReveal }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                StepHeader(
                    current: 3,
                    total: 3,
                    label: isFreezeReveal ? "Position + Render" : "Cutout + Render"
                )
                Text(isFreezeReveal
                    ? "We've set up the freeze + reveal layout for you. Drag the creator over the reference's last frame, then render."
                    : "Optionally overlay a person-cutout (background removed) on top of one clip. Then set a title and render.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)

                if isFreezeReveal {
                    freezeRevealCutoutCard
                } else {
                    cutoutCard
                }
                titleCard
                renderCard
            }
            .padding()
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle(isFreezeReveal ? "Position + Render" : "Cutout + Render")
        .navigationBarTitleDisplayMode(.inline)
        .task { viewModel.ensureFreezeRevealCutout() }
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
        .fullScreenCover(isPresented: $editingFreezeRevealCutout) {
            if let cutout = viewModel.timeline.cutoutOverlay,
               let refClip = viewModel.timeline.clips.first {
                CutoutPositionEditorView(
                    referenceClip: refClip,
                    referenceCachedPreview: viewModel.timeline.previewImages[refClip.id],
                    layout: viewModel.timeline.layout,
                    cutout: Binding(
                        get: { viewModel.timeline.cutoutOverlay ?? cutout },
                        set: { viewModel.timeline.updateCutout($0) }
                    )
                )
            }
        }
    }

    private var freezeRevealCutoutCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Creator over Frozen Frame")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if viewModel.timeline.clips.count < 2 {
                Text("Add a second clip on Step 1 to enable Freeze + Reveal.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
            } else if let cutout = viewModel.timeline.cutoutOverlay,
                      let refClip = viewModel.timeline.clips.first,
                      let creatorClip = viewModel.timeline.clips.dropFirst().first {
                HStack(spacing: DesignTokens.spacing) {
                    StitchThumbnail(clip: refClip, cachedPreview: viewModel.timeline.previewImages[refClip.id])
                        .cornerRadius(8)
                        .frame(width: 80, height: 80)
                        .overlay(alignment: .bottomTrailing) {
                            StitchThumbnail(clip: creatorClip, cachedPreview: viewModel.timeline.previewImages[creatorClip.id])
                                .frame(width: 36, height: 36)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(Color.white, lineWidth: 2)
                                )
                                .padding(4)
                        }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Position \(percentLabel(cutout.position.x)) × \(percentLabel(cutout.position.y))")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Size \(Int(cutout.scale * 100))% of frame height")
                            .font(.caption2)
                            .foregroundStyle(DesignTokens.muted)
                    }
                    Spacer()
                }
                Button {
                    editingFreezeRevealCutout = true
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
                        Text("Position & Size")
                            .font(.subheadline.weight(.medium))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background(DesignTokens.accent)
                    .cornerRadius(DesignTokens.cornerRadius)
                }
                .buttonStyle(.plain)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private func percentLabel(_ value: CGFloat) -> String {
        "\(Int((value * 100).rounded()))%"
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
                // Placeholder — no spinner. The clip's underlying file may still be
                // copying from PHPicker (especially for iCloud-only / long videos) and
                // a spinner here makes the user think the app is stuck. The real
                // thumbnail swaps in seamlessly when the load completes in the
                // background.
                Image(systemName: "film")
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.35))
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
    let onToggleBackground: () -> Void

    var body: some View {
        // Static placeholder. Step 1 deliberately doesn't load thumbnails so the user
        // can tap clips and move to Step 2 without waiting on iCloud download / Photos
        // permission round-trip / AVAssetImageGenerator. The cell is fully informative
        // without a thumbnail (order #, BG-removal pill, duration, remove button).
        ZStack {
            Color.black
            Image(systemName: "film")
                .font(.title2)
                .foregroundStyle(.white.opacity(0.35))
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
            .overlay(alignment: .bottomLeading) {
                BackgroundRemovalPill(isOn: clip.removeBackground, onToggle: onToggleBackground)
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

/// Small pill button on each clip thumbnail that toggles per-clip background removal.
/// Off → translucent dark; On → accent fill. Same control surface in both states, so the
/// user can flip it both directions without hunting for a different control.
private struct BackgroundRemovalPill: View {
    let isOn: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 3) {
                Image(systemName: isOn ? "person.crop.rectangle.fill" : "person.crop.rectangle")
                    .font(.system(size: 10, weight: .bold))
                Text("BG")
                    .font(.caption2.weight(.bold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(isOn ? DesignTokens.accent : Color.black.opacity(0.7))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isOn ? "Background removed — tap to disable" : "Remove background")
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
