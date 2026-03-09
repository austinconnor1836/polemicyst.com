import SwiftUI

public enum PlatformOption: String, Identifiable, CaseIterable {
    case youtube
    case facebook
    case instagram
    case tiktok
    case twitter

    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .youtube: return "YouTube"
        case .facebook: return "Facebook"
        case .instagram: return "Instagram"
        case .tiktok: return "TikTok"
        case .twitter: return "X / Twitter"
        }
    }

    public var systemImage: String {
        switch self {
        case .youtube: return "play.rectangle.fill"
        case .facebook: return "person.2.fill"
        case .instagram: return "camera.fill"
        case .tiktok: return "music.note"
        case .twitter: return "at"
        }
    }

    public var isAvailable: Bool {
        switch self {
        case .youtube: return true
        case .facebook, .instagram, .tiktok, .twitter: return false
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
        .presentationDetents([.height(240)])
    }

    @ViewBuilder
    private func platformCard(_ platform: PlatformOption) -> some View {
        Button {
            onSelect(platform)
        } label: {
            VStack(spacing: 6) {
                Image(systemName: platform.systemImage)
                    .font(.system(size: 24))
                    .foregroundStyle(platform.isAvailable ? DesignTokens.accent : DesignTokens.muted)
                    .frame(height: 28)

                Text(platform.name)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(platform.isAvailable ? DesignTokens.textPrimary : DesignTokens.muted)

                if !platform.isAvailable {
                    Text("Coming Soon")
                        .font(.system(size: 9))
                        .fontWeight(.medium)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(DesignTokens.muted.opacity(0.6))
                        .cornerRadius(3)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, DesignTokens.spacing)
            .padding(.horizontal, DesignTokens.smallSpacing)
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
