package com.polemicyst.android.ui.screens.clipeditor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

enum class CropPosition(val label: String) {
    CENTER("Center"),
    TOP("Top"),
    BOTTOM("Bottom"),
    LEFT("Left"),
    RIGHT("Right"),
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CropPresetSelector(
    selected: CropPosition,
    onSelect: (CropPosition) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Crop Position",
            style = MaterialTheme.typography.titleSmall,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CropPosition.entries.forEach { position ->
                FilterChip(
                    selected = selected == position,
                    onClick = { onSelect(position) },
                    label = { Text(position.label) },
                )
            }
        }
    }
}
