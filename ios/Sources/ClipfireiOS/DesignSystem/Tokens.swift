import SwiftUI

public enum DesignTokens {
    // Align with Tailwind dark defaults used on web
    public static let background = Color(red: 0.05, green: 0.06, blue: 0.07)
    public static let surface = Color(red: 0.10, green: 0.11, blue: 0.13)
    public static let accent = Color(red: 0.55, green: 0.78, blue: 0.98)
    public static let muted = Color(red: 0.65, green: 0.69, blue: 0.74)
    public static let textPrimary = Color.white
    public static let textSecondary = Color(red: 0.80, green: 0.82, blue: 0.86)

    public static let cornerRadius: CGFloat = 12
    public static let spacing: CGFloat = 12
    public static let smallSpacing: CGFloat = 8
    public static let largeSpacing: CGFloat = 16
}
