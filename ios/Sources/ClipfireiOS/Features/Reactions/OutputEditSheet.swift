import AVFoundation
import AVKit
import SwiftUI

// MARK: - Cut model

struct VideoCut: Identifiable {
    let id = UUID()
    var startS: Double
    var endS: Double
}

// MARK: - Output Edit Sheet

struct OutputEditSheet: View {
    let output: CompositionOutput
    let compositionId: String
    let api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var player: AVPlayer?
    @State private var duration: Double = 0
    @State private var currentTime: Double = 0
    @State private var cuts: [VideoCut] = []
    @State private var markStart: Double?
    @State private var isSplicing = false
    @State private var spliceProgress: Double = 0
    @State private var isUploading = false
    @State private var splicedURL: URL?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Video player
                videoPlayerView
                    .frame(height: 240)

                // Timeline with cuts
                timelineView
                    .padding(.horizontal)
                    .padding(.top, 8)

                // Cut controls
                cutControls
                    .padding()

                // Cuts list
                if !cuts.isEmpty {
                    cutsList
                        .padding(.horizontal)
                }

                Spacer()

                // Action buttons
                actionButtons
                    .padding()
            }
            .background(DesignTokens.background.ignoresSafeArea())
            .navigationTitle("Edit Output")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { cleanup(); dismiss() }
                }
            }
            .onAppear { setupPlayer() }
            .onDisappear { cleanup() }
        }
    }

    // MARK: - Video player

    @ViewBuilder
    private var videoPlayerView: some View {
        if let player {
            VideoPlayer(player: player)
                .cornerRadius(8)
                .padding(.horizontal)
                .onReceive(
                    Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
                ) { _ in
                    currentTime = player.currentTime().seconds
                }
        } else {
            Rectangle()
                .fill(DesignTokens.background)
                .overlay { ProgressView() }
                .cornerRadius(8)
                .padding(.horizontal)
        }
    }

    // MARK: - Timeline

    @ViewBuilder
    private var timelineView: some View {
        GeometryReader { geo in
            let width = geo.size.width

            ZStack(alignment: .leading) {
                // Track background
                RoundedRectangle(cornerRadius: 4)
                    .fill(DesignTokens.muted.opacity(0.2))
                    .frame(height: 32)

                // Cut regions (red)
                ForEach(cuts) { cut in
                    let startFrac = duration > 0 ? cut.startS / duration : 0
                    let endFrac = duration > 0 ? cut.endS / duration : 0
                    Rectangle()
                        .fill(Color.red.opacity(0.35))
                        .frame(width: (endFrac - startFrac) * width, height: 32)
                        .offset(x: startFrac * width)
                }

                // Mark-start indicator (yellow)
                if let ms = markStart {
                    let frac = duration > 0 ? ms / duration : 0
                    Rectangle()
                        .fill(Color.yellow)
                        .frame(width: 2, height: 32)
                        .offset(x: frac * width)
                }

                // Playhead
                if duration > 0 {
                    let frac = currentTime / duration
                    Rectangle()
                        .fill(Color.white)
                        .frame(width: 2, height: 40)
                        .offset(x: frac * width)
                        .shadow(color: .black.opacity(0.3), radius: 1)
                }

                // Time labels
                HStack {
                    Text(formatTimestamp(currentTime))
                        .font(.system(size: 9))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                    Spacer()
                    Text(formatTimestamp(duration))
                        .font(.system(size: 9))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, 4)
            }
            .frame(height: 40)
            .contentShape(Rectangle())
            .onTapGesture { location in
                guard duration > 0 else { return }
                let frac = location.x / width
                let time = frac * duration
                player?.seek(to: CMTime(seconds: time, preferredTimescale: 600))
            }
        }
        .frame(height: 40)
    }

    // MARK: - Cut controls

    @ViewBuilder
    private var cutControls: some View {
        HStack(spacing: DesignTokens.spacing) {
            if markStart == nil {
                Button {
                    markStart = currentTime
                } label: {
                    Label("Mark Start", systemImage: "scissors")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.orange.opacity(0.15))
                        .foregroundStyle(.orange)
                        .cornerRadius(8)
                }
            } else {
                Button {
                    guard let start = markStart, currentTime > start + 0.1 else { return }
                    cuts.append(VideoCut(startS: start, endS: currentTime))
                    markStart = nil
                } label: {
                    Label("Mark End", systemImage: "scissors")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.red.opacity(0.15))
                        .foregroundStyle(.red)
                        .cornerRadius(8)
                }

                Button {
                    markStart = nil
                } label: {
                    Text("Cancel")
                        .font(.subheadline)
                        .padding(.vertical, 10)
                        .padding(.horizontal)
                        .background(DesignTokens.muted.opacity(0.15))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .cornerRadius(8)
                }
            }
        }
    }

    // MARK: - Cuts list

    @ViewBuilder
    private var cutsList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Cuts to remove")
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

            ForEach(cuts) { cut in
                HStack {
                    Image(systemName: "scissors")
                        .font(.caption2)
                        .foregroundStyle(.red)

                    Text(formatTimestamp(cut.startS) + " \u{2192} " + formatTimestamp(cut.endS))
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text("(\(formatDuration(cut.endS - cut.startS)))")
                        .font(.caption2)
                        .foregroundStyle(DesignTokens.muted)

                    Spacer()

                    Button {
                        cuts.removeAll { $0.id == cut.id }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.muted)
                    }
                }
            }
        }
    }

    // MARK: - Action buttons

    @ViewBuilder
    private var actionButtons: some View {
        VStack(spacing: DesignTokens.smallSpacing) {
            if isSplicing {
                VStack(spacing: 4) {
                    ProgressView(value: spliceProgress)
                        .tint(DesignTokens.accent)
                    Text("Splicing... \(Int(spliceProgress * 100))%")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else if isUploading {
                HStack {
                    ProgressView().scaleEffect(0.8)
                    Text("Uploading spliced video...")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.muted)
                }
            } else if splicedURL != nil {
                Button {
                    Task { await uploadSpliced() }
                } label: {
                    Label("Save & Upload", systemImage: "arrow.up.circle")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(DesignTokens.accent)
                        .foregroundStyle(DesignTokens.background)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
            } else {
                Button {
                    Task { await applyCuts() }
                } label: {
                    Label("Apply Cuts", systemImage: "scissors")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(cuts.isEmpty ? DesignTokens.muted.opacity(0.3) : DesignTokens.accent)
                        .foregroundStyle(cuts.isEmpty ? DesignTokens.muted : DesignTokens.background)
                        .cornerRadius(DesignTokens.cornerRadius)
                }
                .disabled(cuts.isEmpty)
            }

            if let err = errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Setup

    private func setupPlayer() {
        guard let urlString = splicedURL?.absoluteString ?? output.s3Url,
              let url = URL(string: urlString) else { return }

        let avPlayer = AVPlayer(url: url)
        self.player = avPlayer

        // Get duration
        Task {
            if let asset = player?.currentItem?.asset {
                let d = try? await asset.load(.duration)
                if let d { duration = d.seconds }
            }
        }
    }

    private func cleanup() {
        player?.pause()
        player = nil
        // Clean up temp splice file
        if let url = splicedURL {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - Splice using AVFoundation

    private func applyCuts() async {
        guard !cuts.isEmpty else { return }
        guard let urlString = output.s3Url, let sourceURL = URL(string: urlString) else {
            errorMessage = "No source video URL"
            return
        }

        isSplicing = true
        spliceProgress = 0
        errorMessage = nil
        defer { isSplicing = false }

        do {
            let splicedFile = try await spliceVideo(sourceURL: sourceURL, cuts: cuts, duration: duration) { progress in
                Task { @MainActor in spliceProgress = progress }
            }
            splicedURL = splicedFile

            // Switch player to spliced version
            player?.pause()
            player = AVPlayer(url: splicedFile)
            if let asset = player?.currentItem?.asset {
                let d = try? await asset.load(.duration)
                if let d { duration = d.seconds }
            }
            cuts.removeAll()
        } catch {
            errorMessage = "Splice failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Upload spliced video

    private func uploadSpliced() async {
        guard let fileURL = splicedURL else { return }
        isUploading = true
        errorMessage = nil
        defer { isUploading = false }

        do {
            let fileData = try Data(contentsOf: fileURL)
            let filename = "spliced-\(output.layout)-\(UUID().uuidString.prefix(8)).mp4"
            let prefix = "compositions/\(compositionId)/outputs/"
            let contentType = "video/mp4"

            // Multipart upload
            let initResponse = try await api.initiateMultipartUpload(filename: "\(prefix)\(filename)", contentType: contentType)
            let chunkSize = 10 * 1024 * 1024
            let totalParts = Int(ceil(Double(fileData.count) / Double(chunkSize)))
            var completedParts: [MultipartCompletePart] = []

            for partNumber in 1...totalParts {
                let start = (partNumber - 1) * chunkSize
                let end = min(partNumber * chunkSize, fileData.count)
                let chunk = fileData[start..<end]

                let partURLResponse = try await api.getMultipartPartURL(
                    uploadId: initResponse.uploadId, key: initResponse.key, partNumber: partNumber
                )
                guard let url = URL(string: partURLResponse.url) else { continue }

                var request = URLRequest(url: url)
                request.httpMethod = "PUT"
                request.setValue(contentType, forHTTPHeaderField: "Content-Type")
                request.setValue("\(chunk.count)", forHTTPHeaderField: "Content-Length")

                let (_, response) = try await URLSession.shared.upload(for: request, from: chunk)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200..<300).contains(httpResponse.statusCode),
                      let etag = httpResponse.value(forHTTPHeaderField: "ETag") else { continue }

                completedParts.append(MultipartCompletePart(partNumber: partNumber, etag: etag))
            }

            try await api.completeMultipartUpload(uploadId: initResponse.uploadId, key: initResponse.key, parts: completedParts)

            let s3Url = "https://\(api.baseURL.host ?? "")/api/uploads/proxy/\(initResponse.key)"

            // Get duration of spliced video
            let asset = AVURLAsset(url: fileURL)
            let d = try? await asset.load(.duration)
            let durationMs = d.map { Int($0.seconds * 1000) }

            // Save to server
            try await api.saveClientOutput(
                compositionId: compositionId,
                body: ClientCompleteRequest(
                    layout: output.layout,
                    s3Key: initResponse.key,
                    s3Url: s3Url,
                    durationMs: durationMs
                )
            )

            dismiss()
        } catch {
            if error is CancellationError || (error as NSError).code == NSURLErrorCancelled { return }
            errorMessage = "Upload failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Helpers

    private func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        let frac = Int((seconds.truncatingRemainder(dividingBy: 1)) * 10)
        return String(format: "%d:%02d.%d", mins, secs, frac)
    }
}

// MARK: - AVFoundation Splice Helper

/// Lossless splice: keeps segments outside the cuts using AVMutableComposition.
/// AVFoundation handles keyframe alignment automatically.
private func spliceVideo(
    sourceURL: URL,
    cuts: [VideoCut],
    duration: Double,
    onProgress: @escaping (Double) -> Void
) async throws -> URL {
    let asset = AVURLAsset(url: sourceURL)

    // Compute kept segments (inverse of cuts)
    let sortedCuts = cuts.sorted { $0.startS < $1.startS }
    var keptSegments: [(start: Double, end: Double)] = []
    var cursor = 0.0
    for cut in sortedCuts {
        if cut.startS > cursor {
            keptSegments.append((cursor, cut.startS))
        }
        cursor = max(cursor, cut.endS)
    }
    if cursor < duration {
        keptSegments.append((cursor, duration))
    }

    guard !keptSegments.isEmpty else {
        throw SpliceError.noSegments
    }

    onProgress(0.1)

    // Build composition from kept segments
    let composition = AVMutableComposition()

    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
        throw SpliceError.noVideoTrack
    }

    let compVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)

    // Try to add audio track too
    let audioTrack = try? await asset.loadTracks(withMediaType: .audio).first
    let compAudioTrack: AVMutableCompositionTrack?
    if audioTrack != nil {
        compAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    } else {
        compAudioTrack = nil
    }

    onProgress(0.2)

    var insertTime = CMTime.zero
    for (i, segment) in keptSegments.enumerated() {
        let startTime = CMTime(seconds: segment.start, preferredTimescale: 600)
        let endTime = CMTime(seconds: segment.end, preferredTimescale: 600)
        let timeRange = CMTimeRange(start: startTime, end: endTime)

        try compVideoTrack?.insertTimeRange(timeRange, of: videoTrack, at: insertTime)
        if let at = audioTrack {
            try compAudioTrack?.insertTimeRange(timeRange, of: at, at: insertTime)
        }

        insertTime = CMTimeAdd(insertTime, CMTimeSubtract(endTime, startTime))
        onProgress(0.2 + 0.5 * Double(i + 1) / Double(keptSegments.count))
    }

    onProgress(0.7)

    // Export
    let outputURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("splice-\(UUID().uuidString).mp4")

    guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
        throw SpliceError.exportFailed
    }

    exportSession.outputURL = outputURL
    exportSession.outputFileType = .mp4

    await exportSession.export()

    onProgress(1.0)

    if exportSession.status == .completed {
        return outputURL
    } else {
        throw exportSession.error ?? SpliceError.exportFailed
    }
}

private enum SpliceError: LocalizedError {
    case noSegments
    case noVideoTrack
    case exportFailed

    var errorDescription: String? {
        switch self {
        case .noSegments: return "No segments to keep after applying cuts"
        case .noVideoTrack: return "Source video has no video track"
        case .exportFailed: return "Video export failed"
        }
    }
}
