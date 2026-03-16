import SwiftUI

/// Shared grid cell used by both the Videos tab and the Clips tab.
public struct VideoGridCell: View {
    let title: String
    let subtitle: String?
    let thumbnailUrl: URL?
    let videoUrl: URL?
    let placeholderIcon: String
    let duration: Double?
    let date: Date?
    let isProcessing: Bool

    public init(
        title: String,
        subtitle: String? = nil,
        thumbnailUrl: URL? = nil,
        videoUrl: URL? = nil,
        placeholderIcon: String = "video.fill",
        duration: Double? = nil,
        date: Date? = nil,
        isProcessing: Bool = false
    ) {
        self.title = title
        self.subtitle = subtitle
        self.thumbnailUrl = thumbnailUrl
        self.videoUrl = videoUrl
        self.placeholderIcon = placeholderIcon
        self.duration = duration
        self.date = date
        self.isProcessing = isProcessing
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            thumbnail
            info
        }
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
        .overlay {
            if isProcessing {
                ZStack {
                    RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                        .fill(.black.opacity(0.4))
                    VStack(spacing: 6) {
                        ProgressView()
                            .tint(.white)
                            .controlSize(.small)
                        Text("Processing...")
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundStyle(.white)
                    }
                }
            }
        }
    }

    // MARK: - Thumbnail

    @ViewBuilder
    private var thumbnail: some View {
        if let url = thumbnailUrl {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(16 / 9, contentMode: .fill)
                case .failure:
                    thumbnailPlaceholder
                case .empty:
                    ZStack {
                        thumbnailPlaceholder
                        ProgressView()
                            .tint(DesignTokens.muted)
                    }
                @unknown default:
                    thumbnailPlaceholder
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()
        } else if let videoUrl {
            VideoThumbnailView(videoUrl: videoUrl, placeholderIcon: placeholderIcon)
        } else {
            thumbnailPlaceholder
        }
    }

    private var thumbnailPlaceholder: some View {
        ZStack {
            Rectangle()
                .fill(DesignTokens.background)
                .aspectRatio(16 / 9, contentMode: .fit)
            VStack(spacing: 4) {
                Image(systemName: placeholderIcon)
                    .font(.title2)
                    .foregroundStyle(DesignTokens.muted)
                if let duration {
                    Text(formatDuration(duration))
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)
                }
            }
        }
    }

    // MARK: - Info

    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(DesignTokens.textPrimary)
                .lineLimit(2)

            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(1)
            }

            if let date {
                Text(date, style: .date)
                    .font(.caption2)
                    .foregroundStyle(DesignTokens.muted)
                    .lineLimit(1)
            }
        }
        .padding(DesignTokens.smallSpacing)
    }

    // MARK: - Helpers

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
