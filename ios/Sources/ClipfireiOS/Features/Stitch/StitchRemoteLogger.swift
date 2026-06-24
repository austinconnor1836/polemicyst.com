import Foundation

/// Fire-and-forget POST of Stitch render diagnostics to the local Mac backend at
/// `AppConfiguration.apiBaseURL`. The backend writes each entry to
/// `tmp/stitch-debug.log` so Claude (or the developer) can `cat` it to see exactly
/// what the device hit without re-typing the in-app alert.
///
/// Uses a custom URLSession with `InsecureSessionDelegate` because the dev backend
/// runs `next dev --experimental-https` with a mkcert self-signed certificate.
/// `NSAllowsArbitraryLoads` doesn't help here — iOS still refuses self-signed certs
/// at the URLSession trust-evaluation layer, so we have to explicitly accept the
/// server trust in `urlSession(_:didReceive:completionHandler:)`.
enum StitchRemoteLogger {
    /// Shared session that trusts the local dev server's self-signed cert.
    /// Init once — building a new session per log call would leak delegates.
    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 10
        cfg.timeoutIntervalForResource = 15
        return URLSession(configuration: cfg, delegate: InsecureSessionDelegate(), delegateQueue: nil)
    }()

    /// Top-level entry point — payload is whatever metadata you want to capture.
    /// Errors here are swallowed; this is best-effort diagnostics, not critical path.
    static func log(_ kind: String, payload: [String: Any]) {
        let url = AppConfiguration.apiBaseURL.appendingPathComponent("api/debug/stitch-log")
        var body: [String: Any] = ["kind": kind]
        body.merge(payload) { _, new in new }

        guard let data = try? JSONSerialization.data(withJSONObject: body, options: []) else {
            NSLog("[Stitch][RemoteLogger] failed to serialize payload")
            return
        }

        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data

        session.dataTask(with: req) { _, response, error in
            if let error {
                NSLog("[Stitch][RemoteLogger] POST failed: %@", error.localizedDescription)
                return
            }
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                NSLog("[Stitch][RemoteLogger] POST got status %d", http.statusCode)
            }
        }.resume()
    }

    /// Trusts whatever cert the local dev backend presents. Only safe because
    /// this logger ONLY ever posts to `AppConfiguration.apiBaseURL`, which on Debug
    /// builds points at the developer's Mac (`https://100.124.11.69:3000`). Don't
    /// reuse this delegate for any user-facing network call.
    private final class InsecureSessionDelegate: NSObject, URLSessionDelegate {
        func urlSession(
            _ session: URLSession,
            didReceive challenge: URLAuthenticationChallenge,
            completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
        ) {
            guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
                  let trust = challenge.protectionSpace.serverTrust else {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            completionHandler(.useCredential, URLCredential(trust: trust))
        }
    }

    /// Helper that flattens an NSError into a single dict suitable for posting.
    static func flatten(_ error: Error) -> [String: Any] {
        let ns = error as NSError
        var out: [String: Any] = [
            "domain": ns.domain,
            "code": ns.code,
            "description": ns.localizedDescription,
        ]
        if let reason = ns.localizedFailureReason { out["reason"] = reason }
        if let recovery = ns.localizedRecoverySuggestion { out["recovery"] = recovery }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            out["underlying"] = [
                "domain": underlying.domain,
                "code": underlying.code,
                "description": underlying.localizedDescription,
            ]
        }
        return out
    }
}
