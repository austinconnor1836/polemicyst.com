import SwiftUI

struct CompositionPublishSection: View {
    let composition: Composition
    let api: APIClient

    @State private var platforms: [VideoPlatformInfo] = []
    @State private var defaults: Set<String> = []
    @State private var selectedPlatforms: Set<String> = []
    @State private var title = ""
    @State private var description = ""
    @State private var isLoadingPlatforms = true
    @State private var isPublishing = false
    @State private var publishResult: PublishResponse?
    @State private var errorMessage: String?

    private var hasCompletedOutputs: Bool {
        composition.outputs?.contains(where: { $0.status == "completed" }) ?? false
    }

    var body: some View {
        if hasCompletedOutputs {
            VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                Text("Publish")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                if isLoadingPlatforms {
                    HStack {
                        ProgressView().scaleEffect(0.8)
                        Text("Loading platforms...")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                } else {
                    // Platform checkboxes
                    platformPicker

                    // Title & description
                    metadataFields

                    // Publish button
                    publishButton

                    // Results
                    if let result = publishResult {
                        publishResults(result)
                    }

                    if let err = errorMessage {
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
            .task {
                await loadPlatforms()
                title = composition.title
            }
        }
    }

    // MARK: - Platform picker

    @ViewBuilder
    private var platformPicker: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Platforms")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            ForEach(platforms) { platform in
                Button {
                    togglePlatform(platform.platform)
                } label: {
                    HStack {
                        Image(systemName: platformIcon(platform.platform))
                            .font(.subheadline)
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 1) {
                            Text(platform.displayName)
                                .font(.subheadline)
                                .foregroundStyle(DesignTokens.textPrimary)

                            if !platform.connected {
                                Text("Not connected")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        }

                        Spacer()

                        Image(systemName: selectedPlatforms.contains(platform.platform) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedPlatforms.contains(platform.platform) ? DesignTokens.accent : DesignTokens.muted)
                    }
                    .padding(.vertical, 4)
                }
                .disabled(!platform.connected)
                .opacity(platform.connected ? 1 : 0.5)
            }
        }
    }

    // MARK: - Metadata

    @ViewBuilder
    private var metadataFields: some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            TextField("Title", text: $title)
                .textFieldStyle(.roundedBorder)
                .font(.subheadline)

            TextField("Description", text: $description, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .font(.subheadline)
                .lineLimit(3...6)
        }
    }

    // MARK: - Publish button

    @ViewBuilder
    private var publishButton: some View {
        Button {
            Task { await publish() }
        } label: {
            HStack {
                if isPublishing {
                    ProgressView().scaleEffect(0.8)
                }
                Text(isPublishing ? "Publishing..." : "Publish")
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding()
            .background(canPublish ? DesignTokens.accent : DesignTokens.muted.opacity(0.3))
            .foregroundStyle(canPublish ? DesignTokens.background : DesignTokens.muted)
            .cornerRadius(DesignTokens.cornerRadius)
        }
        .disabled(!canPublish)
    }

    private var canPublish: Bool {
        !selectedPlatforms.isEmpty && !description.trimmingCharacters(in: .whitespaces).isEmpty && !isPublishing
    }

    // MARK: - Results

    @ViewBuilder
    private func publishResults(_ result: PublishResponse) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Results")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                statusBadge(result.status)
            }

            ForEach(result.results) { r in
                HStack {
                    Image(systemName: r.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(r.success ? .green : .red)

                    Text(r.platform.capitalized)
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    if let url = r.platformUrl, let link = URL(string: url) {
                        Link("View", destination: link)
                            .font(.caption)
                            .foregroundStyle(DesignTokens.accent)
                    }

                    if let err = r.error {
                        Text(err)
                            .font(.caption2)
                            .foregroundStyle(.red)
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(DesignTokens.smallSpacing)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    @ViewBuilder
    private func statusBadge(_ status: String) -> some View {
        let (label, color): (String, Color) = switch status {
        case "completed": ("All Published", .green)
        case "partial": ("Partial", .orange)
        case "failed": ("Failed", .red)
        default: ("Unknown", DesignTokens.muted)
        }

        Text(label)
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .cornerRadius(4)
    }

    // MARK: - Helpers

    private func platformIcon(_ platform: String) -> String {
        switch platform {
        case "youtube": return "play.rectangle"
        case "instagram": return "camera"
        case "facebook": return "person.2"
        case "twitter": return "bubble.left"
        case "bluesky": return "cloud"
        case "threads": return "at"
        default: return "globe"
        }
    }

    private func togglePlatform(_ id: String) {
        if selectedPlatforms.contains(id) {
            selectedPlatforms.remove(id)
        } else {
            selectedPlatforms.insert(id)
        }
    }

    // MARK: - Actions

    private func loadPlatforms() async {
        isLoadingPlatforms = true
        defer { isLoadingPlatforms = false }
        do {
            let response = try await api.fetchPublishPlatforms(compositionId: composition.id)
            platforms = response.platforms
            if let d = response.defaults {
                selectedPlatforms = Set(d)
            }
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load platforms"
        }
    }

    private func publish() async {
        isPublishing = true
        publishResult = nil
        errorMessage = nil
        defer { isPublishing = false }
        do {
            publishResult = try await api.publishComposition(
                compositionId: composition.id,
                body: PublishRequest(
                    platforms: Array(selectedPlatforms),
                    title: title.isEmpty ? nil : title,
                    description: description
                )
            )
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = error.localizedDescription
        }
    }
}
