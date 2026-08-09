import Foundation
import UIKit

/// Client for the standalone Polemicyst Graphic render service.
///
/// This is deliberately NOT part of `APIClient`: the render service is a small
/// separate deployment (`GRAPHIC_RENDER_URL`) that stays up while the monolith
/// is hibernated, is gated by a shared `x-render-secret` header (not the user's
/// bearer token), and returns base64 PNG bytes inline (no S3, no login). Keeping
/// it out of `APIClient` also keeps `APIClient` free of any UIKit dependency.
///
/// Flow: POST `{ text, showPageIndicator }` to `/render` → decode
/// `{ images: [base64 PNG], pageCount, fontSize }` → hand back `[UIImage]`.
public struct PolemicystGraphicService {
    public enum RenderError: LocalizedError {
        /// Non-2xx from the service, with the server-provided message when present.
        case server(statusCode: Int, message: String?)
        /// The service returned no pages.
        case noImages
        /// A page's base64 payload couldn't be decoded into an image.
        case decodeFailed

        public var errorDescription: String? {
            switch self {
            case .server(let statusCode, let message):
                if let message, !message.isEmpty { return message }
                if statusCode == 401 {
                    return "The graphic renderer rejected the request. Please update the app."
                }
                return "The graphic renderer is unavailable right now (HTTP \(statusCode)). Try again shortly."
            case .noImages:
                return "The renderer returned no pages. Try tweaking your text and generating again."
            case .decodeFailed:
                return "Couldn't read the rendered image. Try again shortly."
            }
        }
    }

    private let session: URLSession
    private let renderURL: URL
    private let secret: String?
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        session: URLSession = .shared,
        baseURL: URL = AppConfiguration.graphicRenderURL,
        secret: String? = AppConfiguration.graphicRenderSecret
    ) {
        self.session = session
        self.renderURL = baseURL.appending(path: "render")
        self.secret = secret
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    /// Render the pasted text into the branded carousel and return one image per
    /// page, in carousel order.
    public func render(_ request: PolemicystGraphicRequest) async throws -> [UIImage] {
        var urlRequest = URLRequest(url: renderURL)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let secret {
            urlRequest.setValue(secret, forHTTPHeaderField: "x-render-secret")
        }
        urlRequest.httpBody = try encoder.encode(request)

        let (data, response) = try await session.data(for: urlRequest)

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw RenderError.server(statusCode: http.statusCode, message: Self.serverMessage(from: data))
        }

        let decoded = try decoder.decode(PolemicystGraphicResponse.self, from: data)
        guard !decoded.images.isEmpty else { throw RenderError.noImages }

        var images: [UIImage] = []
        images.reserveCapacity(decoded.images.count)
        for base64 in decoded.images {
            guard let bytes = Data(base64Encoded: base64),
                  let image = UIImage(data: bytes) else {
                throw RenderError.decodeFailed
            }
            images.append(image)
        }
        return images
    }

    /// Best-effort extraction of a human-readable `{ error | message }` string
    /// from a non-2xx JSON body.
    private static func serverMessage(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return (object["error"] as? String) ?? (object["message"] as? String)
    }
}
