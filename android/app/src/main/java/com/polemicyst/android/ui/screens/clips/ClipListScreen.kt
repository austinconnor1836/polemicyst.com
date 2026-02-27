package com.polemicyst.android.ui.screens.clips

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator
import com.polemicyst.android.ui.components.VideoThumbnail

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClipListScreen(
    feedVideoId: String,
    onClipClick: (clipId: String) -> Unit,
    onBack: () -> Unit,
    viewModel: ClipListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(feedVideoId) {
        viewModel.loadClips(feedVideoId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = uiState.videoTitle.ifEmpty { "Clips" },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            uiState.jobState?.let { state ->
                if (state in listOf("waiting", "active", "delayed")) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
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

            when {
                uiState.isLoading -> LoadingIndicator()
                uiState.error != null -> ErrorBanner(message = uiState.error!!)
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(uiState.clips, key = { it.id }) { clip ->
                        ClipCard(
                            clip = clip,
                            onClick = { onClipClick(clip.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ClipCard(
    clip: ClipRecord,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Column {
            VideoThumbnail(thumbnailUrl = null)
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = clip.videoTitle ?: "Untitled clip",
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                clip.trimStartS?.let { start ->
                    clip.trimEndS?.let { end ->
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "%.1fs - %.1fs".format(start, end),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
