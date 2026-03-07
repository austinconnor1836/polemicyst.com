import SwiftUI

// MARK: - Environment key for color scheme

private struct AppColorSchemeKey: EnvironmentKey {
    static let defaultValue: ColorScheme = .light
}

extension EnvironmentValues {
    var appColorScheme: ColorScheme {
        get { self[AppColorSchemeKey.self] }
        set { self[AppColorSchemeKey.self] = newValue }
    }
}

// MARK: - Token-aware color helpers

/// Resolves a light / dark token pair based on the current color scheme.
struct TokenColors {
    let colorScheme: ColorScheme

    var primary: Color { colorScheme == .dark ? .tokenPrimaryDark : .tokenPrimaryLight }
    var accent: Color { colorScheme == .dark ? .tokenAccentDark : .tokenAccentLight }
    var background: Color { colorScheme == .dark ? .tokenBackgroundDark : .tokenBackgroundLight }
    var surface: Color { colorScheme == .dark ? .tokenSurfaceDark : .tokenSurfaceLight }
    var text: Color { colorScheme == .dark ? .tokenTextDark : .tokenTextLight }
    var textMuted: Color { colorScheme == .dark ? .tokenTextMutedDark : .tokenTextMutedLight }
    var border: Color { colorScheme == .dark ? .tokenBorderDark : .tokenBorderLight }
    var success: Color { colorScheme == .dark ? .tokenSuccessDark : .tokenSuccessLight }
    var destructive: Color { colorScheme == .dark ? .tokenDestructiveDark : .tokenDestructiveLight }
}

// MARK: - View modifier

/// Applies the Polemicyst token palette as default foreground / background.
///
/// Usage:
/// ```swift
/// ContentView()
///     .modifier(PolemicystTheme())
/// ```
struct PolemicystTheme: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        let tokens = TokenColors(colorScheme: colorScheme)
        content
            .foregroundColor(tokens.text)
            .background(tokens.background)
            .environment(\.appColorScheme, colorScheme)
    }
}

extension View {
    func polemicystTheme() -> some View {
        modifier(PolemicystTheme())
    }
}
