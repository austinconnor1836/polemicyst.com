package com.polemicyst.android.ui.screens.clipsgenie

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun DescriptionEditorPanel(
    sharedDescription: String,
    onSharedDescriptionChange: (String) -> Unit,
    platforms: List<PlatformState>,
    onPlatformDescriptionChange: (String, String) -> Unit,
    onGenerateAI: () -> Unit,
    isGenerating: Boolean,
    modifier: Modifier = Modifier,
) {
    var showPerPlatform by remember { mutableStateOf(false) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Description",
            style = MaterialTheme.typography.titleSmall,
        )

        OutlinedTextField(
            value = sharedDescription,
            onValueChange = onSharedDescriptionChange,
            label = { Text("Shared description") },
            minLines = 3,
            maxLines = 6,
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedButton(
            onClick = onGenerateAI,
            enabled = !isGenerating,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (isGenerating) {
                CircularProgressIndicator(strokeWidth = 2.dp)
            } else {
                Icon(Icons.Filled.AutoAwesome, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                Text("Generate with AI")
            }
        }

        // Per-platform overrides
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { showPerPlatform = !showPerPlatform }
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Per-platform descriptions",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            Icon(
                imageVector = if (showPerPlatform) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
        }

        AnimatedVisibility(visible = showPerPlatform) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                platforms.filter { it.selected }.forEach { platform ->
                    OutlinedTextField(
                        value = platform.description,
                        onValueChange = { onPlatformDescriptionChange(platform.key, it) },
                        label = { Text("${platform.name} description") },
                        minLines = 2,
                        maxLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Uses shared description if empty") },
                    )
                }
            }
        }
    }
}
