import AVFoundation
import SwiftUI

/// Generates and displays a thumbnail from a remote video URL using AVAssetImageGenerator.
/// Falls back to a placeholder icon while loading or on failure.
public struct VideoThumbnailView: View {
    let videoUrl: URL
    let placeholderIcon: String

    @State private var thumbnail: UIImage?
    @State private var didAttempt = false

    public init(videoUrl: URL, placeholderIcon: String = "film.stack") {
        self.videoUrl = videoUrl
        self.placeholderIcon = placeholderIcon
    }

    public var body: some View {
        ZStack {
            if let thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .aspectRatio(16 / 9, contentMode: .fill)
            } else {
                Rectangle()
                    .fill(DesignTokens.background)
                    .aspectRatio(16 / 9, contentMode: .fit)

                if didAttempt {
                    Image(systemName: placeholderIcon)
                        .font(.title2)
                        .foregroundStyle(DesignTokens.muted)
                } else {
                    ProgressView()
                        .tint(DesignTokens.muted)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipped()
        .task(id: videoUrl) {
            await generateThumbnail()
        }
    }

    private func generateThumbnail() async {
        let asset = AVURLAsset(url: videoUrl)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 480, height: 270)

        let time = CMTime(seconds: 1, preferredTimescale: 600)

        do {
            let (cgImage, _) = try await generator.image(at: time)
            thumbnail = UIImage(cgImage: cgImage)
        } catch {
            // Thumbnail generation failed — show placeholder
        }
        didAttempt = true
    }
}
