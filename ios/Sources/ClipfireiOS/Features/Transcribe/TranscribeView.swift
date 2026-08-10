import SwiftUI
import UIKit

/// Standalone "Get Transcript" screen. Users paste a YouTube URL, tap the
/// button, and see the transcript text — without the mental model of
/// "importing a video to my library."
///
/// FULLY ON-DEVICE: captions are fetched client-side by `TranscribeViewModel`
/// via `YouTubeCaptionService`; there is no backend call, so this screen works
/// even when the monolith is hibernated. (The Import URL flow in `AddVideoView`
/// is separate and still hits the backend.)
public struct TranscribeView: View {
    @StateObject private var viewModel = TranscribeViewModel()
    @AppStorage("transcribe.lastURL") private var storedURL: String = ""
    #if DEBUG
    @State private var didAutoTrigger = false
    #endif

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: DesignTokens.largeSpacing) {
                    header
                    inputCard
                    stateContainer
                }
                .padding(DesignTokens.spacing)
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Transcribe")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .onAppear {
                if viewModel.urlText.isEmpty, !storedURL.isEmpty {
                    viewModel.urlText = storedURL
                }
                #if DEBUG
                // Agent/CI hook: when `UITEST_TRANSCRIBE_URL` is set (via
                // `SIMCTL_CHILD_UITEST_TRANSCRIBE_URL=…` at launch), auto-fill
                // the URL field and fire the fetch, so the screen can be driven
                // and screenshotted without UI automation. DEBUG-only dead code
                // in Release.
                if !didAutoTrigger,
                   let autoURL = ProcessInfo.processInfo.environment["UITEST_TRANSCRIBE_URL"],
                   !autoURL.isEmpty {
                    didAutoTrigger = true
                    viewModel.urlText = autoURL
                    viewModel.submit()
                }
                #endif
            }
            .onChange(of: viewModel.urlText) { _, newValue in
                storedURL = newValue
            }
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(spacing: 6) {
            Image(systemName: "waveform")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.accent)
                .accessibilityHidden(true)
            Text("Get a transcript")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(DesignTokens.textPrimary)
            Text("Paste a YouTube video or Shorts URL to get its transcript.")
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, DesignTokens.spacing)
    }

    private var inputCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            TextField("https://…", text: $viewModel.urlText)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .disabled(isLoading)

            if let hint = viewModel.urlValidationHint {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Button {
                viewModel.submit()
            } label: {
                HStack(spacing: 8) {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                            .controlSize(.small)
                    }
                    Text(primaryButtonLabel)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(DesignTokens.accent)
            .disabled(!viewModel.canSubmit || isLoading)
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    @ViewBuilder
    private var stateContainer: some View {
        switch viewModel.state {
        case .idle:
            emptyState
        case .loading(let stage):
            loadingState(stage: stage)
        case .ready(let transcript):
            resultState(transcript: transcript)
        case .failed(let message):
            errorState(message: message)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "text.bubble")
                .font(.system(size: 28))
                .foregroundStyle(DesignTokens.muted)
                .accessibilityHidden(true)
            Text("Your transcript will appear here.")
                .font(.footnote)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DesignTokens.largeSpacing * 2)
    }

    private func loadingState(stage: String) -> some View {
        VStack(spacing: DesignTokens.spacing) {
            ProgressView()
                .controlSize(.large)
            Text(stage)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(DesignTokens.textPrimary)
            Text("This usually takes 30–90 seconds.")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DesignTokens.largeSpacing * 2)
    }

    private func resultState(transcript: String) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack(spacing: DesignTokens.spacing) {
                Button {
                    UIPasteboard.general.string = transcript
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                .buttonStyle(.bordered)
                .tint(DesignTokens.accent)

                ShareLink(item: transcript) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                .buttonStyle(.bordered)
                .tint(DesignTokens.accent)

                Spacer()
            }

            Text(transcript)
                .font(.body)
                .lineSpacing(4)
                .foregroundStyle(DesignTokens.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    private func errorState(message: String) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textPrimary)
            }

            Button {
                viewModel.reset()
                viewModel.submit()
            } label: {
                Text("Try again")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
            .tint(DesignTokens.accent)
            .disabled(!viewModel.canSubmit)
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }

    // MARK: - Derived state

    private var isLoading: Bool {
        if case .loading = viewModel.state { return true }
        return false
    }

    private var primaryButtonLabel: String {
        switch viewModel.state {
        case .loading(let stage): return stage
        case .ready: return "Transcribe another"
        default: return "Get Transcript"
        }
    }
}
