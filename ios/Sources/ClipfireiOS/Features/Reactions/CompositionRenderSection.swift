import SwiftUI

struct CompositionRenderSection: View {
    let composition: Composition
    let onRender: () -> Void
    let onCancel: () -> Void

    var body: some View {
        let hasCreator = composition.creatorS3Key != nil && composition.creatorS3Key != ""
        let hasTracks = (composition.tracks?.count ?? 0) > 0
        let canRender = hasCreator && hasTracks && composition.status != "rendering"

        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Render")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if composition.status == "rendering" {
                HStack(spacing: DesignTokens.spacing) {
                    ProgressView()
                    Text("Rendering…")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                    Spacer()
                    Button("Cancel") { onCancel() }
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
            } else {
                Button { onRender() } label: {
                    Label("Start Render", systemImage: "film")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canRender ? DesignTokens.accent : DesignTokens.muted.opacity(0.3))
                        .foregroundStyle(canRender ? DesignTokens.background : DesignTokens.muted)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
                .disabled(!canRender)

                if !hasCreator {
                    Text("Add a creator video to render")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                } else if !hasTracks {
                    Text("Add at least one reference track to render")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            }

            if composition.status == "failed" {
                Text("Render failed")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}
