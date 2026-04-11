import PhotosUI
import SwiftUI

struct CompositionCreatorSection: View {
    let composition: Composition
    let isUploading: Bool
    @Binding var pickerItem: PhotosPickerItem?
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            Text("Creator Video")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if composition.creatorS3Url != nil && composition.creatorS3Url != "" {
                HStack {
                    if let urlString = composition.creatorS3Url, let url = URL(string: urlString) {
                        ClipPlayerView(url: url)
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .cornerRadius(8)
                            .frame(maxWidth: 200)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        if let duration = composition.creatorDurationS {
                            Text(formatDuration(duration))
                                .font(.subheadline)
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                        if let w = composition.creatorWidth, let h = composition.creatorHeight {
                            Text("\(w)×\(h)")
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }

                        Button(role: .destructive) {
                            onDelete()
                        } label: {
                            Label("Remove", systemImage: "trash")
                                .font(.caption)
                        }
                    }

                    Spacer()
                }
            } else if isUploading {
                HStack(spacing: DesignTokens.spacing) {
                    ProgressView()
                    Text("Uploading creator video…")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            } else {
                PhotosPicker(selection: $pickerItem, matching: .videos) {
                    Label("Add Creator Video", systemImage: "video.badge.plus")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(DesignTokens.accent.opacity(0.15))
                        .foregroundStyle(DesignTokens.accent)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
            }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}
