import SwiftUI

public struct YouTubeThumbnailView: View {
    let videoId: String

    public init(videoId: String) {
        self.videoId = videoId
    }

    public var body: some View {
        ZStack {
            // Thumbnail
            AsyncImage(url: URL(string: "https://img.youtube.com/vi/\(videoId)/hqdefault.jpg")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(16 / 9, contentMode: .fill)
                case .failure:
                    placeholder
                case .empty:
                    ZStack {
                        placeholder
                        ProgressView().tint(.white)
                    }
                @unknown default:
                    placeholder
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()

            // Play button overlay
            Button {
                guard let url = URL(string: "https://www.youtube.com/watch?v=\(videoId)") else { return }
                UIApplication.shared.open(url)
            } label: {
                Image(systemName: "play.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(.white)
                    .padding(20)
                    .background(.black.opacity(0.6), in: Circle())
            }

            // YouTube badge
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    Text("YouTube")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 4))
                        .padding(8)
                }
            }
        }
    }

    private var placeholder: some View {
        ZStack {
            Rectangle()
                .fill(Color.black)
                .aspectRatio(16 / 9, contentMode: .fit)
            Image(systemName: "play.rectangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.gray)
        }
    }
}
