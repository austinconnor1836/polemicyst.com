package com.polemicyst.android.ui.screens.feeds

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.polemicyst.android.data.repository.SubscriptionInfo
import com.polemicyst.android.data.repository.VideoFeed
import com.polemicyst.android.ui.common.QuotaIndicator
import com.polemicyst.android.ui.common.UpgradePromptDialog
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedsListScreen(
    onFeedClick: (feedId: String) -> Unit,
    viewModel: FeedsListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var showAddDialog by remember { mutableStateOf(false) }
    var settingsFeed by remember { mutableStateOf<VideoFeed?>(null) }
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Feeds")
                        uiState.subscription?.let { sub ->
                            QuotaIndicator(
                                label = "Feeds",
                                used = sub.usage.feeds,
                                limit = sub.limits.feeds,
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Filled.Add, contentDescription = "Add Feed")
            }
        },
    ) { padding ->
        when {
            uiState.isLoading -> LoadingIndicator(modifier = Modifier.padding(padding))
            uiState.error != null -> ErrorBanner(
                message = uiState.error!!,
                modifier = Modifier.padding(padding),
            )
            else -> PullToRefreshBox(
                isRefreshing = uiState.isLoading,
                onRefresh = { viewModel.loadFeeds() },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                ) {
                    items(uiState.feeds, key = { it.id }) { feed ->
                        FeedCard(
                            feed = feed,
                            onClick = { onFeedClick(feed.id) },
                            onSettings = { settingsFeed = feed },
                            onDelete = { viewModel.deleteFeed(feed.id) },
                        )
                    }
                }
            }
        }
    }

    if (showAddDialog) {
        AddFeedDialog(
            onDismiss = { showAddDialog = false },
            onConfirm = { name, sourceUrl, pollingInterval ->
                viewModel.createFeed(name, sourceUrl, pollingInterval)
                showAddDialog = false
            },
        )
    }

    uiState.quotaError?.let { apiError ->
        UpgradePromptDialog(
            apiError = apiError,
            onDismiss = { viewModel.dismissQuotaError() },
            onUpgrade = {
                viewModel.dismissQuotaError()
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(SubscriptionInfo.PRICING_URL))
                )
            },
        )
    }

    settingsFeed?.let { feed ->
        FeedSettingsSheet(
            feed = feed,
            onDismiss = { settingsFeed = null },
            onSave = { autoGenerate, viralityState ->
                viewModel.updateFeedSettings(feed.id, autoGenerate, viralityState)
                settingsFeed = null
            },
            isFreeUser = uiState.subscription?.plan == "free",
            allowedProviders = uiState.subscription?.limits?.allowedProviders ?: listOf("openai"),
        )
    }
}

@Composable
private fun FeedCard(
    feed: VideoFeed,
    onClick: () -> Unit,
    onSettings: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = feed.name,
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = feed.sourceType.uppercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onSettings) {
                Icon(
                    imageVector = Icons.Filled.Settings,
                    contentDescription = "Feed settings",
                )
            }
            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Filled.Delete,
                    contentDescription = "Delete feed",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
