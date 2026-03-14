import SwiftUI

public struct ComposePostView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var content = ""
    @State private var selectedPlatforms: Set<String>
    @State private var isPublishing = false
    @State private var errorMessage: String?
    @State private var showErrorAlert = false
    @State private var showSuccess = false
    @State private var characterCount = 0

    private let api: APIClient
    private let platforms: [SocialPlatformInfo]
    private let onPostCreated: () -> Void

    private let twitterLimit = 280
    private let blueskyLimit = 300

    public init(
        api: APIClient,
        platforms: [SocialPlatformInfo],
        defaultPlatforms: Set<String>,
        onPostCreated: @escaping () -> Void
    ) {
        self.api = api
        self.platforms = platforms
        self.onPostCreated = onPostCreated
        _selectedPlatforms = State(initialValue: defaultPlatforms)
    }

    private var effectiveCharLimit: Int? {
        var limit: Int? = nil
        for p in selectedPlatforms {
            switch p {
            case "twitter": limit = min(limit ?? twitterLimit, twitterLimit)
            case "bluesky": limit = min(limit ?? blueskyLimit, blueskyLimit)
            default: break
            }
        }
        return limit
    }

    private var isOverLimit: Bool {
        guard let limit = effectiveCharLimit else { return false }
        return content.count > limit
    }

    private var canPost: Bool {
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !selectedPlatforms.isEmpty
        && !isPublishing
        && !isOverLimit
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: DesignTokens.largeSpacing) {
                    composeSection
                    platformSelector
                }
                .padding(DesignTokens.largeSpacing)
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("New Post")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isPublishing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await publish() }
                    } label: {
                        if isPublishing {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .scaleEffect(0.8)
                        } else {
                            Text("Post")
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(!canPost)
                }
            }
            .onChange(of: viewModel_errorMessage) { _, newValue in showErrorAlert = newValue != nil }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
        .interactiveDismissDisabled(isPublishing)
    }

    private var viewModel_errorMessage: String? { errorMessage }

    private var composeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                if content.isEmpty {
                    Text("What's on your mind?")
                        .foregroundStyle(DesignTokens.muted)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 8)
                }
                TextEditor(text: $content)
                    .scrollContentBackground(.hidden)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(minHeight: 120)
                    .onChange(of: content) { _, _ in
                        characterCount = content.count
                    }
            }
            .padding(12)
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)

            HStack {
                Spacer()
                if let limit = effectiveCharLimit {
                    Text("\(content.count)/\(limit)")
                        .font(.caption)
                        .foregroundStyle(isOverLimit ? .red : DesignTokens.muted)
                } else {
                    Text("\(content.count)")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
        }
    }

    private var platformSelector: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Post to")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if platforms.isEmpty {
                Text("No social platforms available.\nConnect accounts in Settings.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DesignTokens.largeSpacing)
            } else {
                ForEach(platforms) { platform in
                    PlatformToggleRow(
                        platform: platform,
                        isSelected: selectedPlatforms.contains(platform.platform),
                        onToggle: {
                            if selectedPlatforms.contains(platform.platform) {
                                selectedPlatforms.remove(platform.platform)
                            } else {
                                selectedPlatforms.insert(platform.platform)
                            }
                        }
                    )
                }
            }
        }
    }

    private func publish() async {
        isPublishing = true
        defer { isPublishing = false }
        do {
            let request = CreateSocialPostRequest(
                content: content.trimmingCharacters(in: .whitespacesAndNewlines),
                platforms: Array(selectedPlatforms)
            )
            let _ = try await api.createSocialPost(request)
            onPostCreated()
            dismiss()
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to publish: \(error.localizedDescription)"
        }
    }
}

// MARK: - Platform Toggle Row

struct PlatformToggleRow: View {
    let platform: SocialPlatformInfo
    let isSelected: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Image(systemName: platformIcon)
                    .font(.system(size: 20))
                    .foregroundStyle(platformColor)
                    .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 2) {
                    Text(platform.displayName)
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.textPrimary)

                    if !platform.connected {
                        Text("Not connected")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? DesignTokens.accent : DesignTokens.muted.opacity(0.5))
            }
            .padding(12)
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                    .stroke(isSelected ? DesignTokens.accent.opacity(0.4) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var platformIcon: String {
        switch platform.platform {
        case "twitter": return "at"
        case "facebook": return "person.2.fill"
        case "bluesky": return "cloud.fill"
        case "threads": return "at.circle.fill"
        default: return "link"
        }
    }

    private var platformColor: Color {
        switch platform.platform {
        case "twitter": return Color(red: 0.11, green: 0.63, blue: 0.95)
        case "facebook": return Color(red: 0.23, green: 0.35, blue: 0.60)
        case "bluesky": return Color(red: 0.0, green: 0.52, blue: 1.0)
        case "threads": return DesignTokens.textPrimary
        default: return DesignTokens.muted
        }
    }
}
