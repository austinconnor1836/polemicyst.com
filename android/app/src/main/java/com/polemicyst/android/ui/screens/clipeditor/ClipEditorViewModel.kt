package com.polemicyst.android.ui.screens.clipeditor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.data.repository.ClipsRepository
import com.polemicyst.android.data.repository.ExportClipResponse
import com.polemicyst.android.data.repository.UpdateClipRequest
import com.polemicyst.android.ui.components.AspectRatio
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ClipEditorUiState(
    val isLoading: Boolean = true,
    val clip: ClipRecord? = null,
    val aspectRatio: AspectRatio = AspectRatio.LANDSCAPE,
    val cropPosition: CropPosition = CropPosition.CENTER,
    val backgroundFill: BackgroundFill = BackgroundFill.BLUR,
    val captionSettings: CaptionSettings = CaptionSettings(),
    val showSafeZone: Boolean = false,
    val title: String = "",
    val description: String = "",
    val isSaving: Boolean = false,
    val isExporting: Boolean = false,
    val exportResult: ExportClipResponse? = null,
    val error: String? = null,
)

enum class BackgroundFill(val label: String) {
    BLUR("Blur"),
    BLACK("Black"),
    WHITE("White"),
    GRADIENT("Gradient"),
}

@HiltViewModel
class ClipEditorViewModel @Inject constructor(
    private val clipsRepository: ClipsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ClipEditorUiState())
    val uiState: StateFlow<ClipEditorUiState> = _uiState.asStateFlow()

    fun loadClip(clipId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            clipsRepository.getClips()
                .onSuccess { clips ->
                    val clip = clips.find { it.id == clipId }
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        clip = clip,
                        title = clip?.videoTitle ?: "",
                        description = clip?.sharedDescription ?: "",
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load clip"
                    )
                }
        }
    }

    fun setAspectRatio(ratio: AspectRatio) {
        _uiState.value = _uiState.value.copy(aspectRatio = ratio)
    }

    fun setCropPosition(position: CropPosition) {
        _uiState.value = _uiState.value.copy(cropPosition = position)
    }

    fun setBackgroundFill(fill: BackgroundFill) {
        _uiState.value = _uiState.value.copy(backgroundFill = fill)
    }

    fun setCaptionSettings(settings: CaptionSettings) {
        _uiState.value = _uiState.value.copy(captionSettings = settings)
    }

    fun toggleSafeZone() {
        _uiState.value = _uiState.value.copy(showSafeZone = !_uiState.value.showSafeZone)
    }

    fun setTitle(title: String) {
        _uiState.value = _uiState.value.copy(title = title)
    }

    fun setDescription(description: String) {
        _uiState.value = _uiState.value.copy(description = description)
    }

    fun updateTrim(clipId: String, startS: Double, endS: Double) {
        viewModelScope.launch {
            clipsRepository.updateTrim(clipId, startS, endS)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        clip = _uiState.value.clip?.copy(trimStartS = startS, trimEndS = endS)
                    )
                }
        }
    }

    fun saveMetadata(clipId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true)
            clipsRepository.updateClip(
                clipId,
                UpdateClipRequest(
                    videoTitle = _uiState.value.title.ifBlank { null },
                    sharedDescription = _uiState.value.description.ifBlank { null },
                )
            ).onSuccess {
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    clip = _uiState.value.clip?.copy(
                        videoTitle = _uiState.value.title.ifBlank { null },
                        sharedDescription = _uiState.value.description.ifBlank { null },
                    )
                )
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    error = e.message ?: "Failed to save"
                )
            }
        }
    }

    fun exportClip(clipId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isExporting = true)
            clipsRepository.exportClip(clipId)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        isExporting = false,
                        exportResult = response,
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isExporting = false,
                        error = e.message ?: "Export failed"
                    )
                }
        }
    }
}
