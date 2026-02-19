package com.polemicyst.android.ui.screens.feeds

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.polemicyst.android.data.repository.VideoFeed
import com.polemicyst.android.ui.components.ViralitySettingsPanel
import com.polemicyst.android.ui.components.ViralitySettingsState
import com.polemicyst.android.ui.components.toState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedSettingsSheet(
    feed: VideoFeed,
    onDismiss: () -> Unit,
    onSave: (autoGenerateClips: Boolean, viralitySettings: ViralitySettingsState) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var autoGenerate by remember { mutableStateOf(feed.autoGenerateClips) }
    var viralityState by remember { mutableStateOf(feed.viralitySettings.toState()) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Feed Settings",
                style = MaterialTheme.typography.headlineSmall,
            )

            Text(
                text = feed.name,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            HorizontalDivider()

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Auto-generate Clips",
                    style = MaterialTheme.typography.bodyLarge,
                )
                Switch(
                    checked = autoGenerate,
                    onCheckedChange = { autoGenerate = it },
                )
            }

            HorizontalDivider()

            ViralitySettingsPanel(
                state = viralityState,
                onStateChange = { viralityState = it },
            )

            Spacer(modifier = Modifier.height(8.dp))

            Button(
                onClick = { onSave(autoGenerate, viralityState) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Save Settings")
            }
        }
    }
}
