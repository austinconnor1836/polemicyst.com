import Foundation

/// User-friendly error translation for the `POST /api/uploads/from-url`
/// endpoint (shared between `AddVideoView`'s Import URL flow and
/// `TranscribeView`'s standalone transcript flow).
///
/// Kept in one place so the copy stays consistent — both surfaces are hitting
/// the same backend and should present the same failure vocabulary.
public enum URLImportErrorMessage {
    public static func describe(_ error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .statusCode(let code):
                switch code {
                case 400: return "That URL isn't recognized. Try a YouTube or Instagram Reel link."
                case 401: return "Authentication expired. Please sign out and sign back in."
                case 413: return "File is too large for the server to accept."
                case 500: return "Server error. Please try again later."
                case 503: return "Instagram integration is temporarily unavailable. Try again later or import from a different platform."
                default: return "Server returned HTTP \(code)."
                }
            case .serverError(let code, let response):
                if code == 503 {
                    return "Instagram integration is temporarily unavailable. Try again later or import from a different platform."
                }
                if code == 500 && response.error.lowercased().contains("instagram") {
                    return "Instagram couldn't complete the request right now. Try again shortly."
                }
                if code == 400 {
                    return "That URL isn't recognized. Try a YouTube or Instagram Reel link."
                }
                return "Server error (\(code)): \(response.error)"
            }
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorNotConnectedToInternet:
                return "No internet connection."
            case NSURLErrorTimedOut:
                return "Request timed out. Check your connection and try again."
            case NSURLErrorNetworkConnectionLost:
                return "Connection lost. Please try again."
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted:
                return "Secure connection failed."
            default:
                return "Network error: \(error.localizedDescription)"
            }
        }

        return error.localizedDescription
    }
}
