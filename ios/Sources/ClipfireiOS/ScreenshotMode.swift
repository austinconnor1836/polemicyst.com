import Foundation

public enum ScreenshotMode {
    public static var isActive: Bool {
        CommandLine.arguments.contains("--screenshot-mode")
    }
}
