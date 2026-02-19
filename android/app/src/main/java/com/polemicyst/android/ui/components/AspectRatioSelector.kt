package com.polemicyst.android.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

enum class AspectRatio(val label: String, val value: String, val widthRatio: Float, val heightRatio: Float) {
    PORTRAIT("9:16", "9:16", 9f, 16f),
    LANDSCAPE("16:9", "16:9", 16f, 9f),
    SQUARE("1:1", "1:1", 1f, 1f),
}

@Composable
fun AspectRatioSelector(
    selected: AspectRatio,
    onSelect: (AspectRatio) -> Unit,
    modifier: Modifier = Modifier,
) {
    SingleChoiceSegmentedButtonRow(modifier = modifier.fillMaxWidth()) {
        AspectRatio.entries.forEachIndexed { index, ratio ->
            SegmentedButton(
                selected = selected == ratio,
                onClick = { onSelect(ratio) },
                shape = SegmentedButtonDefaults.itemShape(
                    index = index,
                    count = AspectRatio.entries.size,
                ),
            ) {
                Text(ratio.label)
            }
        }
    }
}
