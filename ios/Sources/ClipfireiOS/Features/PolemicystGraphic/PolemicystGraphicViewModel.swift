import Combine
import Foundation
import SwiftUI
import UIKit

/// View-model for the Polemicyst Graphic composer.
///
/// Flow: the user pastes text, taps Generate, the standalone render service
/// SYNCHRONOUSLY typesets the branded 1080×1350 PNG carousel and returns the
/// pages as base64 PNGs inline. There is NO AI/LLM step, NO BullMQ job, NO S3,
/// and NO polling — the images come back in the response, so `stage` moves
/// straight from `.generating` to `.result`.
///
/// The decoded `[UIImage]` pages drive the on-screen carousel (`Image(uiImage:)`),
/// Save-to-Photos, and Share directly — no network fetch after the render.
@MainActor
public final class PolemicystGraphicViewModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case generating
        case result(pageCount: Int)
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

    /// Rendered page images, populated after a successful render. Drives the
    /// carousel, Save-to-Photos, and Share.
    @Published public var pageImages: [UIImage] = []
    @Published public var isSaving = false

    private let service: PolemicystGraphicService

    public init(service: PolemicystGraphicService = PolemicystGraphicService()) {
        self.service = service
    }

    // MARK: - Derived

    public var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var canGenerate: Bool {
        !trimmedText.isEmpty && !stage.isGenerating
    }

    public var hasResult: Bool {
        !pageImages.isEmpty
    }

    public var pageCount: Int {
        pageImages.count
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

        let service = self.service
        let payload = PolemicystGraphicRequest(text: text, showPageIndicator: showPageIndicator)

        Task { @MainActor in
            do {
                let images = try await service.render(payload)
                self.pageImages = images
                self.stage = .result(pageCount: images.count)
            } catch {
                let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
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
    }

    /// Save every rendered page to the photo library (add-only).
    public func saveAllToPhotos() async throws {
        guard !pageImages.isEmpty else { throw PhotoLibrarySaver.SaveError.nothingToSave }
        isSaving = true
        defer { isSaving = false }
        try await PhotoLibrarySaver.saveImages(pageImages)
    }
}
