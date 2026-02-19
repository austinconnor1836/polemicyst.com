package com.polemicyst.android.ui.screens.videodetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.polemicyst.android.ui.components.AspectRatio
import com.polemicyst.android.ui.components.AspectRatioSelector
import com.polemicyst.android.ui.components.ViralitySettingsPanel
import com.polemicyst.android.ui.components.ViralitySettingsState

@Composable
fun GenerateClipsDialog(
    onDismiss: () -> Unit,
    onGenerate: (aspectRatio: AspectRatio, viralitySettings: ViralitySettingsState) -> Unit,
) {
    var aspectRatio by remember { mutableStateOf(AspectRatio.PORTRAIT) }
    var viralityState by remember { mutableStateOf(ViralitySettingsState()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Generate Clips") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 500.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = "Aspect Ratio",
                    style = MaterialTheme.typography.titleSmall,
                )
                AspectRatioSelector(
                    selected = aspectRatio,
                    onSelect = { aspectRatio = it },
                )

                Spacer(modifier = Modifier.height(8.dp))

                ViralitySettingsPanel(
                    state = viralityState,
                    onStateChange = { viralityState = it },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onGenerate(aspectRatio, viralityState) },
            ) {
                Text("Generate")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}
