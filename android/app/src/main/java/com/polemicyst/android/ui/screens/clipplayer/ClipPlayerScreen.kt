package com.polemicyst.android.ui.screens.clipplayer

import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClipPlayerScreen(
    clipId: String,
    onBack: () -> Unit,
    viewModel: ClipPlayerViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(clipId) {
        viewModel.loadClip(clipId)
    }

    val exoPlayer = remember {
        ExoPlayer.Builder(context).build()
    }

    DisposableEffect(Unit) {
        onDispose { exoPlayer.release() }
    }

    LaunchedEffect(uiState.clip?.s3Url) {
        uiState.clip?.s3Url?.let { url ->
            exoPlayer.setMediaItem(MediaItem.fromUri(url))
            exoPlayer.prepare()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.clip?.videoTitle ?: "Player") },
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
            uiState.clip != null -> {
                val clip = uiState.clip!!
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                ) {
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

                    Spacer(modifier = Modifier.height(16.dp))

                    // Trim controls
                    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                        Text(
                            text = "Trim",
                            style = MaterialTheme.typography.titleMedium,
                        )

                        var trimStart by remember {
                            mutableFloatStateOf(clip.trimStartS?.toFloat() ?: 0f)
                        }
                        var trimEnd by remember {
                            mutableFloatStateOf(clip.trimEndS?.toFloat() ?: 60f)
                        }

                        RangeSlider(
                            value = trimStart..trimEnd,
                            onValueChange = { range ->
                                trimStart = range.start
                                trimEnd = range.endInclusive
                            },
                            onValueChangeFinished = {
                                viewModel.updateTrim(
                                    clipId,
                                    trimStart.toDouble(),
                                    trimEnd.toDouble(),
                                )
                            },
                            valueRange = 0f..300f,
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Row(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = "%.1fs".format(trimStart),
                                style = MaterialTheme.typography.labelMedium,
                            )
                            Spacer(modifier = Modifier.weight(1f))
                            Text(
                                text = "%.1fs".format(trimEnd),
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        Button(
                            onClick = { viewModel.exportClip(clipId) },
                            enabled = !uiState.isExporting,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            if (uiState.isExporting) {
                                CircularProgressIndicator()
                            } else {
                                Text("Export Clip")
                            }
                        }

                        uiState.exportResult?.let { result ->
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Exported: %.1fs, %d bytes".format(
                                    result.durationS ?: 0.0,
                                    result.size ?: 0
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}
