import PhotosUI
import SwiftUI

// MARK: - Editor View (thin shell composing section views)

public struct CompositionEditorView: View {
    @StateObject private var viewModel: CompositionEditorViewModel
    @State private var editableTitle = ""
    @State private var creatorPickerItem: PhotosPickerItem?
    @State private var trackPickerItem: PhotosPickerItem?
    @State private var showErrorAlert = false
    @State private var showDeleteCreatorAlert = false
    @State private var trackToDelete: CompositionTrack?
    @State private var showDeleteTrackAlert = false
    @State private var trackToEdit: CompositionTrack?
    @State private var outputToEdit: CompositionOutput?
    @State private var selectedLayouts: Set<String> = ["mobile", "landscape"]

    public init(compositionId: String, api: APIClient) {
        _viewModel = StateObject(wrappedValue: CompositionEditorViewModel(api: api, compositionId: compositionId))
    }

    public var body: some View {
        ScrollView {
            if let comp = viewModel.composition {
                VStack(alignment: .leading, spacing: DesignTokens.largeSpacing) {
                    // Title
                    titleSection(comp)

                    // Mode (pre-synced vs timeline)
                    CompositionModeSection(
                        composition: comp,
                        onModeChanged: { mode in
                            Task { await viewModel.save(mode: mode) }
                        }
                    )

                    // Creator video upload/preview
                    CompositionCreatorSection(
                        composition: comp,
                        isUploading: viewModel.isUploadingCreator,
                        pickerItem: $creatorPickerItem,
                        onDelete: { showDeleteCreatorAlert = true }
                    )

                    // Creator trim
                    CompositionTrimSection(
                        composition: comp,
                        onSave: { start, end in
                            Task { await viewModel.save(creatorTrimStartS: start, creatorTrimEndS: end) }
                        }
                    )

                    // Reference tracks
                    CompositionTracksSection(
                        tracks: comp.tracks ?? [],
                        isUploading: viewModel.isUploadingTrack,
                        pickerItem: $trackPickerItem,
                        onDeleteTrack: { track in
                            trackToDelete = track
                            showDeleteTrackAlert = true
                        },
                        onEditTrack: { track in trackToEdit = track }
                    )

                    // Timeline (only in timeline mode)
                    CompositionTimelineSection(
                        composition: comp,
                        onTrackPositionChanged: { track, newStart in
                            Task {
                                await viewModel.updateTrack(
                                    trackId: track.id,
                                    body: UpdateTrackRequest(startAtS: newStart)
                                )
                            }
                        },
                        onTrackTap: { track in trackToEdit = track }
                    )

                    // Audio mode + volume
                    CompositionAudioSection(
                        composition: comp,
                        onAudioModeChanged: { mode in
                            Task { await viewModel.save(audioMode: mode) }
                        }
                    )

                    CompositionVolumeSection(
                        composition: comp,
                        onCreatorVolumeChanged: { vol in
                            Task { await viewModel.save(creatorVolume: vol) }
                        },
                        onReferenceVolumeChanged: { vol in
                            Task { await viewModel.save(referenceVolume: vol) }
                        }
                    )

                    // Auto-edit (silence/bad take detection)
                    CompositionAutoEditSection(
                        composition: comp,
                        api: viewModel.api
                    )

                    // Quote graphics
                    CompositionQuoteGraphicsSection(
                        composition: comp,
                        api: viewModel.api
                    )

                    // Captions
                    CompositionCaptionsSection(api: viewModel.api)

                    // Layout selection
                    CompositionLayoutSection(selectedLayouts: $selectedLayouts)

                    // Render controls
                    CompositionRenderSection(
                        composition: comp,
                        onRender: {
                            Task {
                                await viewModel.triggerRender(layouts: Array(selectedLayouts))
                            }
                        },
                        onCancel: { Task { await viewModel.cancelRender() } }
                    )

                    // Rendered outputs
                    CompositionOutputsSection(
                        outputs: viewModel.renderOutputs,
                        onEditOutput: { output in outputToEdit = output }
                    )

                    // Thumbnails (after render completes)
                    CompositionThumbnailSection(
                        composition: comp,
                        api: viewModel.api
                    )

                    // Publishing
                    CompositionPublishSection(
                        composition: comp,
                        api: viewModel.api
                    )
                }
                .padding()
            }
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .navigationTitle("Edit Composition")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            await viewModel.load()
            if let comp = viewModel.composition {
                editableTitle = comp.title
            }
        }
        .onDisappear { viewModel.stopPolling() }
        .overlay {
            if viewModel.isLoading && viewModel.composition == nil {
                ProgressView().progressViewStyle(.circular)
            }
        }
        .onChange(of: viewModel.errorMessage) { _, newValue in showErrorAlert = newValue != nil }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .alert("Remove Creator Video", isPresented: $showDeleteCreatorAlert) {
            Button("Remove", role: .destructive) {
                Task { await viewModel.deleteCreator() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Remove the creator video from this composition?")
        }
        .alert("Delete Track", isPresented: $showDeleteTrackAlert, presenting: trackToDelete) { track in
            Button("Delete", role: .destructive) {
                Task { await viewModel.deleteTrack(trackId: track.id) }
            }
            Button("Cancel", role: .cancel) { }
        } message: { track in
            Text("Delete \"\(track.label ?? "this track")\"? This cannot be undone.")
        }
        .sheet(item: $trackToEdit) { track in
            CompositionTrackEditSheet(
                track: track,
                creatorDuration: viewModel.composition?.creatorDurationS ?? 0,
                isTimelineMode: viewModel.composition?.mode == "timeline",
                onSave: { request in
                    Task { await viewModel.updateTrack(trackId: track.id, body: request) }
                }
            )
        }
        .sheet(item: $outputToEdit) { output in
            OutputEditSheet(
                output: output,
                compositionId: viewModel.compositionId,
                api: viewModel.api
            )
        }
        .onChange(of: creatorPickerItem) { _, item in
            guard let item else { return }
            creatorPickerItem = nil
            Task { await viewModel.uploadCreatorVideo(item: item) }
        }
        .onChange(of: trackPickerItem) { _, item in
            guard let item else { return }
            trackPickerItem = nil
            Task { await viewModel.uploadTrackVideo(item: item) }
        }
    }

    // MARK: - Title (kept inline — too small to extract)

    @ViewBuilder
    private func titleSection(_ comp: Composition) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.smallSpacing) {
            Text("Title")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            TextField("Composition title", text: $editableTitle)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    Task { await viewModel.save(title: editableTitle) }
                }
        }
        .padding()
        .background(DesignTokens.surface)
        .cornerRadius(DesignTokens.cornerRadius)
    }
}
