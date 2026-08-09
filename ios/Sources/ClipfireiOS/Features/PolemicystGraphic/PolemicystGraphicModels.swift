import Foundation

/// Request body for `POST /api/polemicyst-graphic/render`.
///
/// 100% programmatic server-side render — the pasted `text` is typeset into the
/// fixed Polemicyst brand card and rasterized to one or more 1080×1350 PNG
/// pages. NO AI / LLM is involved anywhere in this flow.
public struct PolemicystGraphicRequest: Encodable, Equatable {
    /// The raw pasted copy. Paragraphs split on blank lines; a lone `---` (or
    /// `===`) line forces a carousel page break.
    public let text: String
    /// Show the "i / N" footer indicator on multi-page (carousel) output.
    /// `nil` lets the server default (true) apply.
    public let showPageIndicator: Bool?

    public init(text: String, showPageIndicator: Bool? = nil) {
        self.text = text
        self.showPageIndicator = showPageIndicator
    }
}

/// Response from `POST /api/polemicyst-graphic/render`.
///
/// `imageUrls` is an ordered array of S3 PNG URLs — one entry per carousel page
/// (a short post yields a single URL). The render is synchronous, so these URLs
/// are ready to display the instant the request returns; there is no polling.
public struct PolemicystGraphicResponse: Decodable, Equatable {
    public let imageUrls: [String]
    public let pageCount: Int

    public init(imageUrls: [String], pageCount: Int) {
        self.imageUrls = imageUrls
        self.pageCount = pageCount
    }
}
