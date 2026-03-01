package com.polemicyst.android.ui.screens.videodetail

import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.polemicyst.android.ui.common.UpgradePromptDialog
import com.polemicyst.android.ui.components.ClipGalleryGrid
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator
import com.polemicyst.android.ui.components.TranscriptSection

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoDetailScreen(
    feedVideoId: String,
    onClipClick: (clipId: String) -> Unit,
    onBack: () -> Unit,
    viewModel: VideoDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var showGenerateDialog by remember { mutableStateOf(false) }

    LaunchedEffect(feedVideoId) {
        viewModel.loadVideoDetail(feedVideoId)
    }

    val exoPlayer = remember {
        ExoPlayer.Builder(context).build()
    }

    DisposableEffect(Unit) {
        onDispose { exoPlayer.release() }
    }

    LaunchedEffect(uiState.feedVideo?.s3Url) {
        uiState.feedVideo?.s3Url?.let { url ->
            exoPlayer.setMediaItem(MediaItem.fromUri(url))
            exoPlayer.prepare()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = uiState.feedVideo?.title ?: "Video Detail",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        when {
            uiState.isLoading -> LoadingIndicator(modifier = Modifier.padding(padding))
            uiState.error != null -> ErrorBanner(
                message = uiState.error!!,
                modifier = Modifier.padding(padding),
            )
            else -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // Video player
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            player = exoPlayer
                            layoutParams = FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.WRAP_CONTENT,
                            )
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f),
                )

                // Job status badge
                uiState.jobState?.let { state ->
                    if (state in listOf("waiting", "active", "delayed")) {
                        Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    text = "Generating clips...",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                Text(
                                    text = state.uppercase(),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }
                    }
                }

                // Transcript section
                TranscriptSection(
                    transcript = uiState.feedVideo?.transcript,
                    isTranscribing = uiState.isTranscribing,
                    onTranscribe = { viewModel.transcribe(feedVideoId) },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )

                // Generate Clips button
                Button(
                    onClick = { showGenerateDialog = true },
                    enabled = !uiState.isGenerating && uiState.jobState !in listOf("waiting", "active", "delayed"),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                ) {
                    Text(
                        if (uiState.isGenerating) "Starting..."
                        else "Generate Clips"
                    )
                }

                // Clips gallery
                if (uiState.clips.isNotEmpty()) {
                    Text(
                        text = "Clips (${uiState.clips.size})",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                    ClipGalleryGrid(
                        clips = uiState.clips,
                        onClipClick = onClipClick,
                        onDownload = { clipId -> viewModel.downloadClip(clipId) },
                        modifier = Modifier.height(400.dp),
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }

    if (showGenerateDialog) {
        GenerateClipsDialog(
            onDismiss = { showGenerateDialog = false },
            onGenerate = { aspectRatio, viralitySettings ->
                viewModel.generateClips(
                    feedVideoId = feedVideoId,
                    userId = "",
                    aspectRatio = aspectRatio.value,
                    scoringMode = viralitySettings.scoringMode,
                    includeAudio = viralitySettings.includeAudio,
                    saferClips = viralitySettings.saferClips,
                    targetPlatform = viralitySettings.targetPlatform,
                    contentStyle = viralitySettings.contentStyle,
                    llmProvider = viralitySettings.llmProvider,
                    clipLength = viralitySettings.clipLength,
                )
                showGenerateDialog = false
            },
            clipsUsed = uiState.subscription?.usage?.clipsThisMonth ?: 0,
            clipsLimit = uiState.subscription?.limits?.clipsPerMonth ?: -1,
            allowedProviders = uiState.subscription?.limits?.allowedProviders ?: emptyList(),
        )
    }

    uiState.quotaError?.let { apiError ->
        UpgradePromptDialog(
            apiError = apiError,
            onDismiss = { viewModel.dismissQuotaError() },
            onUpgrade = {
                viewModel.dismissQuotaError()
                val url = uiState.subscription?.billingPortalUrl ?: "https://polemicyst.com/pricing"
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            },
        )
    }
}
