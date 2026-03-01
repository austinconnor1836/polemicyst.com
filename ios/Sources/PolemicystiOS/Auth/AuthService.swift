#if canImport(UIKit)
import SwiftUI
import UIKit
import AuthenticationServices
import GoogleSignIn

@MainActor
public final class AuthService: ObservableObject {
    @Published public private(set) var isAuthenticated = false
    @Published public private(set) var currentUser: AuthUser?
    @Published public var errorMessage: String?
    @Published public var isLoading = false

    private let api: APIClient
    private let tokenStorage: TokenStorage

    public init(api: APIClient, tokenStorage: TokenStorage) {
        self.api = api
        self.tokenStorage = tokenStorage
        self.isAuthenticated = tokenStorage.isLoggedIn
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

            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: rootVC)

            guard let idToken = result.user.idToken?.tokenString else {
                errorMessage = "Google Sign-In did not return an ID token"
                return
            }

            let response = try await api.authenticateWithGoogle(idToken: idToken)
            tokenStorage.saveToken(response.token)
            currentUser = response.user
            isAuthenticated = true
        } catch let error as GIDSignInError where error.code == .canceled {
            // User cancelled — no error message needed
        } catch {
            errorMessage = "Google Sign-In failed: \(error.localizedDescription)"
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
        isAuthenticated = false
    }
}
#endif
