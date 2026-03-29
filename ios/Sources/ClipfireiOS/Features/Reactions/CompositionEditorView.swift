import AVKit
import PhotosUI
import SwiftUI

@MainActor
public final class CompositionEditorViewModel: ObservableObject {
    @Published public var composition: Composition?
    @Published public var isLoading = false
    @Published public var isSaving = false
    @Published public var errorMessage: String?
    @Published public var isUploadingCreator = false
    @Published public var isUploadingTrack = false
    @Published public var renderOutputs: [CompositionOutput] = []

    private let api: APIClient
    private let compositionId: String
    private var pollTask: Task<Void, Never>?

    public init(api: APIClient, compositionId: String) {
        self.api = api
        self.compositionId = compositionId
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            composition = try await api.fetchComposition(id: compositionId)
            if let outputs = composition?.outputs {
                renderOutputs = outputs
            }
            if composition?.status == "rendering" {
                startPolling()
            }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load composition: \(error.localizedDescription)"
        }
    }

    public func save(title: String? = nil, audioMode: String? = nil) async {
        isSaving = true
        defer { isSaving = false }
        do {
            composition = try await api.updateComposition(
                id: compositionId,
                body: UpdateCompositionRequest(title: title, audioMode: audioMode)
            )
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to save: \(error.localizedDescription)"
        }
    }

    public func uploadCreatorVideo(item: PhotosPickerItem) async {
        isUploadingCreator = true
        defer { isUploadingCreator = false }
        do {
            let (s3Key, s3Url) = try await uploadVideoFile(item: item, prefix: "compositions/\(compositionId)/creator/")
            let probe = try await api.probeVideo(s3Key: s3Key)
            composition = try await api.updateComposition(
                id: compositionId,
                body: UpdateCompositionRequest(
                    creatorS3Key: s3Key,
                    creatorS3Url: s3Url,
                    creatorDurationS: probe.durationS,
                    creatorWidth: probe.width,
                    creatorHeight: probe.height
                )
            )
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to upload creator video: \(error.localizedDescription)"
        }
    }

    public func deleteCreator() async {
        do {
            composition = try await api.updateComposition(
                id: compositionId,
                body: UpdateCompositionRequest(
                    creatorS3Key: "",
                    creatorS3Url: "",
                    creatorDurationS: 0
                )
            )
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to remove creator video: \(error.localizedDescription)"
        }
    }

    public func uploadTrackVideo(item: PhotosPickerItem) async {
        isUploadingTrack = true
        defer { isUploadingTrack = false }
        do {
            let (s3Key, s3Url) = try await uploadVideoFile(item: item, prefix: "compositions/\(compositionId)/raw/")
            let probe = try await api.probeVideo(s3Key: s3Key)
            let track = try await api.addTrack(
                compositionId: compositionId,
                body: CreateTrackRequest(
                    s3Key: s3Key, s3Url: s3Url, durationS: probe.durationS,
                    width: probe.width, height: probe.height, hasAudio: probe.hasAudio
                )
            )
            if var comp = composition {
                var tracks = comp.tracks ?? []
                tracks.append(track)
                composition = try await api.fetchComposition(id: compositionId)
            }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to upload track: \(error.localizedDescription)"
        }
    }

    public func deleteTrack(trackId: String) async {
        do {
            try await api.deleteTrack(compositionId: compositionId, trackId: trackId)
            composition = try await api.fetchComposition(id: compositionId)
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to delete track: \(error.localizedDescription)"
        }
    }

    public func triggerRender() async {
        do {
            _ = try await api.triggerRender(compositionId: compositionId, body: RenderRequest())
            composition = try await api.fetchComposition(id: compositionId)
            startPolling()
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to start render: \(error.localizedDescription)"
        }
    }

    public func cancelRender() async {
        do {
            try await api.cancelRender(compositionId: compositionId)
            stopPolling()
            composition = try await api.fetchComposition(id: compositionId)
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to cancel render: \(error.localizedDescription)"
        }
    }

    public func startPolling() {
        stopPolling()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                do {
                    let status = try await api.fetchRenderStatus(compositionId: compositionId)
                    renderOutputs = status.outputs
                    if status.status != "rendering" {
                        composition = try await api.fetchComposition(id: compositionId)
                        break
                    }
                } catch {
                    break
                }
            }
        }
    }

    public func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: - Private upload helper

    private static let chunkSize = 10 * 1024 * 1024 // 10 MB

    private func uploadVideoFile(item: PhotosPickerItem, prefix: String) async throws -> (s3Key: String, s3Url: String) {
        guard let movie = try await item.loadTransferable(type: CompositionVideoTransferable.self) else {
            throw UploadError.noVideo
        }
        let fileURL = movie.url
        let filename = fileURL.lastPathComponent
        let fileData = try Data(contentsOf: fileURL)
        let contentType = "video/mp4"

        // Initiate multipart upload
        let initResponse = try await api.initiateMultipartUpload(filename: "\(prefix)\(filename)", contentType: contentType)
        let uploadId = initResponse.uploadId
        let key = initResponse.key

        // Upload parts
        let totalParts = Int(ceil(Double(fileData.count) / Double(Self.chunkSize)))
        var completedParts: [MultipartCompletePart] = []

        for partNumber in 1...totalParts {
            let start = (partNumber - 1) * Self.chunkSize
            let end = min(partNumber * Self.chunkSize, fileData.count)
            let chunk = fileData[start..<end]

            let partURLResponse = try await api.getMultipartPartURL(uploadId: uploadId, key: key, partNumber: partNumber)
            guard let url = URL(string: partURLResponse.url) else {
                throw UploadError.invalidURL
            }

            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            request.setValue("\(chunk.count)", forHTTPHeaderField: "Content-Length")

            let (_, response) = try await URLSession.shared.upload(for: request, from: chunk)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let etag = httpResponse.value(forHTTPHeaderField: "ETag") else {
                throw UploadError.partFailed(partNumber)
            }

            completedParts.append(MultipartCompletePart(partNumber: partNumber, etag: etag))
        }

        // Complete multipart upload
        try await api.completeMultipartUpload(uploadId: uploadId, key: key, parts: completedParts)

        // Construct S3 URL from key
        let s3Url = "https://\(api.baseURL.host ?? "")/api/uploads/proxy/\(key)"

        // Clean up temp file
        try? FileManager.default.removeItem(at: fileURL)

        return (key, s3Url)
    }
}

private enum UploadError: LocalizedError {
    case noVideo
    case invalidURL
    case partFailed(Int)

    var errorDescription: String? {
        switch self {
        case .noVideo: return "Could not load the selected video"
        case .invalidURL: return "Invalid upload URL"
        case .partFailed(let n): return "Upload part \(n) failed"
        }
    }
}

struct CompositionVideoTransferable: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            let dest = tempDir.appendingPathComponent(received.file.lastPathComponent)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return Self(url: dest)
        }
    }
}

// MARK: - Editor View

public struct CompositionEditorView: View {
    @StateObject private var viewModel: CompositionEditorViewModel
    @State private var editableTitle = ""
    @State private var creatorPickerItem: PhotosPickerItem?
    @State private var trackPickerItem: PhotosPickerItem?
    @State private var showErrorAlert = false
    @State private var showDeleteCreatorAlert = false
    @State private var trackToDelete: CompositionTrack?
    @State private var showDeleteTrackAlert = false

    public init(compositionId: String, api: APIClient) {
        _viewModel = StateObject(wrappedValue: CompositionEditorViewModel(api: api, compositionId: compositionId))
    }

    public var body: some View {
        ScrollView {
            if let comp = viewModel.composition {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    titleSection(comp)
                    creatorVideoSection(comp)
                    referenceTracksSection(comp)
                    audioSettingsSection(comp)
                    renderSection(comp)
                    outputsSection
                }
                .padding()
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Edit Composition")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            await viewModel.load()
            if let comp = viewModel.composition {
                editableTitle = comp.title
            }
        }
        .onDisappear { viewModel.stopPolling() }
        .overlay {
            if viewModel.isLoading && viewModel.composition == nil {
                ProgressView().progressViewStyle(.circular)
            }
        }
        .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .alert("Remove Creator Video", isPresented: $showDeleteCreatorAlert) {
            Button("Remove", role: .destructive) {
                Task { await viewModel.deleteCreator() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Remove the creator video from this composition?")
        }
        .alert("Delete Track", isPresented: $showDeleteTrackAlert, presenting: trackToDelete) { track in
            Button("Delete", role: .destructive) {
                Task { await viewModel.deleteTrack(trackId: track.id) }
            }
            Button("Cancel", role: .cancel) { }
        } message: { track in
            Text("Delete \"\(track.label ?? "this track")\"? This cannot be undone.")
        }
        .onChange(of: creatorPickerItem) { _, item in
            guard let item else { return }
            creatorPickerItem = nil
            Task { await viewModel.uploadCreatorVideo(item: item) }
        }
        .onChange(of: trackPickerItem) { _, item in
            guard let item else { return }
            trackPickerItem = nil
            Task { await viewModel.uploadTrackVideo(item: item) }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func titleSection(_ comp: Composition) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Title")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            TextField("Composition title", text: $editableTitle)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    Task { await viewModel.save(title: editableTitle) }
                }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func creatorVideoSection(_ comp: Composition) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Creator Video")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if comp.creatorS3Url != nil && comp.creatorS3Url != "" {
                HStack {
                    if let urlString = comp.creatorS3Url, let url = URL(string: urlString) {
                        ClipPlayerView(url: url)
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .cornerRadius(8)
                            .frame(maxWidth: 200)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        if let duration = comp.creatorDurationS {
                            Text(formatDuration(duration))
                                .font(.subheadline)
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        if let w = comp.creatorWidth, let h = comp.creatorHeight {
                            Text("\(w)×\(h)")
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }

                        Button(role: .destructive) {
                            showDeleteCreatorAlert = true
                        } label: {
                            Label("Remove", systemImage: "trash")
                                .font(.caption)
                        }
                    }

                    Spacer()
                }
            } else if viewModel.isUploadingCreator {
                HStack(spacing: DesignTokens.spacing) {
                    ProgressView()
                    Text("Uploading creator video…")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else {
                PhotosPicker(selection: $creatorPickerItem, matching: .videos) {
                    Label("Add Creator Video", systemImage: "video.badge.plus")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(DesignTokens.accent.opacity(0.15))
                        .foregroundStyle(DesignTokens.accent)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func referenceTracksSection(_ comp: Composition) -> some View {
        let tracks = comp.tracks ?? []
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Reference Tracks")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Text("\(tracks.count)/10")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
            }

            if tracks.isEmpty {
                Text("No reference tracks yet")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
            } else {
                ForEach(tracks) { track in
                    trackRow(track)
                }
            }

            if viewModel.isUploadingTrack {
                HStack(spacing: DesignTokens.spacing) {
                    ProgressView()
                    Text("Uploading track…")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            if tracks.count < 10 && !viewModel.isUploadingTrack {
                PhotosPicker(selection: $trackPickerItem, matching: .videos) {
                    Label("Add Track", systemImage: "plus.circle")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(DesignTokens.accent.opacity(0.15))
                        .foregroundStyle(DesignTokens.accent)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func trackRow(_ track: CompositionTrack) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(track.label ?? "Track \(track.sortOrder + 1)")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textPrimary)
                HStack(spacing: 6) {
                    Text(formatDuration(track.durationS))
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                    if let w = track.width, let h = track.height {
                        Text("\(w)×\(h)")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                    if track.hasAudio {
                        Image(systemName: "speaker.wave.2")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }
            }

            Spacer()

            Button(role: .destructive) {
                trackToDelete = track
                showDeleteTrackAlert = true
            } label: {
                Image(systemName: "trash")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(DesignTokens.smallSpacing)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    @ViewBuilder
    private func audioSettingsSection(_ comp: Composition) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Audio")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            Picker("Audio Mode", selection: Binding(
                get: { comp.audioMode },
                set: { newValue in
                    Task { await viewModel.save(audioMode: newValue) }
                }
            )) {
                Text("Creator").tag("creator")
                Text("Reference").tag("reference")
                Text("Both").tag("both")
            }
            .pickerStyle(.segmented)
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private func renderSection(_ comp: Composition) -> some View {
        let hasCreator = comp.creatorS3Key != nil && comp.creatorS3Key != ""
        let hasTracks = (comp.tracks?.count ?? 0) > 0
        let canRender = hasCreator && hasTracks && comp.status != "rendering"

        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Render")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if comp.status == "rendering" {
                HStack(spacing: DesignTokens.spacing) {
                    ProgressView()
                    Text("Rendering…")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                    Spacer()
                    Button("Cancel") {
                        Task { await viewModel.cancelRender() }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.red)
                }
            } else {
                Button {
                    Task { await viewModel.triggerRender() }
                } label: {
                    Label("Start Render", systemImage: "film")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canRender ? DesignTokens.accent : DesignTokens.muted.opacity(0.3))
                        .foregroundStyle(canRender ? DesignTokens.background : DesignTokens.muted)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
                .disabled(!canRender)

                if !hasCreator {
                    Text("Add a creator video to render")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                } else if !hasTracks {
                    Text("Add at least one reference track to render")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }

            if comp.status == "failed" {
                Text("Render failed")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private var outputsSection: some View {
        let outputs = viewModel.renderOutputs
        if !outputs.isEmpty {
            VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                Text("Outputs")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                ForEach(outputs) { output in
                    outputCard(output)
                }
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
        }
    }

    @ViewBuilder
    private func outputCard(_ output: CompositionOutput) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            HStack {
                Text(output.layout.capitalized)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                outputStatusBadge(output.status)
            }

            if output.status == "completed", let urlString = output.s3Url, let url = URL(string: urlString) {
                ClipPlayerView(url: url)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .cornerRadius(8)

                ShareLink(item: url) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(DesignTokens.accent.opacity(0.15))
                        .foregroundStyle(DesignTokens.accent)
                        .cornerRadius(8)
                }
            } else if output.status == "rendering" {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Rendering…")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else if output.status == "failed" {
                Text(output.renderError ?? "Render failed")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    @ViewBuilder
    private func outputStatusBadge(_ status: String) -> some View {
        let (label, color): (String, Color) = switch status {
        case "rendering": ("Rendering", .orange)
        case "completed": ("Done", .green)
        case "failed": ("Failed", .red)
        default: ("Pending", DesignTokens.muted)
        }

        Text(label)
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .cornerRadius(4)
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
