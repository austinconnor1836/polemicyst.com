import SwiftUI
import AuthenticationServices

enum FacebookConnectionState {
    case idle
    case authenticating
    case exchangingToken
    case connected(String)
    case error(String)
}

@MainActor
final class FacebookConnectionViewModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var state: FacebookConnectionState = .idle

    private let api: APIClient
    private let facebookAppId: String

    init(api: APIClient) {
        self.api = api
        self.facebookAppId = Bundle.main.object(forInfoDictionaryKey: "FacebookAppID") as? String ?? ""
        super.init()
    }

    func authenticate() async {
        state = .authenticating

        let scopes = "pages_show_list,pages_manage_posts,publish_video"
        let redirectScheme = "fb\(facebookAppId)"
        let redirectURI = "\(redirectScheme)://authorize"

        var components = URLComponents(string: "https://www.facebook.com/v19.0/dialog/oauth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: facebookAppId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: scopes),
            URLQueryItem(name: "response_type", value: "token"),
            URLQueryItem(name: "auth_type", value: "rerequest"),
        ]

        guard let authURL = components.url else {
            state = .error("Failed to build Facebook auth URL.")
            return
        }

        do {
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: redirectScheme
                ) { url, error in
                    if let error = error {
                        continuation.resume(throwing: error)
                    } else if let url = url {
                        continuation.resume(returning: url)
                    } else {
                        continuation.resume(throwing: NSError(domain: "FacebookAuth", code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "No callback URL received"]))
                    }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                session.start()
            }

            // Parse access_token from fragment: fb123://authorize#access_token=...&...
            guard let fragment = callbackURL.fragment,
                  let token = parseAccessToken(from: fragment) else {
                state = .error("Could not extract access token from Facebook response.")
                return
            }

            state = .exchangingToken
            let response = try await api.exchangeFacebookToken(token)

            if response.success {
                state = .connected(response.name ?? "Facebook Account")
            } else {
                state = .error("Failed to link Facebook account.")
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            state = .idle
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private func parseAccessToken(from fragment: String) -> String? {
        let pairs = fragment.split(separator: "&")
        for pair in pairs {
            let kv = pair.split(separator: "=", maxSplits: 1)
            if kv.count == 2 && kv[0] == "access_token" {
                return String(kv[1])
            }
        }
        return nil
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first?.windows.first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}

struct FacebookConnectionView: View {
    @StateObject private var viewModel: FacebookConnectionViewModel
    @Environment(\.dismiss) private var dismiss
    let onConnected: () -> Void

    init(api: APIClient, onConnected: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: FacebookConnectionViewModel(api: api))
        self.onConnected = onConnected
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                switch viewModel.state {
                case .idle:
                    idleView
                case .authenticating, .exchangingToken:
                    loadingView
                case .connected(let name):
                    connectedView(name)
                case .error(let message):
                    errorView(message)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Connect Facebook")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    @ViewBuilder
    private var idleView: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "person.2.fill")
                .font(.system(size: 48))
                .foregroundStyle(.blue)

            Text("Connect Facebook Account")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Sign in with Facebook to connect your account for publishing to Pages.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                Task { await viewModel.authenticate() }
            } label: {
                Label("Sign in with Facebook", systemImage: "person.2.fill")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .padding(.horizontal, DesignTokens.largeSpacing)
        }
        .padding()
    }

    @ViewBuilder
    private var loadingView: some View {
        VStack(spacing: DesignTokens.spacing) {
            ProgressView()
                .scaleEffect(1.2)

            Text(loadingMessage)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .padding()
    }

    private var loadingMessage: String {
        switch viewModel.state {
        case .authenticating: return "Signing in with Facebook..."
        case .exchangingToken: return "Linking account..."
        default: return "Loading..."
        }
    }

    @ViewBuilder
    private func connectedView(_ name: String) -> some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.green)

            Text("Connected!")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)

            Text(name)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)

            VStack(spacing: DesignTokens.spacing) {
                Button {
                    Task { await viewModel.authenticate() }
                } label: {
                    Label("Connect Another Account", systemImage: "plus.circle")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)

                Button {
                    onConnected()
                    dismiss()
                } label: {
                    Text("Done")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal, DesignTokens.largeSpacing)
        }
        .padding()
    }

    @ViewBuilder
    private func errorView(_ message: String) -> some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.yellow)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                Task { await viewModel.authenticate() }
            } label: {
                Label("Try Again", systemImage: "arrow.clockwise")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.accent)
            .padding(.horizontal, DesignTokens.largeSpacing)
        }
        .padding()
    }
}
