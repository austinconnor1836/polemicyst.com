import SwiftUI
import UIKit
import AuthenticationServices

/// Presentation-context provider used by `ASAuthorizationController` to find the
/// window to anchor the Sign in with Apple sheet to.
///
/// On iPhone, SwiftUI's `SignInWithAppleButton` auto-wires this; on iPad
/// (especially iPadOS 26 with Stage Manager / multi-scene) the auto-wired
/// anchor can fail to resolve a key window and the sheet never presents,
/// surfacing as "An error message was displayed when we attempted to login
/// with Sign in with Apple."
///
/// This delegate explicitly anchors to the key window via the same helper
/// that `AuthService` uses for Google Sign-In, so both auth flows pin to
/// the same window.
final class AppleSignInPresentationContextProvider: NSObject, ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }

        // 1. Key window across all scenes.
        if let keyWindow = scenes.flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) {
            return keyWindow
        }

        // 2. Foreground-active scene's first window.
        if let window = scenes
            .first(where: { $0.activationState == .foregroundActive })?
            .windows
            .first {
            return window
        }

        // 3. Last resort: any window, otherwise a fresh ASPresentationAnchor.
        return scenes.flatMap({ $0.windows }).first ?? ASPresentationAnchor()
    }
}

public struct LoginView: View {
    @ObservedObject var authService: AuthService
    // Hold the delegate so it isn't deallocated while the Apple sign-in sheet is up.
    @State private var applePresentationProvider = AppleSignInPresentationContextProvider()
    @State private var appleAuthCoordinator: AppleAuthCoordinator?

    public init(authService: AuthService) {
        self.authService = authService
    }

    public var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: DesignTokens.largeSpacing * 2) {
                Spacer()

                // Logo / title
                VStack(spacing: DesignTokens.spacing) {
                    Image(systemName: "play.rectangle.fill")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 80, height: 80)
                        .foregroundStyle(DesignTokens.accent)

                    Text("Clipfire")
                        .font(.largeTitle.bold())
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text("Generate viral clips from your feeds")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer()

                // Sign-in buttons
                VStack(spacing: DesignTokens.spacing) {
                    // Sign in with Apple — UIKit-backed button so we can drive
                    // `ASAuthorizationController` ourselves and provide an explicit
                    // presentation anchor (required on iPad / iPadOS 26).
                    AppleSignInButton {
                        startAppleSignIn()
                    }
                    .frame(height: 50)
                    .cornerRadius(DesignTokens.cornerRadius)

                    // Google Sign-In button
                    Button {
                        Task {
                            await authService.signInWithGoogle()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "g.circle.fill")
                                .font(.title2)
                            Text("Sign in with Google")
                                .font(.body.weight(.medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.white)
                        .foregroundStyle(.black)
                        .cornerRadius(DesignTokens.cornerRadius)
                    }
                }
                .padding(.horizontal, 32)
                .disabled(authService.isLoading)

                if authService.isLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(DesignTokens.accent)
                }

                if let error = authService.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Spacer()
            }
        }
    }

    // MARK: - Apple Sign-In flow

    private func startAppleSignIn() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email, .fullName]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        let coordinator = AppleAuthCoordinator { result in
            Task {
                await authService.handleAppleSignIn(result: result)
            }
        }
        appleAuthCoordinator = coordinator
        controller.delegate = coordinator
        controller.presentationContextProvider = applePresentationProvider
        controller.performRequests()
    }
}

/// Delegate that bridges `ASAuthorizationController` callbacks into a Swift `Result`
/// the SwiftUI layer can hand to `AuthService.handleAppleSignIn`.
final class AppleAuthCoordinator: NSObject, ASAuthorizationControllerDelegate {
    private let completion: (Result<ASAuthorization, Error>) -> Void

    init(completion: @escaping (Result<ASAuthorization, Error>) -> Void) {
        self.completion = completion
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        completion(.success(authorization))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        completion(.failure(error))
    }
}

/// UIKit-backed Sign in with Apple button. We use this instead of SwiftUI's
/// `SignInWithAppleButton` so we can drive `ASAuthorizationController` ourselves
/// and supply an explicit `presentationContextProvider`, which iPad / iPadOS 26
/// needs to reliably present the sheet.
struct AppleSignInButton: UIViewRepresentable {
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(authorizationButtonType: .signIn, authorizationButtonStyle: .white)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: ASAuthorizationAppleIDButton, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    final class Coordinator: NSObject {
        let action: () -> Void
        init(action: @escaping () -> Void) {
            self.action = action
        }
        @objc func tapped() { action() }
    }
}
