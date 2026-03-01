package com.polemicyst.android.data.repository

import com.polemicyst.android.data.api.safeApiCall
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import retrofit2.Retrofit
import retrofit2.http.GET
import javax.inject.Inject
import javax.inject.Singleton

// ---------------------------------------------------------------------------
// API response models — match the JSON from GET /api/user/subscription
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class SubscriptionApiResponse(
    val plan: PlanApiResponse = PlanApiResponse(),
    val usage: UsageApiResponse = UsageApiResponse(),
    val hasStripeCustomer: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class PlanApiResponse(
    val id: String = "free",
    val name: String = "Free",
    val limits: PlanLimitsApiResponse = PlanLimitsApiResponse(),
    val features: List<String> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class PlanLimitsApiResponse(
    val maxFeeds: Int = 2,
    val maxClipsPerMonth: Int = 10,
    val maxStorageGb: Int = 1,
    val llmProviders: List<String> = listOf("ollama"),
    val autoGenerateClips: Boolean = false,
    val prioritySupport: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class UsageApiResponse(
    val feeds: Int = 0,
    val clipsThisMonth: Int = 0,
)

// ---------------------------------------------------------------------------
// UI models — consumed by ViewModels and Composables
// ---------------------------------------------------------------------------

data class SubscriptionInfo(
    val plan: String = "free",
    val planName: String = "Free",
    val limits: PlanLimits = PlanLimits(),
    val features: List<String> = emptyList(),
    val usage: PlanUsage = PlanUsage(),
    val hasStripeCustomer: Boolean = false,
) {
    companion object {
        const val PRICING_URL = "https://polemicyst.com/pricing"
    }
}

data class PlanLimits(
    val feeds: Int = 2,
    val clipsPerMonth: Int = 10,
    val allowedProviders: List<String> = listOf("ollama"),
    val autoGenerateClips: Boolean = false,
)

data class PlanUsage(
    val feeds: Int = 0,
    val clipsThisMonth: Int = 0,
)

fun SubscriptionApiResponse.toSubscriptionInfo() = SubscriptionInfo(
    plan = plan.id,
    planName = plan.name,
    limits = PlanLimits(
        feeds = plan.limits.maxFeeds,
        clipsPerMonth = plan.limits.maxClipsPerMonth,
        allowedProviders = plan.limits.llmProviders,
        autoGenerateClips = plan.limits.autoGenerateClips,
    ),
    features = plan.features,
    usage = PlanUsage(
        feeds = usage.feeds,
        clipsThisMonth = usage.clipsThisMonth,
    ),
    hasStripeCustomer = hasStripeCustomer,
)

// ---------------------------------------------------------------------------
// Retrofit API + Repository
// ---------------------------------------------------------------------------

interface SubscriptionApi {
    @GET("api/user/subscription")
    suspend fun getSubscription(): SubscriptionApiResponse
}

@Singleton
class SubscriptionRepository @Inject constructor(
    retrofit: Retrofit,
    private val moshi: Moshi,
) {
    private val api = retrofit.create(SubscriptionApi::class.java)

    private val _subscription = MutableStateFlow<SubscriptionInfo?>(null)
    val subscription: StateFlow<SubscriptionInfo?> = _subscription.asStateFlow()

    val currentPlan: String get() = _subscription.value?.plan ?: "free"
    val isFreeUser: Boolean get() = currentPlan == "free"
    val allowedProviders: List<String> get() = _subscription.value?.limits?.allowedProviders ?: listOf("ollama")

    suspend fun refresh(): Result<SubscriptionInfo> {
        val result = safeApiCall(moshi) { api.getSubscription() }
        return result.map { it.toSubscriptionInfo() }.also { mapped ->
            mapped.onSuccess { _subscription.value = it }
        }
    }
}
