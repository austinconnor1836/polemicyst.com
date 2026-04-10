import SwiftUI

struct CompositionOutputsSection: View {
    let outputs: [CompositionOutput]
    var onEditOutput: ((CompositionOutput) -> Void)?

    var body: some View {
        if !outputs.isEmpty {
            VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                Text("Outputs")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)

                ForEach(outputs) { output in
                    outputCard(output)
                }
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
        }
    }

    @ViewBuilder
    private func outputCard(_ output: CompositionOutput) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            HStack {
                Text(output.layout.capitalized)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                outputStatusBadge(output.status)
            }

            if output.status == "completed", let urlString = output.s3Url, let url = URL(string: urlString) {
                ClipPlayerView(url: url)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .cornerRadius(8)

                HStack(spacing: 8) {
                    ShareLink(item: url) {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(DesignTokens.accent.opacity(0.15))
                            .foregroundStyle(DesignTokens.accent)
                            .cornerRadius(8)
                    }

                    if onEditOutput != nil {
                        Button {
                            onEditOutput?(output)
                        } label: {
                            Label("Edit", systemImage: "scissors")
                                .font(.subheadline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Color.orange.opacity(0.15))
                                .foregroundStyle(.orange)
                                .cornerRadius(8)
                        }
                    }
                }
            } else if output.status == "rendering" {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Rendering\u{2026}")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else if output.status == "failed" {
                Text(output.renderError ?? "Render failed")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(DesignTokens.spacing)
        .background(DesignTokens.background)
        .cornerRadius(8)
    }

    @ViewBuilder
    private func outputStatusBadge(_ status: String) -> some View {
        let (label, color): (String, Color) = switch status {
        case "rendering": ("Rendering", .orange)
        case "completed": ("Done", .green)
        case "failed": ("Failed", .red)
        default: ("Pending", DesignTokens.muted)
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
}
