import SwiftUI

struct CompositionTimelineSection: View {
    let composition: Composition
    let onTrackPositionChanged: (CompositionTrack, Double) -> Void
    let onTrackTap: (CompositionTrack) -> Void

    private var creatorDuration: Double { composition.creatorDurationS ?? 0 }
    private var tracks: [CompositionTrack] { composition.tracks ?? [] }

    private let trackColors: [Color] = [.blue, .purple, .orange, .green, .pink, .cyan, .yellow, .red, .indigo, .mint]

    var body: some View {
        if composition.mode == "timeline" && creatorDuration > 0 {
            VStack(alignment: .leading, spacing: DesignTokens.spacing) {
                HStack {
                    Text("Timeline")
                        .font(.headline)
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Text(formatDuration(creatorDuration))
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }

                // Time ruler
                timeRuler

                // Creator track
                creatorBar

                // Reference tracks
                if tracks.isEmpty {
                    Text("Add reference tracks to position them on the timeline")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                        .padding(.vertical, 4)
                } else {
                    ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                        trackBar(track, colorIndex: index)
                    }
                }
            }
            .padding()
            .background(DesignTokens.surface)
            .cornerRadius(DesignTokens.cornerRadius)
        }
    }

    // MARK: - Time ruler

    @ViewBuilder
    private var timeRuler: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let interval = rulerInterval(for: creatorDuration)
            let marks = stride(from: 0.0, through: creatorDuration, by: interval)

            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(DesignTokens.muted.opacity(0.2))
                    .frame(height: 1)
                    .offset(y: 8)

                ForEach(Array(marks.enumerated()), id: \.offset) { _, time in
                    let x = (time / creatorDuration) * width
                    VStack(spacing: 1) {
                        Rectangle()
                            .fill(DesignTokens.muted.opacity(0.5))
                            .frame(width: 1, height: 6)
                        Text(formatRulerTime(time))
                            .font(.system(size: 8))
                            .foregroundStyle(DesignTokens.muted)
                    }
                    .position(x: x, y: 10)
                }
            }
        }
        .frame(height: 20)
    }

    // MARK: - Creator bar

    @ViewBuilder
    private var creatorBar: some View {
        GeometryReader { geo in
            let trimStart = composition.creatorTrimStartS
            let trimEnd = composition.creatorTrimEndS ?? creatorDuration

            ZStack(alignment: .leading) {
                // Full duration background
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.green.opacity(0.15))
                    .frame(width: geo.size.width)

                // Trimmed region
                let startFrac = trimStart / creatorDuration
                let endFrac = trimEnd / creatorDuration
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.green.opacity(0.4))
                    .frame(width: (endFrac - startFrac) * geo.size.width)
                    .offset(x: startFrac * geo.size.width)
            }
            .overlay(alignment: .leading) {
                Text("Creator")
                    .font(.caption2)
                    .fontWeight(.medium)
                    .foregroundStyle(.white)
                    .padding(.leading, 6)
            }
        }
        .frame(height: 28)
    }

    // MARK: - Reference track bar

    @ViewBuilder
    private func trackBar(_ track: CompositionTrack, colorIndex: Int) -> some View {
        let color = trackColors[colorIndex % trackColors.count]
        let effectiveDuration = (track.trimEndS ?? track.durationS) - track.trimStartS

        GeometryReader { geo in
            let startFrac = track.startAtS / creatorDuration
            let widthFrac = min(effectiveDuration / creatorDuration, 1 - startFrac)

            RoundedRectangle(cornerRadius: 4)
                .fill(color.opacity(0.4))
                .frame(width: max(widthFrac * geo.size.width, 30))
                .offset(x: startFrac * geo.size.width)
                .overlay(alignment: .leading) {
                    Text(track.label ?? "Track \(track.sortOrder + 1)")
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(.white)
                        .padding(.leading, startFrac * geo.size.width + 6)
                        .lineLimit(1)
                }
                .gesture(
                    DragGesture()
                        .onEnded { value in
                            let deltaFrac = value.translation.width / geo.size.width
                            let newStart = max(0, min(track.startAtS + deltaFrac * creatorDuration, creatorDuration - effectiveDuration))
                            // Snap to 0.5s intervals
                            let snapped = (newStart * 2).rounded() / 2
                            onTrackPositionChanged(track, snapped)
                        }
                )
                .onTapGesture {
                    onTrackTap(track)
                }
        }
        .frame(height: 28)
    }

    // MARK: - Helpers

    private func rulerInterval(for duration: Double) -> Double {
        if duration <= 30 { return 5 }
        if duration <= 120 { return 15 }
        if duration <= 300 { return 30 }
        return 60
    }

    private func formatRulerTime(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return mins > 0 ? "\(mins):\(String(format: "%02d", secs))" : "\(secs)s"
    }
}
