package com.polemicyst.android.ui.screens.clipeditor

import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import com.polemicyst.android.ui.components.AspectRatioSelector
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator
import com.polemicyst.android.ui.components.SafeZoneOverlay

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ClipEditorScreen(
    clipId: String,
    onBack: () -> Unit,
    viewModel: ClipEditorViewModel = hiltViewModel(),
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
                title = { Text(uiState.clip?.videoTitle ?: "Edit Clip") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconToggleButton(
                        checked = uiState.showSafeZone,
                        onCheckedChange = { viewModel.toggleSafeZone() },
                    ) {
                        Icon(
                            Icons.Filled.GridOn,
                            contentDescription = "Safe zone",
                            tint = if (uiState.showSafeZone)
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
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
                        .padding(padding)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    // Video preview with dynamic aspect ratio
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(
                                uiState.aspectRatio.widthRatio / uiState.aspectRatio.heightRatio
                            ),
                    ) {
                        AndroidView(
                            factory = { ctx ->
                                PlayerView(ctx).apply {
                                    player = exoPlayer
                                    layoutParams = FrameLayout.LayoutParams(
                                        ViewGroup.LayoutParams.MATCH_PARENT,
                                        ViewGroup.LayoutParams.MATCH_PARENT,
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                        if (uiState.showSafeZone) {
                            SafeZoneOverlay()
                        }
                    }

                    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                        // Aspect ratio selector
                        AspectRatioSelector(
                            selected = uiState.aspectRatio,
                            onSelect = { viewModel.setAspectRatio(it) },
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        // Crop position
                        CropPresetSelector(
                            selected = uiState.cropPosition,
                            onSelect = { viewModel.setCropPosition(it) },
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        // Background fill
                        Text(
                            text = "Background Fill",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            BackgroundFill.entries.forEach { fill ->
                                FilterChip(
                                    selected = uiState.backgroundFill == fill,
                                    onClick = { viewModel.setBackgroundFill(fill) },
                                    label = { Text(fill.label) },
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // Trim controls
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(
                                    text = "Trim",
                                    style = MaterialTheme.typography.titleSmall,
                                )

                                var trimStart by remember(clip.trimStartS) {
                                    mutableFloatStateOf(clip.trimStartS?.toFloat() ?: 0f)
                                }
                                var trimEnd by remember(clip.trimEndS) {
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

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        text = formatTime(trimStart),
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                    Text(
                                        text = "Duration: ${formatTime(trimEnd - trimStart)}",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    Text(
                                        text = formatTime(trimEnd),
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // Caption settings
                        CaptionSettingsCard(
                            settings = uiState.captionSettings,
                            onSettingsChange = { viewModel.setCaptionSettings(it) },
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        // Metadata editing
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Text(
                                    text = "Metadata",
                                    style = MaterialTheme.typography.titleSmall,
                                )

                                OutlinedTextField(
                                    value = uiState.title,
                                    onValueChange = { viewModel.setTitle(it) },
                                    label = { Text("Title") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                )

                                OutlinedTextField(
                                    value = uiState.description,
                                    onValueChange = { viewModel.setDescription(it) },
                                    label = { Text("Description") },
                                    minLines = 3,
                                    maxLines = 5,
                                    modifier = Modifier.fillMaxWidth(),
                                )

                                Button(
                                    onClick = { viewModel.saveMetadata(clipId) },
                                    enabled = !uiState.isSaving,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(if (uiState.isSaving) "Saving..." else "Save Metadata")
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // Export
                        OutlinedButton(
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
                            Text(
                                text = "Exported: %.1fs, %d bytes".format(
                                    result.durationS ?: 0.0,
                                    result.size ?: 0
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }

                        Spacer(modifier = Modifier.height(32.dp))
                    }
                }
            }
        }
    }
}

private fun formatTime(seconds: Float): String {
    val totalSeconds = seconds.toInt()
    val min = totalSeconds / 60
    val sec = totalSeconds % 60
    return "%d:%02d".format(min, sec)
}
