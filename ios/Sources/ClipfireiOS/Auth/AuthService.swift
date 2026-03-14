import SwiftUI
import UIKit
import AuthenticationServices
import GoogleSignIn

public enum YouTubeAuthError: Error, LocalizedError {
    case noCurrentUser
    case noRootViewController
    case scopeRequestFailed(Error)
    case noServerAuthCode

    public var errorDescription: String? {
        switch self {
        case .noCurrentUser:
            return "Not signed in with Google"
        case .noRootViewController:
            return "Unable to find root view controller"
        case .scopeRequestFailed(let error):
            return "YouTube authorization failed: \(error.localizedDescription)"
        case .noServerAuthCode:
            return "No server auth code returned"
        }
    }
}

@MainActor
public final class AuthService: ObservableObject {
    @Published public private(set) var isAuthenticated = false
    @Published public private(set) var currentUser: AuthUser?
    @Published public private(set) var authProvider: AuthProvider = .unknown
    @Published public var errorMessage: String?
    @Published public var isLoading = false

    private let api: APIClient
    private let tokenStorage: TokenStorage

    public init(api: APIClient, tokenStorage: TokenStorage) {
        self.api = api
        self.tokenStorage = tokenStorage
        self.isAuthenticated = tokenStorage.isLoggedIn

        // Configure GIDSignIn with serverClientID for auth code exchange
        if let serverClientID = AppConfiguration.googleServerClientID {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(
                clientID: Bundle.main.infoDictionary?["GIDClientID"] as? String ?? "",
                serverClientID: serverClientID
            )
        }
    }

    // MARK: - Google Sign-In

    public func signInWithGoogle() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            guard let windowScene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene }).first,
                  let rootVC = windowScene.windows.first?.rootViewController else {
                errorMessage = "Unable to find root view controller"
                return
            }

            let result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: rootVC,
                hint: nil,
                additionalScopes: ["https://www.googleapis.com/auth/youtube.readonly"]
            )

            guard let idToken = result.user.idToken?.tokenString else {
                errorMessage = "Google Sign-In did not return an ID token"
                return
            }

            let serverAuthCode = result.serverAuthCode

            let response = try await api.authenticateWithGoogle(
                idToken: idToken,
                serverAuthCode: serverAuthCode
            )
            tokenStorage.saveToken(response.token)
            currentUser = response.user
            authProvider = .google
            isAuthenticated = true
        } catch let error as GIDSignInError where error.code == .canceled {
            // User cancelled — no error message needed
        } catch {
            errorMessage = "Google Sign-In failed: \(error.localizedDescription)"
        }
    }

    // MARK: - YouTube Scope

    /// Request YouTube read-only scope via Google OAuth.
    /// If the user already has a Google session, uses incremental authorization (addScopes).
    /// Otherwise, performs a fresh Google Sign-In with YouTube scopes included.
    /// Returns the server auth code to exchange on the backend.
    public func requestYouTubeScope() async throws -> String {
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first,
              let rootVC = windowScene.windows.first?.rootViewController else {
            throw YouTubeAuthError.noRootViewController
        }

        let scopes = ["https://www.googleapis.com/auth/youtube.readonly"]

        do {
            if let currentUser = GIDSignIn.sharedInstance.currentUser {
                // Already have a Google session — request additional YouTube scope
                let result = try await currentUser.addScopes(scopes, presenting: rootVC)

                guard let serverAuthCode = result.serverAuthCode else {
                    throw YouTubeAuthError.noServerAuthCode
                }
                return serverAuthCode
            } else {
                // No Google session (user signed in with Apple, etc.) — do a fresh Google sign-in
                let result = try await GIDSignIn.sharedInstance.signIn(
                    withPresenting: rootVC,
                    hint: nil,
                    additionalScopes: scopes
                )

                guard let serverAuthCode = result.serverAuthCode else {
                    throw YouTubeAuthError.noServerAuthCode
                }
                return serverAuthCode
            }
        } catch let error as YouTubeAuthError {
            throw error
        } catch let error as GIDSignInError where error.code == .canceled {
            throw YouTubeAuthError.scopeRequestFailed(error)
        } catch {
            throw YouTubeAuthError.scopeRequestFailed(error)
        }
    }

    // MARK: - Apple Sign-In

    public func handleAppleSignIn(result: Result<ASAuthorization, Error>) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let identityTokenData = credential.identityToken,
                  let identityToken = String(data: identityTokenData, encoding: .utf8) else {
                errorMessage = "Unable to extract Apple identity token"
                return
            }

            let fullName: AppleFullName?
            if let nameComponents = credential.fullName,
               (nameComponents.givenName != nil || nameComponents.familyName != nil) {
                fullName = AppleFullName(
                    givenName: nameComponents.givenName,
                    familyName: nameComponents.familyName
                )
            } else {
                fullName = nil
            }

            do {
                let response = try await api.authenticateWithApple(
                    identityToken: identityToken,
                    fullName: fullName
                )
                tokenStorage.saveToken(response.token)
                currentUser = response.user
                authProvider = .apple
                isAuthenticated = true
            } catch {
                errorMessage = "Apple Sign-In failed: \(error.localizedDescription)"
            }

        case .failure(let error as ASAuthorizationError) where error.code == .canceled:
            // User cancelled — no error message needed
            break
        case .failure(let error):
            errorMessage = "Apple Sign-In failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Sign Out

    public func signOut() {
        tokenStorage.deleteToken()
        GIDSignIn.sharedInstance.signOut()
        currentUser = nil
        authProvider = .unknown
        isAuthenticated = false
    }
}
