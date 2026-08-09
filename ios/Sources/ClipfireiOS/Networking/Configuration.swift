import Foundation

public enum AppConfiguration {
    /// API base URL read from Info.plist (set via build settings).
    /// Falls back to localhost for SPM-only / preview builds.
    public static var apiBaseURL: URL {
        if let urlString = Bundle.main.infoDictionary?["API_BASE_URL"] as? String,
           let url = URL(string: urlString) {
            return url
        }
        return URL(string: "http://127.0.0.1:3000")!
    }

    /// The web app's Google Client ID, used as `serverClientID` in GIDSignIn
    /// so the backend can exchange the server auth code for access/refresh tokens.
    public static var googleServerClientID: String? {
        Bundle.main.infoDictionary?["GOOGLE_SERVER_CLIENT_ID"] as? String
    }

    /// Base URL of the standalone Polemicyst Graphic render service (a small
    /// Satori+resvg Vercel deployment, separate from the main monolith so it
    /// stays up while the monolith is hibernated). Read from Info.plist (set via
    /// build settings). Falls back to the deployed service for SPM-only builds.
    public static var graphicRenderURL: URL {
        if let urlString = Bundle.main.infoDictionary?["GRAPHIC_RENDER_URL"] as? String,
           let url = URL(string: urlString) {
            return url
        }
        return URL(string: "https://polemicyst-graphic-render.vercel.app")!
    }

    /// Shared secret sent as `x-render-secret` to the render service. This ships
    /// in the app binary, which is acceptable here — it only gates a public
    /// stateless render endpoint (no user data, no auth). `nil` when unset.
    public static var graphicRenderSecret: String? {
        guard let secret = Bundle.main.infoDictionary?["GRAPHIC_RENDER_SECRET"] as? String,
              !secret.isEmpty else {
            return nil
        }
        return secret
    }
}
