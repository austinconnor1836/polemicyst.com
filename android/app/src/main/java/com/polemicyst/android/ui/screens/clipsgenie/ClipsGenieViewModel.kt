package com.polemicyst.android.ui.screens.clipsgenie

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.AuthStatusResponse
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.data.repository.ClipsRepository
import com.polemicyst.android.data.repository.PublishingRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PlatformState(
    val name: String,
    val key: String,
    val connected: Boolean = false,
    val selected: Boolean = false,
    val description: String = "",
    val publishStatus: PublishStatus = PublishStatus.IDLE,
)

enum class PublishStatus {
    IDLE, PUBLISHING, SUCCESS, FAILED
}

data class ClipsGenieUiState(
    val isLoading: Boolean = true,
    val clips: List<ClipRecord> = emptyList(),
    val selectedClipId: String? = null,
    val platforms: List<PlatformState> = emptyList(),
    val sharedDescription: String = "",
    val isGeneratingDescription: Boolean = false,
    val isPublishing: Boolean = false,
    val blueskyHandle: String = "",
    val blueskyAppPassword: String = "",
    val showBlueskyLogin: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class ClipsGenieViewModel @Inject constructor(
    private val clipsRepository: ClipsRepository,
    private val publishingRepository: PublishingRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ClipsGenieUiState())
    val uiState: StateFlow<ClipsGenieUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            val clipsResult = clipsRepository.getClips()
            val authResult = publishingRepository.getAuthStatus()

            val clips = clipsResult.getOrDefault(emptyList())
            val auth = authResult.getOrDefault(AuthStatusResponse())

            _uiState.value = _uiState.value.copy(
                isLoading = false,
                clips = clips,
                platforms = buildPlatformList(auth),
            )
        }
    }

    private fun buildPlatformList(auth: AuthStatusResponse) = listOf(
        PlatformState("Bluesky", "bluesky", auth.bluesky),
        PlatformState("Facebook", "facebook", auth.facebook),
        PlatformState("Instagram", "instagram", auth.instagram),
        PlatformState("YouTube", "youtube", auth.youtube),
        PlatformState("X (Twitter)", "twitter", auth.twitter),
    )

    fun selectClip(clipId: String) {
        _uiState.value = _uiState.value.copy(selectedClipId = clipId)
    }

    fun togglePlatform(key: String) {
        _uiState.value = _uiState.value.copy(
            platforms = _uiState.value.platforms.map {
                if (it.key == key) it.copy(selected = !it.selected) else it
            }
        )
    }

    fun setPlatformDescription(key: String, description: String) {
        _uiState.value = _uiState.value.copy(
            platforms = _uiState.value.platforms.map {
                if (it.key == key) it.copy(description = description) else it
            }
        )
    }

    fun setSharedDescription(text: String) {
        _uiState.value = _uiState.value.copy(sharedDescription = text)
    }

    fun generateDescription() {
        val clipId = _uiState.value.selectedClipId ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isGeneratingDescription = true)
            publishingRepository.generateDescription(clipId)
                .onSuccess { description ->
                    _uiState.value = _uiState.value.copy(
                        isGeneratingDescription = false,
                        sharedDescription = description,
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isGeneratingDescription = false,
                        error = e.message ?: "Failed to generate description"
                    )
                }
        }
    }

    fun setBlueskyHandle(handle: String) {
        _uiState.value = _uiState.value.copy(blueskyHandle = handle)
    }

    fun setBlueskyAppPassword(password: String) {
        _uiState.value = _uiState.value.copy(blueskyAppPassword = password)
    }

    fun toggleBlueskyLogin() {
        _uiState.value = _uiState.value.copy(showBlueskyLogin = !_uiState.value.showBlueskyLogin)
    }

    fun blueskyLogin() {
        viewModelScope.launch {
            publishingRepository.blueskyLogin(
                _uiState.value.blueskyHandle,
                _uiState.value.blueskyAppPassword,
            ).onSuccess {
                _uiState.value = _uiState.value.copy(
                    showBlueskyLogin = false,
                    platforms = _uiState.value.platforms.map {
                        if (it.key == "bluesky") it.copy(connected = true) else it
                    }
                )
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    error = e.message ?: "Bluesky login failed"
                )
            }
        }
    }

    fun publishAll() {
        val clipId = _uiState.value.selectedClipId ?: return
        val selectedPlatforms = _uiState.value.platforms.filter { it.selected && it.connected }
        if (selectedPlatforms.isEmpty()) return

        _uiState.value = _uiState.value.copy(isPublishing = true)

        selectedPlatforms.forEach { platform ->
            viewModelScope.launch {
                updatePlatformStatus(platform.key, PublishStatus.PUBLISHING)
                val description = platform.description.ifBlank { _uiState.value.sharedDescription }

                val result = when (platform.key) {
                    "bluesky" -> publishingRepository.blueskyPost(description, clipId)
                    "facebook" -> publishingRepository.facebookUpload(clipId, description)
                    "instagram" -> publishingRepository.instagramUpload(clipId, description)
                    "youtube" -> publishingRepository.youtubeUpload(clipId, null, description)
                    "twitter" -> publishingRepository.twitterPost(description, clipId)
                    else -> Result.failure(Exception("Unknown platform"))
                }

                updatePlatformStatus(
                    platform.key,
                    if (result.isSuccess) PublishStatus.SUCCESS else PublishStatus.FAILED,
                )

                // Check if all are done
                val current = _uiState.value.platforms
                if (current.filter { it.selected }.all { it.publishStatus != PublishStatus.PUBLISHING }) {
                    _uiState.value = _uiState.value.copy(isPublishing = false)
                }
            }
        }
    }

    private fun updatePlatformStatus(key: String, status: PublishStatus) {
        _uiState.value = _uiState.value.copy(
            platforms = _uiState.value.platforms.map {
                if (it.key == key) it.copy(publishStatus = status) else it
            }
        )
    }
}
