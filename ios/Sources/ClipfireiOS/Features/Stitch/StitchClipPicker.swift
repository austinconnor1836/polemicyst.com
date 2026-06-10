import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A SwiftUI wrapper around UIKit's `PHPickerViewController` that exposes the picked
/// items as `NSItemProvider`s — letting us call `loadPreviewImage` for fast cached
/// thumbnails (no PHAsset, no auth prompt) and `loadFileRepresentation` for the actual
/// video file when we need to render.
struct StitchClipPicker: UIViewControllerRepresentable {
    let maxSelectionCount: Int  // 0 = unlimited
    let onPicked: ([NSItemProvider]) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .videos
        config.selectionLimit = maxSelectionCount
        config.selection = .ordered
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onPicked: onPicked) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPicked: ([NSItemProvider]) -> Void
        init(onPicked: @escaping ([NSItemProvider]) -> Void) { self.onPicked = onPicked }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            // Don't call picker.dismiss here — SwiftUI dismisses the sheet via the
            // isPresented binding that the parent flips inside onPicked. Calling dismiss
            // ourselves causes the parent sheet (StitchEditorView) to also dismiss.
            let providers = results.map(\.itemProvider)
            onPicked(providers)
        }
    }
}

/// Async helpers around `NSItemProvider`'s callback-based API.
enum ItemProviderLoader {
    /// Fast preview thumbnail extracted from the underlying file via
    /// `loadInPlaceFileRepresentation` — no full file copy, just a `CGImage` decoded
    /// from a frame near the start. Typically completes in tens of milliseconds.
    static func loadPreviewImage(_ provider: NSItemProvider) async -> UIImage? {
        await withCheckedContinuation { (continuation: CheckedContinuation<UIImage?, Never>) in
            let typeIdentifier = UTType.movie.identifier
            guard provider.hasItemConformingToTypeIdentifier(typeIdentifier) else {
                continuation.resume(returning: nil)
                return
            }
            _ = provider.loadInPlaceFileRepresentation(forTypeIdentifier: typeIdentifier) { url, _, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                // The URL is valid only inside this closure for in-place reps. Generate the
                // thumbnail synchronously so we're done before the URL goes away.
                let secured = url.startAccessingSecurityScopedResource()
                defer { if secured { url.stopAccessingSecurityScopedResource() } }

                let asset = AVURLAsset(url: url)
                let generator = AVAssetImageGenerator(asset: asset)
                generator.appliesPreferredTrackTransform = true
                generator.maximumSize = CGSize(width: 360, height: 360)
                let time = CMTime(seconds: 0.1, preferredTimescale: 600)
                do {
                    let cg = try generator.copyCGImage(at: time, actualTime: nil)
                    continuation.resume(returning: UIImage(cgImage: cg))
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    /// Copy the underlying movie file into the persistent draft directory under Documents.
    /// Returns the stable file URL (which the renderer can read at export time, AND which
    /// survives app reinstalls so a draft can be restored later).
    static func loadMovieFile(_ provider: NSItemProvider) async -> URL? {
        let typeIdentifier = UTType.movie.identifier
        guard provider.hasItemConformingToTypeIdentifier(typeIdentifier) else { return nil }
        return await withCheckedContinuation { (continuation: CheckedContinuation<URL?, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                let filename = "\(UUID().uuidString).\(url.pathExtension.isEmpty ? "mp4" : url.pathExtension)"
                let dest = StitchDraftStore.clipsDir.appendingPathComponent(filename)
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    continuation.resume(returning: dest)
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}
