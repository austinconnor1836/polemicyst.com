package com.polemicyst.android.ui.screens.feeddetail

import android.app.Application
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.polemicyst.android.data.repository.FeedVideo
import com.polemicyst.android.data.repository.FeedVideosRepository
import com.polemicyst.android.data.repository.UploadRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

data class FeedDetailUiState(
    val isLoading: Boolean = true,
    val videos: List<FeedVideo> = emptyList(),
    val searchQuery: String = "",
    val uploadProgress: Float? = null,
    val error: String? = null,
) {
    val filteredVideos: List<FeedVideo>
        get() = if (searchQuery.isBlank()) videos
        else videos.filter { it.title.contains(searchQuery, ignoreCase = true) }
}

@HiltViewModel
class FeedDetailViewModel @Inject constructor(
    private val feedVideosRepository: FeedVideosRepository,
    private val uploadRepository: UploadRepository,
    private val application: Application,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FeedDetailUiState())
    val uiState: StateFlow<FeedDetailUiState> = _uiState.asStateFlow()

    private var currentFeedId: String? = null

    fun loadVideos(feedId: String) {
        currentFeedId = feedId
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            feedVideosRepository.getFeedVideos()
                .onSuccess { all ->
                    val filtered = all.filter { it.feedId == feedId }
                    _uiState.value = _uiState.value.copy(isLoading = false, videos = filtered)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Failed to load videos"
                    )
                }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
    }

    fun uploadFile(uri: Uri, feedId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(uploadProgress = 0f)
            val tempFile = withContext(Dispatchers.IO) {
                val inputStream = application.contentResolver.openInputStream(uri)
                    ?: throw Exception("Cannot open file")
                val fileName = uri.lastPathSegment ?: "upload.mp4"
                val temp = File.createTempFile("upload_", "_$fileName", application.cacheDir)
                inputStream.use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
                temp
            }

            uploadRepository.uploadFile(
                file = tempFile,
                feedId = feedId,
                title = null,
                onProgress = { progress ->
                    _uiState.value = _uiState.value.copy(uploadProgress = progress)
                },
            ).onSuccess {
                _uiState.value = _uiState.value.copy(uploadProgress = null)
                loadVideos(feedId)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    uploadProgress = null,
                    error = e.message ?: "Upload failed"
                )
            }

            tempFile.delete()
        }
    }

    fun importFromUrl(url: String, feedId: String, title: String?) {
        viewModelScope.launch {
            uploadRepository.importFromUrl(url, feedId, title)
                .onSuccess { loadVideos(feedId) }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message ?: "Import failed"
                    )
                }
        }
    }
}
