import Foundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

public struct VideoUploadResult: Sendable {
    public let s3Key: String
    public let s3Url: String
}

public enum VideoUploadError: LocalizedError {
    case noVideo
    case invalidURL
    case partFailed(Int)

    public var errorDescription: String? {
        switch self {
        case .noVideo: return "Could not load the selected video"
        case .invalidURL: return "Invalid upload URL"
        case .partFailed(let n): return "Upload part \(n) failed"
        }
    }
}

public final class VideoUploadService {
    public typealias ProgressHandler = @Sendable (_ partsCompleted: Int, _ totalParts: Int) -> Void

    private let api: APIClient
    private static let chunkSize = 10 * 1024 * 1024 // 10 MB — matches existing behavior

    public init(api: APIClient) {
        self.api = api
    }

    public func upload(
        item: PhotosPickerItem,
        prefix: String,
        progress: ProgressHandler? = nil
    ) async throws -> VideoUploadResult {
        guard let movie = try await item.loadTransferable(type: CompositionVideoTransferable.self) else {
            throw VideoUploadError.noVideo
        }
        return try await upload(
            fileURL: movie.url,
            prefix: prefix,
            deleteAfterUpload: true,
            progress: progress
        )
    }

    public func upload(
        fileURL: URL,
        prefix: String,
        contentType: String = "video/mp4",
        deleteAfterUpload: Bool = false,
        progress: ProgressHandler? = nil
    ) async throws -> VideoUploadResult {
        let filename = fileURL.lastPathComponent
        let fileData = try Data(contentsOf: fileURL)

        let initResponse = try await api.initiateMultipartUpload(
            filename: "\(prefix)\(filename)",
            contentType: contentType
        )
        let uploadId = initResponse.uploadId
        let key = initResponse.key

        let totalParts = Int(ceil(Double(fileData.count) / Double(Self.chunkSize)))
        var completedParts: [MultipartCompletePart] = []
        progress?(0, totalParts)

        for partNumber in 1...totalParts {
            let start = (partNumber - 1) * Self.chunkSize
            let end = min(partNumber * Self.chunkSize, fileData.count)
            let chunk = fileData[start..<end]

            let partURLResponse = try await api.getMultipartPartURL(
                uploadId: uploadId,
                key: key,
                partNumber: partNumber
            )
            guard let url = URL(string: partURLResponse.url) else {
                throw VideoUploadError.invalidURL
            }

            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            request.setValue("\(chunk.count)", forHTTPHeaderField: "Content-Length")

            let (_, response) = try await URLSession.shared.upload(for: request, from: chunk)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let etag = httpResponse.value(forHTTPHeaderField: "ETag") else {
                throw VideoUploadError.partFailed(partNumber)
            }

            completedParts.append(MultipartCompletePart(partNumber: partNumber, etag: etag))
            progress?(partNumber, totalParts)
        }

        try await api.completeMultipartUpload(uploadId: uploadId, key: key, parts: completedParts)

        let s3Url = "https://\(api.baseURL.host ?? "")/api/uploads/proxy/\(key)"

        if deleteAfterUpload {
            try? FileManager.default.removeItem(at: fileURL)
        }

        return VideoUploadResult(s3Key: key, s3Url: s3Url)
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
