import Foundation

/// Request body for `POST /api/auth/mobile/google`
public struct MobileGoogleAuthRequest: Encodable {
    public let idToken: String

    public init(idToken: String) {
        self.idToken = idToken
    }
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
