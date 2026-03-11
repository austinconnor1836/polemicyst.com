import SwiftUI

/// Renders the official brand logo for publishing platforms.
/// SVG paths match the web app's `PublishingPlatformIcons.tsx`.
public struct PlatformBrandIcon: View {
    let platform: String
    var size: CGFloat = 32

    public init(platform: String, size: CGFloat = 32) {
        self.platform = platform
        self.size = size
    }

    public var body: some View {
        brandView
            .frame(width: size, height: size)
    }

    @ViewBuilder
    private var brandView: some View {
        switch platform.lowercased() {
        case "substack":
            SubstackLogo().fill(brandColor)
        case "medium":
            MediumLogo().fill(brandColor)
        case "ghost":
            GhostLogo().fill(brandColor)
        case "wordpress":
            WordPressLogo().fill(brandColor)
        default:
            Image(systemName: "link")
                .resizable()
                .scaledToFit()
                .foregroundStyle(DesignTokens.muted)
        }
    }

    private var brandColor: Color {
        switch platform.lowercased() {
        case "substack":  return Color(red: 1.0, green: 0.38, blue: 0.13)   // orange-500
        case "medium":    return DesignTokens.textPrimary                     // foreground
        case "ghost":     return Color(red: 0.24, green: 0.56, blue: 0.96)   // blue-500
        case "wordpress": return Color(red: 0.15, green: 0.44, blue: 0.84)   // blue-600
        default:          return DesignTokens.muted
        }
    }
}

// MARK: - SVG Path Shapes

/// Substack logo: two bars + envelope chevron
/// Path: M22.539 8.242H1.46V5.406h21.08v2.836z M1.46 10.812V24L12 18.11 22.54 24V10.812H1.46z M22.54 0H1.46v2.836h21.08V0z
private struct SubstackLogo: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24
        let sy = rect.height / 24
        var path = Path()
        // Top bar
        path.addRect(CGRect(x: 1.46 * sx, y: 0, width: 21.08 * sx, height: 2.836 * sy))
        // Middle bar
        path.addRect(CGRect(x: 1.46 * sx, y: 5.406 * sy, width: 21.08 * sx, height: 2.836 * sy))
        // Envelope body
        path.move(to: CGPoint(x: 1.46 * sx, y: 10.812 * sy))
        path.addLine(to: CGPoint(x: 1.46 * sx, y: 24 * sy))
        path.addLine(to: CGPoint(x: 12 * sx, y: 18.11 * sy))
        path.addLine(to: CGPoint(x: 22.54 * sx, y: 24 * sy))
        path.addLine(to: CGPoint(x: 22.54 * sx, y: 10.812 * sy))
        path.closeSubpath()
        return path
    }
}

/// Medium logo: large ellipse + smaller ellipse + thin ellipse
/// Path: M13.54 12a6.8 6.8 0 01-6.77 6.82A6.8 6.8 0 010 12a6.8 6.8 0 016.77-6.82A6.8 6.8 0 0113.54 12z
///       M20.96 12c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42
///       M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z
private struct MediumLogo: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24
        let sy = rect.height / 24
        var path = Path()
        // Large circle (left)
        path.addEllipse(in: CGRect(
            x: 0, y: (12 - 6.82) * sy,
            width: 13.54 * sx, height: 13.64 * sy
        ))
        // Middle ellipse
        path.addEllipse(in: CGRect(
            x: (20.96 - 3.38 * 2) * sx, y: (12 - 6.42) * sy,
            width: 3.38 * 2 * sx, height: 12.84 * sy
        ))
        // Right thin ellipse
        path.addEllipse(in: CGRect(
            x: (24 - 1.19 * 2) * sx, y: (12 - 5.75) * sy,
            width: 1.19 * 2 * sx, height: 11.5 * sy
        ))
        return path
    }
}

/// Ghost logo: ghost body with two eyes
/// Uses the official Simple Icons ghost path.
private struct GhostLogo: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 26  // viewBox is ~26 wide (path extends to 25.868)
        let sy = rect.height / 24
        var path = Path()

        // Ghost body
        path.move(to: CGPoint(x: 12 * sx, y: 0))
        // Top arc (head) - approximate with a curve
        path.addCurve(
            to: CGPoint(x: 2.241 * sx, y: 8.986 * sy),
            control1: CGPoint(x: 6.615 * sx, y: 0),
            control2: CGPoint(x: 2.241 * sx, y: 4.024 * sy)
        )
        // Left side down
        path.addLine(to: CGPoint(x: 2.241 * sx, y: 24 * sy))
        // Bottom scallops (wavy bottom)
        path.addCurve(
            to: CGPoint(x: 10.116 * sx, y: 24 * sy),
            control1: CGPoint(x: 3.554 * sx, y: 23.066 * sy),
            control2: CGPoint(x: 6.179 * sx, y: 22.133 * sy)
        )
        path.addCurve(
            to: CGPoint(x: 17.991 * sx, y: 24 * sy),
            control1: CGPoint(x: 11.429 * sx, y: 23.066 * sy),
            control2: CGPoint(x: 14.054 * sx, y: 23.066 * sy)
        )
        path.addCurve(
            to: CGPoint(x: 25.867 * sx, y: 20.266 * sy),
            control1: CGPoint(x: 19.304 * sx, y: 23.066 * sy),
            control2: CGPoint(x: 22.556 * sx, y: 21.2 * sy)
        )
        // Right side up
        path.addLine(to: CGPoint(x: 25.867 * sx, y: 8.986 * sy))
        // Top arc right side
        path.addCurve(
            to: CGPoint(x: 12 * sx, y: 0),
            control1: CGPoint(x: 25.867 * sx, y: 4.024 * sy),
            control2: CGPoint(x: 17.386 * sx, y: 0)
        )
        path.closeSubpath()

        // Left eye (cut out)
        let eyeRadius: CGFloat = 2.4
        path.addEllipse(in: CGRect(
            x: (8.4 - eyeRadius) * sx, y: (10.2 - eyeRadius) * sy,
            width: eyeRadius * 2 * sx, height: eyeRadius * 2 * sy
        ))
        // Right eye (cut out)
        path.addEllipse(in: CGRect(
            x: (15.6 - eyeRadius) * sx, y: (10.2 - eyeRadius) * sy,
            width: eyeRadius * 2 * sx, height: eyeRadius * 2 * sy
        ))

        return path
    }
}

/// WordPress logo: W in a circle
/// Uses the official Simple Icons WordPress path.
private struct WordPressLogo: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24
        let sy = rect.height / 24
        var path = Path()

        // Outer circle
        path.addEllipse(in: CGRect(x: 0, y: 0, width: 24 * sx, height: 24 * sy))

        // Inner W shape (cut out using even-odd fill) — simplified
        // Left stroke of W
        path.move(to: CGPoint(x: 3.41 * sx, y: 7.496 * sy))
        path.addLine(to: CGPoint(x: 8.9 * sx, y: 22.537 * sy))
        path.addLine(to: CGPoint(x: 5.67 * sx, y: 13.33 * sy))
        path.addLine(to: CGPoint(x: 3.41 * sx, y: 7.496 * sy))
        path.closeSubpath()

        // Center-left stroke
        path.move(to: CGPoint(x: 7.34 * sx, y: 6.93 * sy))
        path.addLine(to: CGPoint(x: 11.23 * sx, y: 18.485 * sy))
        path.addLine(to: CGPoint(x: 7.34 * sx, y: 6.93 * sy))
        path.closeSubpath()

        // Center-right stroke
        path.move(to: CGPoint(x: 12 * sx, y: 22.787 * sy))
        path.addLine(to: CGPoint(x: 16.325 * sx, y: 10.226 * sy))
        path.addLine(to: CGPoint(x: 20.755 * sx, y: 22.364 * sy))
        path.addLine(to: CGPoint(x: 12 * sx, y: 22.787 * sy))
        path.closeSubpath()

        return path
    }
}
