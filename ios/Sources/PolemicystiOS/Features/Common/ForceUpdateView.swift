import SwiftUI

public struct ForceUpdateView: View {
    let storeUrl: String

    public init(storeUrl: String) {
        self.storeUrl = storeUrl
    }

    public var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "arrow.down.app.fill")
                .font(.system(size: 64))
                .foregroundStyle(DesignTokens.primary)

            Text("Update Required")
                .font(.title)
                .fontWeight(.bold)

            Text("A new version of the app is available. Please update to continue.")
                .font(.body)
                .foregroundStyle(DesignTokens.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button(action: openStore) {
                Text("Update Now")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 48)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.background.ignoresSafeArea())
        .interactiveDismissDisabled()
    }

    private func openStore() {
        guard let url = URL(string: storeUrl) else { return }
        UIApplication.shared.open(url)
    }
}
