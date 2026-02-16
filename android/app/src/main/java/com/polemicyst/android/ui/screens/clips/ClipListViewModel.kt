package com.polemicyst.android.ui.screens.clips

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.data.repository.ClipsRepository
import com.polemicyst.android.data.repository.FeedVideoClipsResponse
import com.polemicyst.android.data.repository.FeedVideosRepository
import com.polemicyst.android.data.repository.TriggerClipRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ClipListUiState(
    val isLoading: Boolean = true,
    val videoTitle: String = "",
    val clips: List<ClipRecord> = emptyList(),
    val jobState: String? = null,
    val error: String? = null,
)

@HiltViewModel
class ClipListViewModel @Inject constructor(
    private val feedVideosRepository: FeedVideosRepository,
    private val clipsRepository: ClipsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ClipListUiState())
    val uiState: StateFlow<ClipListUiState> = _uiState.asStateFlow()

    fun loadClips(feedVideoId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            feedVideosRepository.getFeedVideoClips(feedVideoId)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        videoTitle = response.feedVideo.title,
                        clips = response.clips,
                        jobState = response.jobState,
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load clips"
                    )
                }
        }
    }

    fun triggerClipGeneration(feedVideoId: String, userId: String) {
        viewModelScope.launch {
            clipsRepository.triggerClip(
                TriggerClipRequest(feedVideoId = feedVideoId, userId = userId)
            ).onSuccess {
                _uiState.value = _uiState.value.copy(jobState = "waiting")
            }
        }
    }
}
