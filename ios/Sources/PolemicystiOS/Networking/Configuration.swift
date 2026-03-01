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
}
