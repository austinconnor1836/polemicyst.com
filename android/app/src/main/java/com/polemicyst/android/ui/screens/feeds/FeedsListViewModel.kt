package com.polemicyst.android.ui.screens.feeds

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.FeedsRepository
import com.polemicyst.android.data.repository.UpdateFeedRequest
import com.polemicyst.android.data.repository.VideoFeed
import com.polemicyst.android.ui.components.ViralitySettingsState
import com.polemicyst.android.ui.components.toModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FeedsListUiState(
    val isLoading: Boolean = true,
    val feeds: List<VideoFeed> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class FeedsListViewModel @Inject constructor(
    private val feedsRepository: FeedsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FeedsListUiState())
    val uiState: StateFlow<FeedsListUiState> = _uiState.asStateFlow()

    init {
        loadFeeds()
    }

    fun loadFeeds() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            feedsRepository.getFeeds()
                .onSuccess { feeds ->
                    _uiState.value = _uiState.value.copy(isLoading = false, feeds = feeds)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load feeds"
                    )
                }
        }
    }

    fun createFeed(name: String, sourceUrl: String, pollingInterval: Int?) {
        viewModelScope.launch {
            feedsRepository.createFeed(name, sourceUrl, pollingInterval)
                .onSuccess { loadFeeds() }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message ?: "Failed to create feed"
                    )
                }
        }
    }

    fun updateFeedSettings(feedId: String, autoGenerateClips: Boolean, viralitySettings: ViralitySettingsState) {
        viewModelScope.launch {
            feedsRepository.updateFeed(
                feedId,
                UpdateFeedRequest(
                    autoGenerateClips = autoGenerateClips,
                    viralitySettings = viralitySettings.toModel(),
                )
            ).onSuccess { loadFeeds() }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message ?: "Failed to update feed settings"
                    )
                }
        }
    }

    fun deleteFeed(id: String) {
        viewModelScope.launch {
            feedsRepository.deleteFeed(id).onSuccess { loadFeeds() }
        }
    }
}
