import Combine
import Foundation
import SwiftUI
import UIKit

/// View-model for the Polemicyst Graphic composer.
///
/// Flow: the user pastes text, taps Generate, the server SYNCHRONOUSLY renders
/// the branded 1080×1350 PNG carousel and returns the S3 URLs. There is NO
/// AI/LLM step, NO BullMQ job, and NO polling — the URLs come back in the
/// response, so `stage` moves straight from `.generating` to `.result`.
///
/// After a result lands we eagerly download the PNGs into `pageImages` (for
/// Save-to-Photos) and write them to temp files (`shareURLs`) so Share hands the
/// system real image files. The on-screen carousel itself uses `AsyncImage`
/// against the returned S3 URLs.
@MainActor
public final class PolemicystGraphicViewModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case generating
        case result(imageUrls: [String])
        case failed(String)

        public var isGenerating: Bool {
            if case .generating = self { return true }
            return false
        }
    }

    @Published public var text: String = ""
    /// Whether multi-page output shows the "i / N" footer indicator. Single-page
    /// output never shows it regardless of this flag (server-enforced).
    @Published public var showPageIndicator: Bool = true
    @Published public var stage: Stage = .idle

    /// Downloaded page images, populated after a successful render. Used for
    /// Save-to-Photos and as the Share payload source.
    @Published public var pageImages: [UIImage] = []
    /// Temp-file URLs of the page PNGs, for `ShareLink`.
    @Published public var shareURLs: [URL] = []
    @Published public var isSaving = false

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    // MARK: - Derived

    public var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var canGenerate: Bool {
        !trimmedText.isEmpty && !stage.isGenerating
    }

    public var resultUrls: [String] {
        if case .result(let urls) = stage { return urls }
        return []
    }

    public var hasResult: Bool {
        !resultUrls.isEmpty
    }

    // MARK: - Actions

    /// Generate (or regenerate) the graphic from the current `text`.
    public func generate() {
        guard canGenerate else {
            if trimmedText.isEmpty { stage = .failed("Paste some text first.") }
            return
        }

        stage = .generating
        pageImages = []
        shareURLs = []

        let api = self.api
        let payload = PolemicystGraphicRequest(text: text, showPageIndicator: showPageIndicator)

        Task { @MainActor in
            do {
                let response = try await api.renderPolemicystGraphic(payload)
                self.stage = .result(imageUrls: response.imageUrls)
                await self.loadRenderedAssets(from: response.imageUrls)
            } catch {
                let message: String
                if let apiError = error as? APIError {
                    message = apiError.errorDescription ?? "Render failed."
                } else {
                    message = error.localizedDescription
                }
                self.stage = .failed(message)
            }
        }
    }

    /// Same as `generate()` — re-runs the render with the current text/options.
    public func regenerate() {
        generate()
    }

    /// Clear the result and return to the editor with the text intact so the
    /// user can tweak and re-generate.
    public func startOver() {
        stage = .idle
        pageImages = []
        shareURLs = []
    }

    /// Save every rendered page to the photo library (add-only).
    public func saveAllToPhotos() async throws {
        guard !pageImages.isEmpty else { throw PhotoLibrarySaver.SaveError.nothingToSave }
        isSaving = true
        defer { isSaving = false }
        try await PhotoLibrarySaver.saveImages(pageImages)
    }

    // MARK: - Asset download

    /// Download the rendered PNGs for Save/Share. Non-fatal: if a page fails to
    /// download the carousel still renders via `AsyncImage`; only Save/Share are
    /// affected, and they guard on `pageImages` being non-empty.
    private func loadRenderedAssets(from urls: [String]) async {
        var images: [UIImage] = []
        var fileURLs: [URL] = []
        let tmpDir = FileManager.default.temporaryDirectory

        for (index, urlString) in urls.enumerated() {
            guard let url = URL(string: urlString) else { continue }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                guard let image = UIImage(data: data) else { continue }
                images.append(image)

                let fileURL = tmpDir.appendingPathComponent(
                    "polemicyst-graphic-\(index + 1)-\(UUID().uuidString.prefix(8)).png"
                )
                try? data.write(to: fileURL)
                fileURLs.append(fileURL)
            } catch {
                NSLog("[PolemicystGraphic] Failed to download page %d: %@", index + 1, error.localizedDescription)
            }
        }

        self.pageImages = images
        self.shareURLs = fileURLs
    }
}
