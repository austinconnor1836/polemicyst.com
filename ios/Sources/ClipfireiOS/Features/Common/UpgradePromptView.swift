import SwiftUI

public struct UpgradePromptView: View {
    public let title: String
    public let message: String
    public let quotaLimit: Int?
    public let quotaUsage: Int?
    public let onDismiss: () -> Void

    public init(title: String = "Upgrade Required",
                message: String,
                quotaLimit: Int? = nil,
                quotaUsage: Int? = nil,
                onDismiss: @escaping () -> Void) {
        self.title = title
        self.message = message
        self.quotaLimit = quotaLimit
        self.quotaUsage = quotaUsage
        self.onDismiss = onDismiss
    }

    public var body: some View {
        VStack(spacing: DesignTokens.largeSpacing) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.accent)

            Text(title)
                .font(.title2).bold()
                .foregroundStyle(DesignTokens.textPrimary)

            Text(message)
                .font(.body)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if let limit = quotaLimit, let usage = quotaUsage {
                QuotaBar(label: "Usage", current: usage, maximum: limit)
                    .padding(.horizontal)
            }

            Button(action: onDismiss) {
                Text("OK")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.accent)
                    .foregroundStyle(DesignTokens.background)
                    .cornerRadius(DesignTokens.cornerRadius)
            }
            .padding(.horizontal)
        }
        .padding(DesignTokens.largeSpacing)
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
        .padding()
    }
}

public struct QuotaBar: View {
    public let label: String
    public let current: Int
    public let maximum: Int

    public init(label: String, current: Int, maximum: Int) {
        self.label = label
        self.current = current
        self.maximum = maximum
    }

    private var fraction: Double {
        guard maximum > 0 else { return 0 }
        return min(Double(current) / Double(maximum), 1.0)
    }

    private var barColor: Color {
        if fraction >= 1.0 { return Color.red }
        if fraction >= 0.8 { return Color.orange }
        return DesignTokens.accent
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textSecondary)
                Spacer()
                Text("\(current) / \(maximum)")
                    .font(.caption).bold()
                    .foregroundStyle(DesignTokens.textPrimary)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.muted.opacity(0.3))
                        .frame(height: 8)

                    RoundedRectangle(cornerRadius: 4)
                        .fill(barColor)
                        .frame(width: geo.size.width * fraction, height: 8)
                }
            }
            .frame(height: 8)
        }
    }
}
