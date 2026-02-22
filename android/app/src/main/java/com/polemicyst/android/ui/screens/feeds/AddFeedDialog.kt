package com.polemicyst.android.ui.screens.feeds

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
fun AddFeedDialog(
    onDismiss: () -> Unit,
    onConfirm: (name: String, sourceUrl: String, pollingInterval: Int?) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var sourceUrl by remember { mutableStateOf("") }
    var pollingInterval by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Feed") },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Feed Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = sourceUrl,
                    onValueChange = { sourceUrl = it },
                    label = { Text("Source URL") },
                    singleLine = true,
                    placeholder = { Text("https://youtube.com/...") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = pollingInterval,
                    onValueChange = { pollingInterval = it.filter { c -> c.isDigit() } },
                    label = { Text("Polling Interval (minutes)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    placeholder = { Text("Optional") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(
                        name.trim(),
                        sourceUrl.trim(),
                        pollingInterval.toIntOrNull(),
                    )
                },
                enabled = name.isNotBlank() && sourceUrl.isNotBlank(),
            ) {
                Text("Add")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}
