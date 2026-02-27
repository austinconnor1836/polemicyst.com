package com.polemicyst.android.ui.screens.videodetail

import android.app.Application
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.api.ApiError
import com.polemicyst.android.data.api.ApiException
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.data.repository.ClipsRepository
import com.polemicyst.android.data.repository.FeedVideo
import com.polemicyst.android.data.repository.FeedVideosRepository
import com.polemicyst.android.data.repository.SubscriptionInfo
import com.polemicyst.android.data.repository.SubscriptionRepository
import com.polemicyst.android.data.repository.TriggerClipRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class VideoDetailUiState(
    val isLoading: Boolean = true,
    val feedVideo: FeedVideo? = null,
    val clips: List<ClipRecord> = emptyList(),
    val jobState: String? = null,
    val isTranscribing: Boolean = false,
    val isGenerating: Boolean = false,
    val error: String? = null,
    val subscription: SubscriptionInfo? = null,
    val quotaError: ApiError? = null,
)

@HiltViewModel
class VideoDetailViewModel @Inject constructor(
    private val feedVideosRepository: FeedVideosRepository,
    private val clipsRepository: ClipsRepository,
    private val subscriptionRepository: SubscriptionRepository,
    private val application: Application,
) : ViewModel() {

    private val _uiState = MutableStateFlow(VideoDetailUiState())
    val uiState: StateFlow<VideoDetailUiState> = _uiState.asStateFlow()

    private var pollingJob: Job? = null

    fun loadVideoDetail(feedVideoId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            subscriptionRepository.refresh()

            feedVideosRepository.getFeedVideoClips(feedVideoId)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        feedVideo = response.feedVideo,
                        clips = response.clips,
                        jobState = response.jobState,
                        subscription = subscriptionRepository.subscription.value,
                    )
                    if (response.jobState in listOf("waiting", "active", "delayed")) {
                        startPolling(feedVideoId)
                    }
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load video",
                    )
                }
        }
    }

    fun dismissQuotaError() {
        _uiState.value = _uiState.value.copy(quotaError = null)
    }

    fun transcribe(feedVideoId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isTranscribing = true)
            feedVideosRepository.transcribe(feedVideoId)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(isTranscribing = false)
                    loadVideoDetail(feedVideoId)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isTranscribing = false,
                        error = e.message ?: "Transcription failed"
                    )
                }
        }
    }

    fun generateClips(
        feedVideoId: String,
        userId: String,
        aspectRatio: String?,
        scoringMode: String,
        includeAudio: Boolean,
        saferClips: Boolean,
        targetPlatform: String,
        contentStyle: String,
        llmProvider: String,
        clipLength: String?,
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isGenerating = true)
            clipsRepository.triggerClip(
                TriggerClipRequest(
                    feedVideoId = feedVideoId,
                    userId = userId,
                    aspectRatio = aspectRatio,
                    scoringMode = scoringMode,
                    includeAudio = includeAudio,
                    saferClips = saferClips,
                    targetPlatform = targetPlatform,
                    contentStyle = contentStyle,
                    llmProvider = llmProvider,
                    clipLength = if (clipLength == "auto") null else clipLength,
                )
            ).onSuccess {
                _uiState.value = _uiState.value.copy(
                    isGenerating = false,
                    jobState = "waiting",
                )
                startPolling(feedVideoId)
            }.onFailure { e ->
                if (e is ApiException && e.statusCode == 403) {
                    _uiState.value = _uiState.value.copy(
                        isGenerating = false,
                        quotaError = e.apiError,
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        isGenerating = false,
                        error = e.message ?: "Failed to start clip generation",
                    )
                }
            }
        }
    }

    fun downloadClip(clipId: String) {
        val clip = _uiState.value.clips.find { it.id == clipId } ?: return
        val url = clip.s3Url ?: return

        val downloadManager = application.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(clip.videoTitle ?: "Clip")
            .setDescription("Downloading clip...")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                "polemicyst_clip_${clip.id}.mp4"
            )
        downloadManager.enqueue(request)
    }

    private fun startPolling(feedVideoId: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            while (true) {
                delay(10_000)
                feedVideosRepository.getFeedVideoClips(feedVideoId)
                    .onSuccess { response ->
                        _uiState.value = _uiState.value.copy(
                            feedVideo = response.feedVideo,
                            clips = response.clips,
                            jobState = response.jobState,
                        )
                        if (response.jobState !in listOf("waiting", "active", "delayed")) {
                            pollingJob?.cancel()
                        }
                    }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        pollingJob?.cancel()
    }
}
