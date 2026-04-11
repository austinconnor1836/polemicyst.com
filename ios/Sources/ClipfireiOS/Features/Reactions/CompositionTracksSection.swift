import PhotosUI
import SwiftUI

struct CompositionTracksSection: View {
    let tracks: [CompositionTrack]
    let isUploading: Bool
    @Binding var pickerItem: PhotosPickerItem?
    let onDeleteTrack: (CompositionTrack) -> Void
    var onEditTrack: ((CompositionTrack) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing) {
            HStack {
                Text("Reference Tracks")
                    .font(.headline)
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Text("\(tracks.count)/10")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.muted)
            }

            if tracks.isEmpty {
                Text("No reference tracks yet")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
            } else {
                ForEach(tracks) { track in
                    trackRow(track)
                }
            }

            if isUploading {
                HStack(spacing: DesignTokens.spacing) {
                    ProgressView()
                    Text("Uploading track…")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            if tracks.count < 10 && !isUploading {
                PhotosPicker(selection: $pickerItem, matching: .videos) {
                    Label("Add Track", systemImage: "plus.circle")
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

    @ViewBuilder
    private func trackRow(_ track: CompositionTrack) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(track.label ?? "Track \(track.sortOrder + 1)")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textPrimary)
                HStack(spacing: 6) {
                    Text(formatDuration(track.durationS))
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                    if let w = track.width, let h = track.height {
                        Text("\(w)×\(h)")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                    if track.hasAudio {
                        Image(systemName: "speaker.wave.2")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }
            }

            Spacer()

            if onEditTrack != nil {
                Button {
                    onEditTrack?(track)
                } label: {
                    Image(systemName: "pencil")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.accent)
                }
            }

            Button(role: .destructive) {
                onDeleteTrack(track)
            } label: {
                Image(systemName: "trash")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(DesignTokens.smallSpacing)
        .background(DesignTokens.background)
        .cornerRadius(8)
        .contentShape(Rectangle())
        .onTapGesture {
            onEditTrack?(track)
        }
    }
}
