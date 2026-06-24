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
    /// Fast preview thumbnail. Uses `NSItemProvider.loadPreviewImage(options:)`, which
    /// returns iOS's cached photo-library thumbnail — no file materialization, no iCloud
    /// round-trip, no `AVAssetImageGenerator`. Falls back to the legacy "open the file
    /// and extract a frame" path only if the provider has no registered preview.
    /// Typical latency: ~tens of milliseconds (vs. multi-second for iCloud-only files).
    static func loadPreviewImage(_ provider: NSItemProvider) async -> UIImage? {
        // First try the fast cached-thumbnail path.
        if let cached = await withCheckedContinuation({ (cont: CheckedContinuation<UIImage?, Never>) in
            provider.loadPreviewImage(options: [:]) { item, _ in
                cont.resume(returning: item as? UIImage)
            }
        }) {
            return cached
        }

        // Fallback: open the underlying movie and extract a frame. Slow for iCloud-only
        // files because the system has to materialize the file first.
        return await withCheckedContinuation { (continuation: CheckedContinuation<UIImage?, Never>) in
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

    /// Errors surfaced by `loadMovieFile`. Each case carries enough context that the editor
    /// can show a useful alert when an iCloud download fails, the type isn't supported, or
    /// the local sandbox copy hits a problem (e.g. low disk).
    enum ItemLoadError: LocalizedError {
        case noConformingType(types: [String])
        case loaderReturnedNil
        case loadFailed(Error)
        case copyFailed(Error)

        var errorDescription: String? {
            switch self {
            case .noConformingType(let types):
                return "This file type isn't supported (provider offered: \(types.joined(separator: ", "))). Try a different video."
            case .loaderReturnedNil:
                return "Photos returned no file for this clip. If it lives in iCloud, make sure Wi-Fi is on so it can download."
            case .loadFailed(let err):
                return "Photos couldn't deliver the file: \(err.localizedDescription)"
            case .copyFailed(let err):
                return "Couldn't save the clip locally: \(err.localizedDescription)"
            }
        }
    }

    /// Copy the underlying movie file into the persistent draft directory under Documents.
    /// Returns the stable file URL (which the renderer can read at export time, AND which
    /// survives app reinstalls so a draft can be restored later).
    ///
    /// Slow-Mo / HEVC / HDR videos commonly fail with "Cannot load representation of type
    /// public.movie" when we ask for the generic `public.movie` UTI — PHPicker can't always
    /// transcode them to that umbrella type even though the provider claims conformance.
    /// To dodge that we iterate the provider's registered type identifiers in a preferred
    /// order (specific QuickTime / MP4 first, generic `public.movie` last), and try
    /// `loadInPlaceFileRepresentation` first (no transcode) before falling back to
    /// `loadFileRepresentation` (with transcode).
    static func loadMovieFile(_ provider: NSItemProvider) async -> Result<URL, ItemLoadError> {
        let tryOrder = movieTypeIdentifiers(for: provider)
        guard !tryOrder.isEmpty else {
            NSLog("[Stitch] loadMovieFile: no movie-conforming types in %@",
                  provider.registeredTypeIdentifiers.joined(separator: ", "))
            return .failure(.noConformingType(types: provider.registeredTypeIdentifiers))
        }

        var lastError: ItemLoadError = .loaderReturnedNil
        for typeIdentifier in tryOrder {
            // 1) In-place: avoids PHPicker's transcoding step entirely. Best chance of
            //    success for Slow-Mo / HDR / HEVC.
            let inPlace = await attemptLoad(provider: provider, typeIdentifier: typeIdentifier, inPlace: true)
            if case .success(let url) = inPlace { return .success(url) }
            if case .failure(let err) = inPlace { lastError = err }

            // 2) Copying file rep: for cases where in-place can't grant access (iCloud
            //    needing a download, etc.) Photos will fetch + transcode here.
            let copy = await attemptLoad(provider: provider, typeIdentifier: typeIdentifier, inPlace: false)
            switch copy {
            case .success(let url): return .success(url)
            case .failure(let err): lastError = err
            }
        }
        return .failure(lastError)
    }

    /// Movie-conforming UTIs the provider supports, in the order we should try them.
    /// Specific types ranked above the generic `public.movie` umbrella because the
    /// transcode pipeline behind `public.movie` is what fails for Slow-Mo HEVC.
    private static func movieTypeIdentifiers(for provider: NSItemProvider) -> [String] {
        let preferred: [String] = [
            UTType.quickTimeMovie.identifier,  // com.apple.quicktime-movie — Slow-Mo, HEIC video, most iPhone formats
            UTType.mpeg4Movie.identifier,      // public.mpeg-4
            "com.apple.m4v-video",
            UTType.movie.identifier,           // public.movie — generic umbrella
            UTType.video.identifier,           // public.video
        ]
        let registered = Set(provider.registeredTypeIdentifiers)
        var order = preferred.filter { registered.contains($0) }
        // Any other movie-ish types the provider registered that we didn't enumerate.
        for id in provider.registeredTypeIdentifiers where !order.contains(id) {
            guard let type = UTType(id) else { continue }
            if type.conforms(to: .movie) || type.conforms(to: .video) || type.conforms(to: .audiovisualContent) {
                order.append(id)
            }
        }
        NSLog("[Stitch] loadMovieFile try order: %@ (registered: %@)",
              order.joined(separator: ", "),
              provider.registeredTypeIdentifiers.joined(separator: ", "))
        return order
    }

    /// Single load attempt against one UTI on either the in-place or copying API.
    /// Returns a `Result` so the caller can inspect the failure cause (it's collected
    /// into `lastError` so the alert reports the most specific reason we saw).
    private static func attemptLoad(
        provider: NSItemProvider,
        typeIdentifier: String,
        inPlace: Bool
    ) async -> Result<URL, ItemLoadError> {
        await withCheckedContinuation { (continuation: CheckedContinuation<Result<URL, ItemLoadError>, Never>) in
            let finishWith: (URL?, Error?, Bool) -> Void = { url, error, sourceIsInPlace in
                if let error {
                    NSLog("[Stitch] %@ failed for %@: %@",
                          sourceIsInPlace ? "loadInPlaceFileRepresentation" : "loadFileRepresentation",
                          typeIdentifier,
                          error.localizedDescription)
                    continuation.resume(returning: .failure(.loadFailed(error)))
                    return
                }
                guard let url else {
                    NSLog("[Stitch] %@: nil URL for %@",
                          sourceIsInPlace ? "loadInPlaceFileRepresentation" : "loadFileRepresentation",
                          typeIdentifier)
                    continuation.resume(returning: .failure(.loaderReturnedNil))
                    return
                }
                // For in-place URLs we need security-scoped access while we copy. For the
                // copying API the system already gave us a sandbox temp file.
                let secured = sourceIsInPlace && url.startAccessingSecurityScopedResource()
                defer { if secured { url.stopAccessingSecurityScopedResource() } }

                let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
                let filename = "\(UUID().uuidString).\(ext)"
                let dest = StitchDraftStore.clipsDir.appendingPathComponent(filename)
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    let attrs = try? FileManager.default.attributesOfItem(atPath: dest.path)
                    let size = (attrs?[.size] as? NSNumber)?.int64Value ?? -1
                    NSLog("[Stitch] loaded movie via %@ %@: %@ (%lld bytes)",
                          sourceIsInPlace ? "in-place" : "copy",
                          typeIdentifier,
                          dest.lastPathComponent,
                          size)
                    continuation.resume(returning: .success(dest))
                } catch {
                    NSLog("[Stitch] copyItem failed (%@ → %@): %@",
                          url.path, dest.path, error.localizedDescription)
                    continuation.resume(returning: .failure(.copyFailed(error)))
                }
            }

            if inPlace {
                _ = provider.loadInPlaceFileRepresentation(forTypeIdentifier: typeIdentifier) { url, _, error in
                    finishWith(url, error, true)
                }
            } else {
                provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                    finishWith(url, error, false)
                }
            }
        }
    }
}
