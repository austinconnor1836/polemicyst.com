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

    let api: APIClient
    let compositionId: String
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

    public func save(
        title: String? = nil, mode: String? = nil, audioMode: String? = nil,
        creatorVolume: Double? = nil, referenceVolume: Double? = nil,
        creatorTrimStartS: Double? = nil, creatorTrimEndS: Double? = nil
    ) async {
        isSaving = true
        defer { isSaving = false }
        do {
            composition = try await api.updateComposition(
                id: compositionId,
                body: UpdateCompositionRequest(
                    title: title, mode: mode, audioMode: audioMode,
                    creatorVolume: creatorVolume, referenceVolume: referenceVolume,
                    creatorTrimStartS: creatorTrimStartS, creatorTrimEndS: creatorTrimEndS
                )
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
            _ = try await api.addTrack(
                compositionId: compositionId,
                body: CreateTrackRequest(
                    s3Key: s3Key, s3Url: s3Url, durationS: probe.durationS,
                    width: probe.width, height: probe.height, hasAudio: probe.hasAudio
                )
            )
            composition = try await api.fetchComposition(id: compositionId)
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to upload track: \(error.localizedDescription)"
        }
    }

    public func updateTrack(trackId: String, body: UpdateTrackRequest) async {
        do {
            _ = try await api.updateTrack(compositionId: compositionId, trackId: trackId, body: body)
            composition = try await api.fetchComposition(id: compositionId)
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to update track: \(error.localizedDescription)"
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

    public func triggerRender(layouts: [String]? = nil) async {
        do {
            _ = try await api.triggerRender(compositionId: compositionId, body: RenderRequest(layouts: layouts))
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

enum UploadError: LocalizedError {
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

// MARK: - Shared helpers

func formatDuration(_ seconds: Double) -> String {
    let mins = Int(seconds) / 60
    let secs = Int(seconds) % 60
    return String(format: "%d:%02d", mins, secs)
}
