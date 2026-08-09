import Photos
import UIKit

/// Add-only Photos saver. Requests the `.addOnly` authorization (so the app
/// never asks for full read/write access it doesn't need) and writes each image
/// as a new photo asset.
///
/// Mirrors the intent of the Split-Frame / Stitch flows, which deliberately
/// avoid broad photo-library authorization. `NSPhotoLibraryAddUsageDescription`
/// is declared in `ios/project.yml`.
public enum PhotoLibrarySaver {
    public enum SaveError: LocalizedError {
        case permissionDenied
        case encodingFailed
        case nothingToSave

        public var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "Photos access is off. Enable it in Settings to save graphics."
            case .encodingFailed:
                return "Couldn't encode the image for saving."
            case .nothingToSave:
                return "There's nothing to save yet."
            }
        }
    }

    /// Save all supplied images to the photo library (add-only). Throws on the
    /// first failure so the caller can surface a single toast/alert.
    public static func saveImages(_ images: [UIImage]) async throws {
        guard !images.isEmpty else { throw SaveError.nothingToSave }

        try await ensureAddOnlyAuthorization()

        for image in images {
            guard let data = image.pngData() else { throw SaveError.encodingFailed }
            try await performChanges {
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: data, options: nil)
            }
        }
    }

    private static func ensureAddOnlyAuthorization() async throws {
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        switch status {
        case .authorized, .limited:
            return
        case .notDetermined:
            let granted = await withCheckedContinuation { continuation in
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
                    continuation.resume(returning: newStatus == .authorized || newStatus == .limited)
                }
            }
            if !granted { throw SaveError.permissionDenied }
        default:
            throw SaveError.permissionDenied
        }
    }

    private static func performChanges(_ block: @escaping () -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges(block) { success, error in
                if success {
                    continuation.resume(returning: ())
                } else {
                    continuation.resume(throwing: error ?? SaveError.encodingFailed)
                }
            }
        }
    }
}
