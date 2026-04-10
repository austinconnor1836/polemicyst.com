import SwiftUI

struct CompositionThumbnailSection: View {
    let composition: Composition
    let api: APIClient

    @State private var thumbnails: [CompositionThumbnail] = []
    @State private var isLoading = true
    @State private var isRegenerating = false
    @State private var errorMessage: String?

    private var hasOutputs: Bool {
        composition.outputs?.contains(where: { $0.status == "completed" }) ?? false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Thumbnails")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()

                if !thumbnails.isEmpty {
                    Button {
                        Task { await regenerate() }
                    } label: {
                        if isRegenerating {
                            ProgressView().scaleEffect(0.7)
                        } else {
                            Label("Regenerate", systemImage: "arrow.clockwise")
                                .font(.caption)
                        }
                    }
                    .disabled(isRegenerating)
                    .foregroundStyle(DesignTokens.accent)
                }
            }

            if !hasOutputs {
                HStack(spacing: 8) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                    Text("Thumbnails are generated after rendering completes.")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else if isLoading {
                HStack {
                    ProgressView().scaleEffect(0.8)
                    Text("Loading thumbnails...")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else if thumbnails.isEmpty {
                VStack(spacing: 8) {
                    Text("No thumbnails yet")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)

                    Button {
                        Task { await regenerate() }
                    } label: {
                        HStack {
                            if isRegenerating {
                                ProgressView().scaleEffect(0.8)
                            }
                            Text(isRegenerating ? "Generating..." : "Generate Thumbnails")
                        }
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(DesignTokens.accent.opacity(0.15))
                        .foregroundStyle(DesignTokens.accent)
                        .cornerRadius(DesignTokens.cornerRadius)
                    }
                    .disabled(isRegenerating)
                }
            } else {
                thumbnailGrid
            }

            if let err = errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
        .task {
            guard hasOutputs else { isLoading = false; return }
            await loadThumbnails()
        }
    }

    // MARK: - Thumbnail grid

    @ViewBuilder
    private var thumbnailGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 120), spacing: 8)]

        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(thumbnails) { thumb in
                thumbnailCard(thumb)
            }
        }
    }

    @ViewBuilder
    private func thumbnailCard(_ thumb: CompositionThumbnail) -> some View {
        Button {
            Task { await selectThumbnail(thumb.id) }
        } label: {
            ZStack {
                if let urlString = thumb.s3Url, let url = URL(string: urlString) {
                    AsyncImage(url: url) { image in
                        image.resizable().aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Rectangle()
                            .fill(DesignTokens.background)
                            .overlay { ProgressView().scaleEffect(0.7) }
                    }
                } else {
                    Rectangle()
                        .fill(DesignTokens.background)
                        .overlay {
                            Image(systemName: "photo")
                                .foregroundStyle(DesignTokens.muted)
                        }
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()
            .cornerRadius(6)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(thumb.selected ? DesignTokens.accent : Color.clear, lineWidth: 2.5)
            )
            .overlay(alignment: .topTrailing) {
                if thumb.selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.accent)
                        .padding(4)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if let score = thumb.visionScore {
                    Text(String(format: "%.0f", score * 100) + "%")
                        .font(.system(size: 9))
                        .fontWeight(.medium)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(.black.opacity(0.6))
                        .cornerRadius(3)
                        .padding(4)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func loadThumbnails() async {
        isLoading = true
        defer { isLoading = false }
        do {
            thumbnails = try await api.fetchThumbnails(compositionId: composition.id)
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Failed to load thumbnails"
        }
    }

    private func selectThumbnail(_ id: String) async {
        do {
            thumbnails = try await api.selectThumbnail(compositionId: composition.id, thumbnailId: id)
        } catch {
            errorMessage = "Failed to select thumbnail"
        }
    }

    private func regenerate() async {
        isRegenerating = true
        errorMessage = nil
        defer { isRegenerating = false }
        do {
            _ = try await api.regenerateThumbnails(compositionId: composition.id)
            // Wait a moment then reload
            try? await Task.sleep(for: .seconds(3))
            await loadThumbnails()
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = error.localizedDescription
        }
    }
}
