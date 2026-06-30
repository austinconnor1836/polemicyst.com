import Foundation

/// Auto-login bypass for the Clipfire iOS app, gated to DEBUG builds only.
///
/// Lets an agent / CI harness inject a pre-signed Bearer JWT (the same shape
/// `next-auth/jwt` `encode()` produces against `NEXTAUTH_SECRET`) at launch
/// so the app skips Google / Apple OAuth entirely. The token is written to
/// the same Keychain slot `TokenStorage` uses for the real OAuth flows, and
/// `AuthService` is flipped to `isAuthenticated = true` before the LoginView
/// has a chance to render.
///
/// Two delivery channels are supported (checked in order):
///   1. Launch argument: `--auto-login=<jwt>`
///   2. Environment variable: `CLIPFIRE_AUTO_LOGIN_JWT=<jwt>`
///
/// In RELEASE builds both `isEnabled` and `token` hard-return false / nil so
/// the auto-login path is statically dead code and cannot ship to production.
/// The agent-facing skill that mints + injects the JWT lives at
/// `~/.claude/skills/sim-login-clipfire/`.
public enum AutoLoginMode {
    /// True when this build is DEBUG and an auto-login token was provided
    /// via launch arg or env var. Always false in RELEASE.
    public static var isEnabled: Bool {
        #if DEBUG
        return token != nil
        #else
        return false
        #endif
    }

    /// The injected JWT, or nil if none was provided / this is a RELEASE build.
    public static var token: String? {
        #if DEBUG
        for arg in CommandLine.arguments where arg.hasPrefix("--auto-login=") {
            let value = String(arg.dropFirst("--auto-login=".count))
            if !value.isEmpty {
                return value
            }
        }
        if let env = ProcessInfo.processInfo.environment["CLIPFIRE_AUTO_LOGIN_JWT"], !env.isEmpty {
            return env
        }
        return nil
        #else
        return nil
        #endif
    }
}
