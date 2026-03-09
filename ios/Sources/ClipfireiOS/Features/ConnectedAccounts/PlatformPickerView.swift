import SwiftUI

public enum PlatformOption: String, Identifiable, CaseIterable {
    case youtube
    case cspan
    case upload
    case tiktok
    case instagram
    case twitter

    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .youtube: return "YouTube"
        case .cspan: return "C-SPAN"
        case .upload: return "Upload"
        case .tiktok: return "TikTok"
        case .instagram: return "Instagram"
        case .twitter: return "X / Twitter"
        }
    }

    public var description: String {
        switch self {
        case .youtube: return "Connect a YouTube channel"
        case .cspan: return "Monitor C-SPAN feeds"
        case .upload: return "Upload videos directly"
        case .tiktok: return "Connect a TikTok account"
        case .instagram: return "Connect an Instagram account"
        case .twitter: return "Connect an X / Twitter account"
        }
    }

    public var systemImage: String {
        switch self {
        case .youtube: return "play.rectangle.fill"
        case .cspan: return "building.columns.fill"
        case .upload: return "arrow.up.doc.fill"
        case .tiktok: return "music.note"
        case .instagram: return "camera.fill"
        case .twitter: return "at"
        }
    }

    public var isAvailable: Bool {
        switch self {
        case .youtube, .cspan, .upload: return true
        case .tiktok, .instagram, .twitter: return false
        }
    }
}

public struct PlatformPickerView: View {
    @Environment(\.dismiss) private var dismiss
    let onSelect: (PlatformOption) -> Void

    public init(onSelect: @escaping (PlatformOption) -> Void) {
        self.onSelect = onSelect
    }

    private let columns = [
        GridItem(.flexible(), spacing: DesignTokens.spacing),
        GridItem(.flexible(), spacing: DesignTokens.spacing)
    ]

    public var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: DesignTokens.spacing) {
                    ForEach(PlatformOption.allCases) { platform in
                        platformCard(platform)
                    }
                }
                .padding(DesignTokens.spacing)
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Connect Account")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    @ViewBuilder
    private func platformCard(_ platform: PlatformOption) -> some View {
        Button {
            onSelect(platform)
        } label: {
            VStack(spacing: DesignTokens.smallSpacing) {
                Image(systemName: platform.systemImage)
                    .font(.system(size: 28))
                    .foregroundStyle(platform.isAvailable ? DesignTokens.accent : DesignTokens.muted)
                    .frame(height: 36)

                Text(platform.name)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(platform.isAvailable ? DesignTokens.textPrimary : DesignTokens.muted)

                Text(platform.description)
                    .font(.caption2)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                if !platform.isAvailable {
                    Text("Coming Soon")
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(DesignTokens.muted.opacity(0.6))
                        .cornerRadius(4)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(DesignTokens.spacing)
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                    .stroke(platform.isAvailable ? DesignTokens.accent.opacity(0.3) : Color.clear, lineWidth: 1)
            )
        }
        .disabled(!platform.isAvailable)
        .buttonStyle(.plain)
    }
}
