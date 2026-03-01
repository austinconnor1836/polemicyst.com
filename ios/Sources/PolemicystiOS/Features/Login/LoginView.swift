import SwiftUI
import AuthenticationServices

public struct LoginView: View {
    @ObservedObject var authService: AuthService

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

                    Text("Polemicyst")
                        .font(.largeTitle.bold())
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text("Generate viral clips from your feeds")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer()

                // Sign-in buttons
                VStack(spacing: DesignTokens.spacing) {
                    // Sign in with Apple
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.email, .fullName]
                    } onCompletion: { result in
                        Task {
                            await authService.handleAppleSignIn(result: result)
                        }
                    }
                    .signInWithAppleButtonStyle(.white)
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
}
