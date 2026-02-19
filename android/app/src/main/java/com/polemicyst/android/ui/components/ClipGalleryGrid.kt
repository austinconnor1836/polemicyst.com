package com.polemicyst.android.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.polemicyst.android.data.repository.ClipRecord

@Composable
fun ClipGalleryGrid(
    clips: List<ClipRecord>,
    onClipClick: (String) -> Unit,
    onDownload: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (clips.isEmpty()) {
        Text(
            text = "No clips yet",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.padding(16.dp),
        )
        return
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(clips, key = { it.id }) { clip ->
            ClipGridCard(
                clip = clip,
                onClick = { onClipClick(clip.id) },
                onDownload = { onDownload(clip.id) },
            )
        }
    }
}

@Composable
private fun ClipGridCard(
    clip: ClipRecord,
    onClick: () -> Unit,
    onDownload: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Column {
            VideoThumbnail(thumbnailUrl = null)
            Column(modifier = Modifier.padding(8.dp)) {
                Text(
                    text = clip.videoTitle ?: "Untitled",
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                clip.trimStartS?.let { start ->
                    clip.trimEndS?.let { end ->
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "%.1fs - %.1fs".format(start, end),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    IconButton(onClick = onClick) {
                        Icon(
                            Icons.Filled.Edit,
                            contentDescription = "Edit",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                    IconButton(onClick = onDownload) {
                        Icon(
                            Icons.Filled.Download,
                            contentDescription = "Download",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}
