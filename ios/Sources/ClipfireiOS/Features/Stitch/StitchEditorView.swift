import AVFoundation
import PhotosUI
import SwiftUI

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
    private let uploader: VideoUploadService
    private let renderer = StitchRenderer()
    private var currentRenderTask: Task<Void, Never>?

    public init(api: APIClient) {
        self.api = api
        self.uploader = VideoUploadService(api: api)
    }

    // MARK: Clip picking

    public func addClip(from item: PhotosPickerItem) async {
        stage = .loading
        do {
            guard let movie = try await item.loadTransferable(type: CompositionVideoTransferable.self) else {
                stage = .failed("Could not load the selected video")
                return
            }
            let durationS = try await loadDuration(url: movie.url)
            timeline.addClip(StitchClip(sourceURL: movie.url, durationS: durationS))
            stage = .idle
        } catch {
            stage = .failed("Failed to add clip: \(error.localizedDescription)")
        }
    }

    public func setCutoutSource(from item: PhotosPickerItem) async {
        stage = .loading
        do {
            guard let movie = try await item.loadTransferable(type: CompositionVideoTransferable.self) else {
                stage = .failed("Could not load the cutout video")
                return
            }
            let durationS = try await loadDuration(url: movie.url)
            let total = timeline.totalDurationS
            timeline.setCutout(CutoutOverlay(
                sourceURL: movie.url,
                sourceDurationS: durationS,
                startS: 0,
                endS: min(durationS, max(0.5, total))
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
        let snap = timeline.snapshot()
        let chosenTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        currentRenderTask = Task { [weak self] in
            guard let self else { return }
            do {
                self.stage = .rendering(0)
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

                self.stage = .uploading(0)
                let upload = try await self.uploader.upload(
                    fileURL: outputURL,
                    prefix: "stitch/\(UUID().uuidString)/",
                    contentType: "video/mp4",
                    deleteAfterUpload: true,
                    progress: { done, total in
                        Task { @MainActor [weak self] in
                            self?.stage = .uploading(Double(done) / Double(max(total, 1)))
                        }
                    }
                )

                self.stage = .saving
                let composition = try await self.api.createComposition(
                    body: CreateCompositionRequest(
                        title: chosenTitle.isEmpty ? nil : chosenTitle,
                        mode: "stitch"
                    )
                )

                let durationMs = Int(snap.clips.reduce(0) { $0 + $1.effectiveDurationS } * 1000)
                let layoutKey = snap.layout == .mobile ? "mobile" : "landscape"
                try await self.api.saveClientRender(
                    compositionId: composition.id,
                    body: ClientCompleteRenderRequest(
                        layout: layoutKey,
                        s3Key: upload.s3Key,
                        s3Url: upload.s3Url,
                        durationMs: durationMs
                    )
                )

                self.stage = .completed(composition.id)
            } catch is CancellationError {
                self.stage = .idle
            } catch {
                self.stage = .failed(error.localizedDescription)
            }
        }
    }

    public func cancel() {
        currentRenderTask?.cancel()
        currentRenderTask = nil
        stage = .idle
    }

    public func reset() {
        timeline = StitchTimeline()
        title = ""
        stage = .idle
    }
}

// MARK: - View

public struct StitchEditorView: View {
    @StateObject private var viewModel: StitchEditorViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var clipPickerItem: PhotosPickerItem?
    @State private var cutoutPickerItem: PhotosPickerItem?
    @State private var showAddText = false
    @State private var showErrorAlert = false

    public init(api: APIClient) {
        _viewModel = StateObject(wrappedValue: StitchEditorViewModel(api: api))
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    titleCard
                    layoutCard
                    clipsCard
                    textOverlaysCard
                    cutoutCard
                    if !viewModel.timeline.clips.isEmpty {
                        renderCard
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
            .onChange(of: clipPickerItem) { _, item in
                guard let item else { return }
                clipPickerItem = nil
                Task { await viewModel.addClip(from: item) }
            }
            .onChange(of: cutoutPickerItem) { _, item in
                guard let item else { return }
                cutoutPickerItem = nil
                Task { await viewModel.setCutoutSource(from: item) }
            }
            .onChange(of: viewModel.stage) { _, stage in
                if case .failed = stage { showErrorAlert = true }
                if case .completed = stage {
                    Task { @MainActor in
                        try? await Task.sleep(for: .seconds(1.5))
                        dismiss()
                    }
                }
            }
            .alert("Render failed", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { viewModel.stage = .idle }
            } message: {
                if case .failed(let m) = viewModel.stage { Text(m) }
            }
            .sheet(isPresented: $showAddText) {
                AddTextOverlaySheet(
                    totalDurationS: viewModel.timeline.totalDurationS,
                    onAdd: { overlay in
                        viewModel.timeline.addTextOverlay(overlay)
                        showAddText = false
                    }
                )
            }
        }
    }

    // MARK: Cards

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

    private var layoutCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Layout").font(.headline).foregroundStyle(DesignTokens.textPrimary)
            Picker("Layout", selection: $viewModel.timeline.layout) {
                ForEach(StitchLayout.allCases) { layout in
                    Text(layout.label).tag(layout)
                }
            }
            .pickerStyle(.segmented)
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
                PhotosPicker(
                    selection: $clipPickerItem,
                    matching: .videos,
                    photoLibrary: .shared()
                ) {
                    Label("Add", systemImage: "plus.circle.fill")
                        .foregroundStyle(DesignTokens.accent)
                }
            }

            if viewModel.timeline.clips.isEmpty {
                Text("Pick videos from Photos in the order you want them to play.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(Array(viewModel.timeline.clips.enumerated()), id: \.element.id) { index, clip in
                    HStack {
                        Text("\(index + 1).")
                            .foregroundStyle(DesignTokens.muted)
                            .frame(width: 24, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(clip.sourceURL.lastPathComponent)
                                .font(.subheadline)
                                .lineLimit(1)
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text(formatDuration(clip.effectiveDurationS))
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }
                        Spacer()
                        Button {
                            viewModel.timeline.removeClip(id: clip.id)
                        } label: {
                            Image(systemName: "minus.circle")
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.vertical, 6)
                    if index < viewModel.timeline.clips.count - 1 {
                        Divider().background(DesignTokens.muted.opacity(0.3))
                    }
                }
                Text("Total: \(formatDuration(viewModel.timeline.totalDurationS))")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
                    .padding(.top, 4)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var textOverlaysCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Text Overlays").font(.headline).foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Button {
                    showAddText = true
                } label: {
                    Label("Add", systemImage: "plus.circle.fill")
                        .foregroundStyle(DesignTokens.accent)
                }
                .disabled(viewModel.timeline.totalDurationS < 0.1)
            }

            if viewModel.timeline.textOverlays.isEmpty {
                Text("Add text or text-on-background overlays that appear over the stitched video.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
            } else {
                ForEach(viewModel.timeline.textOverlays) { overlay in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(overlay.text)
                                .font(.subheadline)
                                .foregroundStyle(DesignTokens.textPrimary)
                                .lineLimit(2)
                            Text("\(formatDuration(overlay.startS)) – \(formatDuration(overlay.endS))" +
                                 (overlay.hasBackground ? " · with background" : ""))
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }
                        Spacer()
                        Button {
                            viewModel.timeline.removeTextOverlay(id: overlay.id)
                        } label: {
                            Image(systemName: "minus.circle").foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var cutoutCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Cutout Overlay").font(.headline).foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if viewModel.timeline.cutoutOverlay == nil {
                    PhotosPicker(
                        selection: $cutoutPickerItem,
                        matching: .videos,
                        photoLibrary: .shared()
                    ) {
                        Label("Pick", systemImage: "plus.circle.fill")
                            .foregroundStyle(DesignTokens.accent)
                    }
                    .disabled(viewModel.timeline.totalDurationS < 0.1)
                } else {
                    Button(role: .destructive) {
                        viewModel.timeline.setCutout(nil)
                    } label: {
                        Image(systemName: "minus.circle").foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let cutout = viewModel.timeline.cutoutOverlay {
                VStack(alignment: .leading, spacing: 8) {
                    Text(cutout.sourceURL.lastPathComponent)
                        .font(.subheadline).foregroundStyle(DesignTokens.textPrimary)
                        .lineLimit(1)
                    Text("Source duration: \(formatDuration(cutout.sourceDurationS))")
                        .font(.caption).foregroundStyle(DesignTokens.muted)
                    HStack {
                        Text("Scale")
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
                    .font(.caption).foregroundStyle(DesignTokens.muted)
                }
            } else {
                Text("Pick a video to overlay with the person's background removed.")
                    .font(.subheadline).foregroundStyle(DesignTokens.muted)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private var renderCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            switch viewModel.stage {
            case .idle, .failed:
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
            case .loading:
                ProgressLine(label: "Loading clip…", progress: nil)
            case .rendering(let f):
                ProgressLine(label: "Rendering on device…", progress: f)
                cancelButton
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

    private var cancelButton: some View {
        Button(role: .destructive) {
            viewModel.cancel()
        } label: {
            Text("Cancel")
                .foregroundStyle(.red)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Add text overlay sheet

private struct AddTextOverlaySheet: View {
    let totalDurationS: Double
    let onAdd: (TextOverlay) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var text: String = ""
    @State private var withBackground: Bool = true
    @State private var startS: Double = 0
    @State private var endS: Double = 3

    var body: some View {
        NavigationStack {
            Form {
                Section("Text") {
                    TextField("Type your overlay text", text: $text, axis: .vertical)
                        .lineLimit(1...4)
                }
                Section("Style") {
                    Toggle("Show background", isOn: $withBackground)
                }
                Section("Time range") {
                    VStack(alignment: .leading) {
                        Text("Start: \(format(startS))").font(.caption)
                        Slider(value: $startS, in: 0...max(0.1, totalDurationS), step: 0.1)
                    }
                    VStack(alignment: .leading) {
                        Text("End: \(format(endS))").font(.caption)
                        Slider(value: $endS, in: 0...max(0.1, totalDurationS), step: 0.1)
                    }
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
                        let overlay = TextOverlay(
                            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                            backgroundColor: withBackground ? .black.opacity(0.6) : nil,
                            startS: min(startS, endS),
                            endS: max(startS, endS)
                        )
                        onAdd(overlay)
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || endS <= startS)
                }
            }
        }
        .onAppear {
            endS = min(3, totalDurationS)
        }
    }

    private func format(_ s: Double) -> String { String(format: "%.1fs", s) }
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
