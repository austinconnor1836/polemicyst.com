import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Video picker
//
// Wraps `PHPickerViewController` for a single video pick, mirroring
// `StitchClipPicker` but returning ONE item provider (Split-Frame uses only
// one video). We intentionally do NOT call `PHPhotoLibrary.requestAuthorization`
// anywhere — iOS 26.5 documented crash lives there. PHPicker doesn't require
// auth to return `NSItemProvider`s.

struct SplitFrameVideoPicker: UIViewControllerRepresentable {
    let onPicked: (NSItemProvider?) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .videos
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onPicked: onPicked) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPicked: (NSItemProvider?) -> Void
        init(onPicked: @escaping (NSItemProvider?) -> Void) { self.onPicked = onPicked }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            // Parent flips the isPresented binding via onPicked; don't dismiss here
            // or SwiftUI will collapse the enclosing sheet too. Same convention as
            // StitchClipPicker.
            onPicked(results.first?.itemProvider)
        }
    }
}

// MARK: - Image picker

struct SplitFrameImagePicker: UIViewControllerRepresentable {
    let onPicked: (NSItemProvider?) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onPicked: onPicked) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPicked: (NSItemProvider?) -> Void
        init(onPicked: @escaping (NSItemProvider?) -> Void) { self.onPicked = onPicked }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            onPicked(results.first?.itemProvider)
        }
    }
}

// MARK: - Loader (image → local file URL + inline UIImage preview)

enum SplitFrameImageLoader {
    enum LoadError: LocalizedError {
        case noConformingType(types: [String])
        case loaderReturnedNil
        case loadFailed(Error)
        case copyFailed(Error)
        case decodeFailed

        var errorDescription: String? {
            switch self {
            case .noConformingType(let types):
                return "This image type isn't supported (provider offered: \(types.joined(separator: ", "))). Try a different picture."
            case .loaderReturnedNil:
                return "Photos returned no file for this image. If it lives in iCloud, make sure Wi-Fi is on so it can download."
            case .loadFailed(let err):
                return "Photos couldn't deliver the file: \(err.localizedDescription)"
            case .copyFailed(let err):
                return "Couldn't save the picture locally: \(err.localizedDescription)"
            case .decodeFailed:
                return "The picture couldn't be decoded."
            }
        }
    }

    /// Copies the picked image into a persistent sandbox location so we can
    /// upload it later via `URLSession.upload(...)` and also render a preview.
    /// Order of type identifiers puts specific formats before the generic
    /// `public.image` umbrella — same pattern as `StitchClipPicker.loadMovieFile`.
    static func loadImageFile(_ provider: NSItemProvider) async -> Result<(URL, UIImage), LoadError> {
        let tryOrder = imageTypeIdentifiers(for: provider)
        guard !tryOrder.isEmpty else {
            return .failure(.noConformingType(types: provider.registeredTypeIdentifiers))
        }

        var lastError: LoadError = .loaderReturnedNil
        for typeIdentifier in tryOrder {
            let result = await attemptLoad(provider: provider, typeIdentifier: typeIdentifier)
            switch result {
            case .success(let (url, image)):
                return .success((url, image))
            case .failure(let err):
                lastError = err
            }
        }
        return .failure(lastError)
    }

    private static func imageTypeIdentifiers(for provider: NSItemProvider) -> [String] {
        let preferred: [String] = [
            UTType.jpeg.identifier,
            UTType.png.identifier,
            UTType.heic.identifier,
            UTType.heif.identifier,
            UTType.webP.identifier,
            UTType.image.identifier,
        ]
        let registered = Set(provider.registeredTypeIdentifiers)
        var order = preferred.filter { registered.contains($0) }
        for id in provider.registeredTypeIdentifiers where !order.contains(id) {
            guard let type = UTType(id) else { continue }
            if type.conforms(to: .image) {
                order.append(id)
            }
        }
        return order
    }

    private static func attemptLoad(
        provider: NSItemProvider,
        typeIdentifier: String
    ) async -> Result<(URL, UIImage), LoadError> {
        await withCheckedContinuation { (continuation: CheckedContinuation<Result<(URL, UIImage), LoadError>, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                if let error {
                    NSLog("[SplitFrame] image loadFileRepresentation failed for %@: %@",
                          typeIdentifier, error.localizedDescription)
                    continuation.resume(returning: .failure(.loadFailed(error)))
                    return
                }
                guard let url else {
                    continuation.resume(returning: .failure(.loaderReturnedNil))
                    return
                }

                let ext = url.pathExtension.isEmpty ? extForUti(typeIdentifier) : url.pathExtension
                let filename = "\(UUID().uuidString).\(ext)"
                let destDir = splitFrameDraftDir()
                do {
                    try FileManager.default.createDirectory(
                        at: destDir,
                        withIntermediateDirectories: true
                    )
                } catch {
                    continuation.resume(returning: .failure(.copyFailed(error)))
                    return
                }
                let dest = destDir.appendingPathComponent(filename)
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    guard let image = UIImage(contentsOfFile: dest.path) else {
                        continuation.resume(returning: .failure(.decodeFailed))
                        return
                    }
                    continuation.resume(returning: .success((dest, image)))
                } catch {
                    continuation.resume(returning: .failure(.copyFailed(error)))
                }
            }
        }
    }

    private static func extForUti(_ uti: String) -> String {
        switch uti {
        case UTType.jpeg.identifier: return "jpg"
        case UTType.png.identifier: return "png"
        case UTType.heic.identifier: return "heic"
        case UTType.heif.identifier: return "heif"
        case UTType.webP.identifier: return "webp"
        default: return "jpg"
        }
    }
}

/// Persistent scratch directory for Split-Frame draft files. Lives under
/// Documents so it survives an app relaunch (matches the Stitch clips dir
/// convention). We clean it up per-draft after a successful render kicks off.
public func splitFrameDraftDir() -> URL {
    FileManager.default
        .urls(for: .documentDirectory, in: .userDomainMask).first!
        .appendingPathComponent("split-frame-drafts", isDirectory: true)
}
