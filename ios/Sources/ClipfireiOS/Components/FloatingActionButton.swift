import SwiftUI

public struct FloatingActionButton: View {
    let action: () -> Void

    public init(action: @escaping () -> Void) {
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(DesignTokens.accent)
                .clipShape(Circle())
                .shadow(color: DesignTokens.accent.opacity(0.4), radius: 8, x: 0, y: 4)
        }
    }
}

public struct ContentTypePicker: View {
    let onPublication: () -> Void
    let onVideo: () -> Void
    var onSocialPost: (() -> Void)?

    public init(onPublication: @escaping () -> Void, onVideo: @escaping () -> Void, onSocialPost: (() -> Void)? = nil) {
        self.onPublication = onPublication
        self.onVideo = onVideo
        self.onSocialPost = onSocialPost
    }

    public var body: some View {
        NavigationStack {
            List {
                if let onSocialPost {
                    Button {
                        onSocialPost()
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Social Post")
                                    .font(.body)
                                    .foregroundStyle(DesignTokens.textPrimary)
                                Text("Post text to your social accounts")
                                    .font(.caption)
                                    .foregroundStyle(DesignTokens.muted)
                            }
                        } icon: {
                            Image(systemName: "text.bubble")
                                .foregroundStyle(DesignTokens.accent)
                                .frame(width: 32)
                        }
                    }
                    .listRowBackground(DesignTokens.surface)
                }

                Button {
                    onPublication()
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Publication")
                                .font(.body)
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Generate an AI article for your publication")
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }
                    } icon: {
                        Image(systemName: "doc.richtext")
                            .foregroundStyle(DesignTokens.accent)
                            .frame(width: 32)
                    }
                }
                .listRowBackground(DesignTokens.surface)

                Button {
                    onVideo()
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Video")
                                .font(.body)
                                .foregroundStyle(DesignTokens.textPrimary)
                            Text("Import a video to generate clips")
                                .font(.caption)
                                .foregroundStyle(DesignTokens.muted)
                        }
                    } icon: {
                        Image(systemName: "film")
                            .foregroundStyle(DesignTokens.accent)
                            .frame(width: 32)
                    }
                }
                .listRowBackground(DesignTokens.surface)
            }
            .scrollContentBackground(.hidden)
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Create")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.height(280)])
    }
}
