package com.polemicyst.android.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.polemicyst.android.data.repository.ViralitySettings

data class ViralitySettingsState(
    val targetPlatform: String = "all",
    val contentStyle: String = "auto",
    val scoringMode: String = "heuristic",
    val llmProvider: String = "gemini",
    val strictness: String = "medium",
    val includeAudio: Boolean = false,
    val saferClips: Boolean = false,
    val clipLength: String = "auto",
)

fun ViralitySettings?.toState(): ViralitySettingsState {
    if (this == null) return ViralitySettingsState()
    return ViralitySettingsState(
        targetPlatform = targetPlatform ?: "all",
        contentStyle = contentStyle ?: "auto",
        scoringMode = scoringMode ?: "heuristic",
        llmProvider = llmProvider ?: "gemini",
        strictness = strictness ?: "medium",
        includeAudio = includeAudio ?: false,
        saferClips = saferClips ?: false,
        clipLength = clipLength ?: "auto",
    )
}

fun ViralitySettingsState.toModel(): ViralitySettings = ViralitySettings(
    targetPlatform = targetPlatform,
    contentStyle = contentStyle,
    scoringMode = scoringMode,
    llmProvider = llmProvider,
    strictness = strictness,
    includeAudio = includeAudio,
    saferClips = saferClips,
    clipLength = clipLength,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViralitySettingsPanel(
    state: ViralitySettingsState,
    onStateChange: (ViralitySettingsState) -> Unit,
    modifier: Modifier = Modifier,
) {
    var showAdvanced by remember { mutableStateOf(false) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Virality Settings",
            style = MaterialTheme.typography.titleSmall,
        )

        // Target Platform
        DropdownSelector(
            label = "Target Platform",
            selected = state.targetPlatform,
            options = listOf("all", "reels", "shorts", "youtube"),
            labels = listOf("All Platforms", "Reels", "Shorts", "YouTube"),
            onSelect = { onStateChange(state.copy(targetPlatform = it)) },
        )

        // Content Style
        DropdownSelector(
            label = "Content Style",
            selected = state.contentStyle,
            options = listOf("auto", "politics", "comedy", "education", "podcast", "gaming", "vlog", "other"),
            labels = listOf("Auto-detect", "Politics", "Comedy", "Education", "Podcast", "Gaming", "Vlog", "Other"),
            onSelect = { onStateChange(state.copy(contentStyle = it)) },
        )

        // Scoring Mode
        DropdownSelector(
            label = "Scoring Mode",
            selected = state.scoringMode,
            options = listOf("heuristic", "hybrid", "gemini"),
            labels = listOf("Heuristic (fast)", "Hybrid", "Gemini (AI)"),
            onSelect = { onStateChange(state.copy(scoringMode = it)) },
        )

        // Safer Clips toggle
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Safer Clips",
                style = MaterialTheme.typography.bodyMedium,
            )
            Switch(
                checked = state.saferClips,
                onCheckedChange = { onStateChange(state.copy(saferClips = it)) },
            )
        }

        // Advanced section
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { showAdvanced = !showAdvanced }
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Advanced",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            Icon(
                imageVector = if (showAdvanced) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = if (showAdvanced) "Collapse" else "Expand",
                tint = MaterialTheme.colorScheme.primary,
            )
        }

        AnimatedVisibility(visible = showAdvanced) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // LLM Provider
                DropdownSelector(
                    label = "LLM Provider",
                    selected = state.llmProvider,
                    options = listOf("gemini", "ollama"),
                    labels = listOf("Gemini", "Ollama"),
                    onSelect = { onStateChange(state.copy(llmProvider = it)) },
                )

                // Strictness
                DropdownSelector(
                    label = "Strictness",
                    selected = state.strictness,
                    options = listOf("low", "medium", "high", "very_high"),
                    labels = listOf("Low", "Medium", "High", "Very High"),
                    onSelect = { onStateChange(state.copy(strictness = it)) },
                )

                // Clip Length
                DropdownSelector(
                    label = "Clip Length",
                    selected = state.clipLength,
                    options = listOf("auto", "15", "30", "60"),
                    labels = listOf("Auto", "15 seconds", "30 seconds", "60 seconds"),
                    onSelect = { onStateChange(state.copy(clipLength = it)) },
                )

                // Include Audio toggle
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Include Audio Analysis",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Switch(
                        checked = state.includeAudio,
                        onCheckedChange = { onStateChange(state.copy(includeAudio = it)) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropdownSelector(
    label: String,
    selected: String,
    options: List<String>,
    labels: List<String>,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = labels.getOrElse(options.indexOf(selected)) { selected }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEachIndexed { index, option ->
                DropdownMenuItem(
                    text = { Text(labels[index]) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}
