import SwiftUI

public struct ViralitySettingsView: View {
    @Binding public var settings: ViralitySettings
    public var allowedProviders: [String]

    public init(settings: Binding<ViralitySettings>, allowedProviders: [String] = ["ollama", "gemini"]) {
        self._settings = settings
        self.allowedProviders = allowedProviders
    }

    public var body: some View {
        Group {
            Picker("Scoring Mode", selection: $settings.scoringMode) {
                Text("Heuristic").tag("heuristic")
                Text("Hybrid").tag("hybrid")
                Text("Gemini").tag("gemini")
            }

            Picker("Target Platform", selection: $settings.targetPlatform) {
                Text("All").tag("all")
                Text("Reels").tag("reels")
                Text("Shorts").tag("shorts")
                Text("YouTube").tag("youtube")
            }

            Picker("Content Style", selection: $settings.contentStyle) {
                Text("Auto-detect").tag("auto")
                Text("Politics").tag("politics")
                Text("Comedy").tag("comedy")
                Text("Education").tag("education")
                Text("Podcast").tag("podcast")
                Text("Gaming").tag("gaming")
                Text("Vlog").tag("vlog")
                Text("Other").tag("other")
            }

            Picker("LLM Provider", selection: $settings.llmProvider) {
                ForEach(allowedProviders, id: \.self) { provider in
                    Text(provider.capitalized).tag(provider)
                }
            }

            Toggle("Safer Clips", isOn: $settings.saferClips)
            Toggle("Include Audio", isOn: $settings.includeAudio)
        }
    }
}
