package com.polemicyst.android.ui.screens.clipsgenie

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.HourglassBottom
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun PlatformListPanel(
    platforms: List<PlatformState>,
    onToggle: (String) -> Unit,
    onConnect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = "Platforms",
            style = MaterialTheme.typography.titleSmall,
        )

        platforms.forEach { platform ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = platform.selected,
                        onCheckedChange = { onToggle(platform.key) },
                        enabled = platform.connected,
                    )
                    Text(
                        text = platform.name,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    when (platform.publishStatus) {
                        PublishStatus.PUBLISHING -> CircularProgressIndicator(
                            modifier = Modifier.padding(end = 8.dp),
                            strokeWidth = 2.dp,
                        )
                        PublishStatus.SUCCESS -> Icon(
                            Icons.Filled.CheckCircle,
                            contentDescription = "Published",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(end = 8.dp),
                        )
                        PublishStatus.FAILED -> Icon(
                            Icons.Filled.Error,
                            contentDescription = "Failed",
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(end = 8.dp),
                        )
                        PublishStatus.IDLE -> {}
                    }

                    if (platform.connected) {
                        Text(
                            text = "Connected",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    } else {
                        TextButton(onClick = { onConnect(platform.key) }) {
                            Icon(
                                Icons.Filled.LinkOff,
                                contentDescription = null,
                                modifier = Modifier.padding(end = 4.dp),
                            )
                            Text("Connect")
                        }
                    }
                }
            }
        }
    }
}
