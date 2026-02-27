package com.polemicyst.android.ui.screens.billing

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.polemicyst.android.data.repository.SubscriptionInfo
import com.polemicyst.android.ui.components.ErrorBanner
import com.polemicyst.android.ui.components.LoadingIndicator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BillingScreen(
    viewModel: BillingViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Plan & Billing") })
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
                onRefresh = { viewModel.loadSubscription() },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                uiState.subscription?.let { sub ->
                    BillingContent(subscription = sub)
                }
            }
        }
    }
}

@Composable
private fun BillingContent(subscription: SubscriptionInfo) {
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        PlanCard(subscription)

        Text(
            text = "Usage This Month",
            style = MaterialTheme.typography.titleMedium,
        )

        UsageMeter(
            icon = Icons.Filled.RssFeed,
            label = "Feeds",
            used = subscription.usage.feeds,
            limit = subscription.limits.feeds,
        )

        UsageMeter(
            icon = Icons.Filled.Movie,
            label = "Clips",
            used = subscription.usage.clipsThisMonth,
            limit = subscription.limits.clipsPerMonth,
        )

        HorizontalDivider()

        Text(
            text = "Allowed LLM Providers",
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = subscription.limits.allowedProviders
                .joinToString(", ") { it.replaceFirstChar { c -> c.uppercase() } },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(8.dp))

        subscription.billingPortalUrl?.let { url ->
            Button(
                onClick = {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.OpenInNew, contentDescription = null)
                Spacer(modifier = Modifier.padding(start = 8.dp))
                Text("Manage Billing")
            }
        }

        if (subscription.plan == "free") {
            Button(
                onClick = {
                    val upgradeUrl = subscription.billingPortalUrl ?: "https://polemicyst.com/pricing"
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(upgradeUrl)))
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.CreditCard, contentDescription = null)
                Spacer(modifier = Modifier.padding(start = 8.dp))
                Text("Upgrade Plan")
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun PlanCard(subscription: SubscriptionInfo) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Current Plan",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f),
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = subscription.plan.replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

@Composable
private fun UsageMeter(
    icon: ImageVector,
    label: String,
    used: Int,
    limit: Int,
) {
    val isUnlimited = limit == -1
    val fraction = if (isUnlimited || limit == 0) 0f else (used.toFloat() / limit).coerceIn(0f, 1f)
    val isAtLimit = !isUnlimited && used >= limit
    val progressColor = when {
        isAtLimit -> MaterialTheme.colorScheme.error
        fraction >= 0.8f -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.primary
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = progressColor,
            )
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text = if (isUnlimited) "$used / ∞" else "$used / $limit",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = progressColor,
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                if (!isUnlimited) {
                    LinearProgressIndicator(
                        progress = { fraction },
                        modifier = Modifier.fillMaxWidth(),
                        color = progressColor,
                        trackColor = progressColor.copy(alpha = 0.15f),
                    )
                }
            }
        }
    }
}
