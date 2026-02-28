package com.polemicyst.android.ui.screens.clipplayer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.data.repository.ClipsRepository
import com.polemicyst.android.data.repository.ExportClipResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ClipPlayerUiState(
    val isLoading: Boolean = true,
    val clip: ClipRecord? = null,
    val isExporting: Boolean = false,
    val exportResult: ExportClipResponse? = null,
    val error: String? = null,
)

@HiltViewModel
class ClipPlayerViewModel @Inject constructor(
    private val clipsRepository: ClipsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ClipPlayerUiState())
    val uiState: StateFlow<ClipPlayerUiState> = _uiState.asStateFlow()

    fun loadClip(clipId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            clipsRepository.getClips()
                .onSuccess { clips ->
                    val clip = clips.find { it.id == clipId }
                    _uiState.value = _uiState.value.copy(isLoading = false, clip = clip)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load clip"
                    )
                }
        }
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
