import Foundation

/// Request body for `POST /render` on the standalone render service.
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

/// Response from `POST /render` on the standalone render service.
///
/// `images` is an ordered array of base64-encoded PNGs — one entry per carousel
/// page (a short post yields a single image). The render is synchronous, so the
/// bytes are inline in the response (no S3, no URLs, no polling).
public struct PolemicystGraphicResponse: Decodable, Equatable {
    /// Base64-encoded PNG bytes, one per page, in carousel order.
    public let images: [String]
    public let pageCount: Int
    /// The font size (px) the service settled on. Informational only.
    public let fontSize: Double?

    public init(images: [String], pageCount: Int, fontSize: Double? = nil) {
        self.images = images
        self.pageCount = pageCount
        self.fontSize = fontSize
    }
}
