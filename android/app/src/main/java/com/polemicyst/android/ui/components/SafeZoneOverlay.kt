package com.polemicyst.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke

@Composable
fun SafeZoneOverlay(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
) {
    Canvas(modifier = modifier.fillMaxSize()) {
        val outerInset = size.width * 0.05f
        val innerInset = size.width * 0.1f

        // Outer safe zone (title safe)
        drawRect(
            color = color,
            topLeft = Offset(outerInset, outerInset),
            size = Size(size.width - outerInset * 2, size.height - outerInset * 2),
            style = Stroke(width = 1f),
        )

        // Inner safe zone (action safe)
        drawRect(
            color = color.copy(alpha = 0.3f),
            topLeft = Offset(innerInset, innerInset),
            size = Size(size.width - innerInset * 2, size.height - innerInset * 2),
            style = Stroke(width = 1f),
        )
    }
}
