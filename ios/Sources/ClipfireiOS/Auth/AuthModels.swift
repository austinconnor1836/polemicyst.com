import Foundation

/// Request body for `POST /api/auth/mobile/google`
public struct MobileGoogleAuthRequest: Encodable {
    public let idToken: String
    public let serverAuthCode: String?

    public init(idToken: String, serverAuthCode: String? = nil) {
        self.idToken = idToken
        self.serverAuthCode = serverAuthCode
    }
}

/// Request body for `POST /api/auth/mobile/google/exchange-code`
public struct ExchangeCodeRequest: Encodable {
    public let serverAuthCode: String

    public init(serverAuthCode: String) {
        self.serverAuthCode = serverAuthCode
    }
}

/// Response from exchange-code endpoint
public struct ExchangeCodeResponse: Decodable {
    public let success: Bool
}

/// Tracks which auth provider the user signed in with
public enum AuthProvider: String {
    case google
    case apple
    case unknown
}

/// Request body for `POST /api/auth/mobile/apple`
public struct MobileAppleAuthRequest: Encodable {
    public let identityToken: String
    public let fullName: AppleFullName?

    public init(identityToken: String, fullName: AppleFullName? = nil) {
        self.identityToken = identityToken
        self.fullName = fullName
    }
}

public struct AppleFullName: Encodable {
    public let givenName: String?
    public let familyName: String?

    public init(givenName: String?, familyName: String?) {
        self.givenName = givenName
        self.familyName = familyName
    }
}

/// Response from Facebook token exchange
public struct FacebookTokenResponse: Decodable {
    public let success: Bool
    public let name: String?
}

/// Response from mobile auth endpoints
public struct MobileAuthResponse: Decodable {
    public let token: String
    public let user: AuthUser
}

public struct AuthUser: Decodable {
    public let id: String
    public let email: String
    public let name: String?
    public let image: String?
}
