import SwiftUI
import WebKit

// MARK: - ViewModel

@MainActor
final class SubstackConnectionViewModel: ObservableObject {
    enum Step {
        case webLogin
        case connecting
    }

    @Published var step: Step = .webLogin
    @Published var isConnecting = false
    @Published var errorMessage: String?

    let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    /// Send the cookie to the backend — it discovers the subdomain server-side.
    func connectWithCookie(_ cookie: String) async -> PublishingAccount? {
        step = .connecting
        isConnecting = true
        errorMessage = nil
        defer { isConnecting = false }

        do {
            // Backend discovers the subdomain server-side (no CSRF issues there)
            let account = try await api.connectPublishingAccount(
                platform: "substack",
                cookie: cookie
            )
            return account
        } catch {
            errorMessage = error.localizedDescription
            step = .webLogin
            return nil
        }
    }
}

// MARK: - View

public struct SubstackConnectionView: View {
    @StateObject private var viewModel: SubstackConnectionViewModel
    @Environment(\.dismiss) private var dismiss
    private let onConnected: (PublishingAccount) -> Void

    public init(api: APIClient, onConnected: @escaping (PublishingAccount) -> Void) {
        _viewModel = StateObject(wrappedValue: SubstackConnectionViewModel(api: api))
        self.onConnected = onConnected
    }

    public var body: some View {
        NavigationStack {
            Group {
                switch viewModel.step {
                case .webLogin:
                    webLoginStep
                case .connecting:
                    connectingStep
                }
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    // MARK: Step 1 - Web Login

    private var webLoginStep: some View {
        VStack(spacing: 0) {
            if let error = viewModel.errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color.red.opacity(0.1))
            }

            SubstackWebView { cookie in
                Task {
                    if let account = await viewModel.connectWithCookie(cookie) {
                        onConnected(account)
                        dismiss()
                    }
                }
            }
        }
        .navigationTitle("Sign in to Substack")
    }

    // MARK: Connecting

    private var connectingStep: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Spacer()
            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.accent)
            Text("Connecting your Substack account...")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.muted)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .navigationTitle("Substack")
    }
}

// MARK: - WKWebView Wrapper

struct SubstackWebView: UIViewRepresentable {
    let onCookieFound: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCookieFound: onCookieFound)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground

        if let url = URL(string: "https://substack.com/sign-in") {
            webView.load(URLRequest(url: url))
        }

        context.coordinator.startPolling(webView: webView)

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.stopPolling()
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let onCookieFound: (String) -> Void
        private var hasFoundCookie = false
        private var pollTimer: Timer?

        init(onCookieFound: @escaping (String) -> Void) {
            self.onCookieFound = onCookieFound
        }

        func startPolling(webView: WKWebView) {
            pollTimer?.invalidate()
            let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self, weak webView] _ in
                guard let webView = webView else { return }
                self?.checkForCookie(in: webView)
            }
            RunLoop.main.add(timer, forMode: .common)
            pollTimer = timer
        }

        func stopPolling() {
            pollTimer?.invalidate()
            pollTimer = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            checkForCookie(in: webView)
        }

        private func checkForCookie(in webView: WKWebView) {
            guard !hasFoundCookie else { return }

            // Substack sets a partial substack.sid after email entry (before full auth).
            // Only accept the cookie once the user has left the sign-in page.
            let currentURL = webView.url?.absoluteString.lowercased() ?? ""
            if currentURL.isEmpty || currentURL.contains("/sign-in") || currentURL.contains("/sign-up") {
                return
            }

            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self = self, !self.hasFoundCookie else { return }

                // Check that a session cookie exists
                let hasSession = cookies.contains(where: {
                    ($0.name == "substack.sid" || $0.name == "connect.sid") && $0.domain.contains("substack")
                })

                if hasSession {
                    // Send ALL substack cookies — the backend needs the full set for API calls
                    let substackCookies = cookies.filter { $0.domain.contains("substack") }
                    let cookieString = substackCookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                    print("[SubstackAuth] Session cookie found on \(currentURL), sending \(substackCookies.count) cookies")
                    self.hasFoundCookie = true
                    self.stopPolling()
                    DispatchQueue.main.async {
                        self.onCookieFound(cookieString)
                    }
                }
            }
        }
    }
}
