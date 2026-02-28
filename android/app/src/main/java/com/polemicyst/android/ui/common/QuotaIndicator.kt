package com.polemicyst.android.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Compact usage indicator showing "used/limit label" with a progress bar.
 * [limit] of -1 means unlimited.
 */
@Composable
fun QuotaIndicator(
    label: String,
    used: Int,
    limit: Int,
    modifier: Modifier = Modifier,
) {
    val isUnlimited = limit == -1
    val fraction = if (isUnlimited || limit == 0) 0f else (used.toFloat() / limit).coerceIn(0f, 1f)
    val isAtLimit = !isUnlimited && used >= limit
    val color = when {
        isAtLimit -> MaterialTheme.colorScheme.error
        fraction >= 0.8f -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.primary
    }

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = if (isUnlimited) "$label: $used / ∞" else "$label: $used/$limit",
            style = MaterialTheme.typography.labelMedium,
            color = color,
        )
        if (!isUnlimited) {
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier.width(60.dp),
                color = color,
                trackColor = color.copy(alpha = 0.2f),
            )
        }
    }
}
