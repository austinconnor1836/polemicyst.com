import Foundation

/// Cheap client-side detector for Instagram media URLs. Mirrors
/// `isInstagramUrl()` in `shared/lib/instagram-captions.ts` — the client only
/// needs to decide "should we let the user paste this?" All the resolution
/// (shortcode → media ID → mp4 CDN URL) happens server-side.
///
/// See `polemicyst.com/CLAUDE.md` change log entry `### 2026-07-23` for the
/// full IG import architecture note.
public enum InstagramURLDetector {
    /// True if the URL points at instagram.com and its path is
    /// `/reel/`, `/reels/`, `/p/`, or `/tv/`.
    public static func isInstagramURL(_ url: String) -> Bool {
        guard let parsed = URL(string: url), let host = parsed.host?.lowercased() else {
            return false
        }
        guard host == "instagram.com" || host.hasSuffix(".instagram.com") else {
            return false
        }
        let path = parsed.path.lowercased()
        return path.hasPrefix("/reel/")
            || path.hasPrefix("/reels/")
            || path.hasPrefix("/p/")
            || path.hasPrefix("/tv/")
    }
}
