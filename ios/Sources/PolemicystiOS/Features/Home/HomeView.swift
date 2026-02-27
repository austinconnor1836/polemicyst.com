import SwiftUI

public struct HomeView: View {
    @Binding var selection: Int

    public init(selection: Binding<Int>) {
        self._selection = selection
    }

    public var body: some View {
        ZStack {
            LinearGradient(
                colors: [DesignTokens.background, DesignTokens.surface],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: DesignTokens.largeSpacing) {
                VStack(spacing: DesignTokens.smallSpacing) {
                    Text("Polemicyst")
                        .font(.largeTitle).bold()
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text("Generate and manage feeds to create clips faster.")
                        .font(.body)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, DesignTokens.largeSpacing)

                VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                    Label("Set up feeds for YouTube or C-SPAN sources", systemImage: "dot.radiowaves.left.and.right")
                        .foregroundStyle(DesignTokens.textPrimary)
                    Label("Trigger clip generation jobs from transcripts", systemImage: "bolt.fill")
                        .foregroundStyle(DesignTokens.textPrimary)
                    Label("Review and manage your generated clips", systemImage: "play.rectangle.fill")
                        .foregroundStyle(DesignTokens.textPrimary)
                    Label("Track your usage and subscription", systemImage: "chart.bar.fill")
                        .foregroundStyle(DesignTokens.textPrimary)
                }
                .padding()
                .background(DesignTokens.surface.opacity(0.7))
                .cornerRadius(DesignTokens.cornerRadius)

                HStack(spacing: DesignTokens.spacing) {
                    Button(action: { selection = 1 }) {
                        Text("Feeds")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(DesignTokens.accent)
                            .foregroundStyle(DesignTokens.background)
                            .cornerRadius(DesignTokens.cornerRadius)
                    }

                    Button(action: { selection = 3 }) {
                        Text("Clips")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(DesignTokens.surface)
                            .foregroundStyle(DesignTokens.accent)
                            .cornerRadius(DesignTokens.cornerRadius)
                            .overlay(
                                RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                                    .stroke(DesignTokens.accent.opacity(0.5), lineWidth: 1)
                            )
                    }
                }
                .padding(.horizontal, DesignTokens.largeSpacing)

                Spacer()
            }
            .padding(.top, DesignTokens.largeSpacing)
            .padding(.bottom, DesignTokens.largeSpacing * 2)
        }
    }
}
