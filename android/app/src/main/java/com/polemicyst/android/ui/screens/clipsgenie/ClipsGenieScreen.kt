package com.polemicyst.android.ui.screens.clipsgenie

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.polemicyst.android.data.repository.ClipRecord
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator
import com.polemicyst.android.ui.components.VideoThumbnail

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClipsGenieScreen(
    viewModel: ClipsGenieViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Clips Genie") })
        }
    ) { padding ->
        when {
            uiState.isLoading -> LoadingIndicator(modifier = Modifier.padding(padding))
            uiState.error != null -> ErrorBanner(
                message = uiState.error!!,
                modifier = Modifier.padding(padding),
            )
            else -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // Clip selector
                Text(
                    text = "Select a Clip",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )

                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(uiState.clips, key = { it.id }) { clip ->
                        ClipSelectorCard(
                            clip = clip,
                            isSelected = clip.id == uiState.selectedClipId,
                            onClick = { viewModel.selectClip(clip.id) },
                        )
                    }
                }

                HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

                // Platforms
                PlatformListPanel(
                    platforms = uiState.platforms,
                    onToggle = { viewModel.togglePlatform(it) },
                    onConnect = { key ->
                        if (key == "bluesky") viewModel.toggleBlueskyLogin()
                        // Other platforms would open Custom Chrome Tabs via the server OAuth URL
                    },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )

                HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

                // Description editor
                DescriptionEditorPanel(
                    sharedDescription = uiState.sharedDescription,
                    onSharedDescriptionChange = { viewModel.setSharedDescription(it) },
                    platforms = uiState.platforms,
                    onPlatformDescriptionChange = { key, desc ->
                        viewModel.setPlatformDescription(key, desc)
                    },
                    onGenerateAI = { viewModel.generateDescription() },
                    isGenerating = uiState.isGeneratingDescription,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )

                // Publish button
                Button(
                    onClick = { viewModel.publishAll() },
                    enabled = !uiState.isPublishing
                            && uiState.selectedClipId != null
                            && uiState.platforms.any { it.selected && it.connected },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                ) {
                    Text(
                        if (uiState.isPublishing) "Publishing..."
                        else "Publish to Selected Platforms"
                    )
                }

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }

    // Bluesky login dialog
    if (uiState.showBlueskyLogin) {
        AlertDialog(
            onDismissRequest = { viewModel.toggleBlueskyLogin() },
            title = { Text("Connect Bluesky") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = uiState.blueskyHandle,
                        onValueChange = { viewModel.setBlueskyHandle(it) },
                        label = { Text("Handle") },
                        placeholder = { Text("user.bsky.social") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = uiState.blueskyAppPassword,
                        onValueChange = { viewModel.setBlueskyAppPassword(it) },
                        label = { Text("App Password") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { viewModel.blueskyLogin() },
                    enabled = uiState.blueskyHandle.isNotBlank() && uiState.blueskyAppPassword.isNotBlank(),
                ) {
                    Text("Connect")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.toggleBlueskyLogin() }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun ClipSelectorCard(
    clip: ClipRecord,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surface,
        ),
        border = if (isSelected) CardDefaults.outlinedCardBorder() else null,
    ) {
        Column {
            VideoThumbnail(
                thumbnailUrl = null,
                modifier = Modifier.height(80.dp),
            )
            Text(
                text = clip.videoTitle ?: "Untitled",
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(8.dp),
            )
        }
    }
}
