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

/**
 * Canonical plan IDs — must match backend PlanId strings exactly:
 * free | creator | pro | agency
 */
enum class PlanId(val id: String) {
    FREE("free"),
    CREATOR("creator"),
    PRO("pro"),
    AGENCY("agency");

    companion object {
        fun fromString(value: String): PlanId = entries.firstOrNull { it.id == value } ?: FREE
    }
}

@JsonClass(generateAdapter = true)
data class SubscriptionInfo(
    val plan: String = "free",
    val limits: PlanLimits = PlanLimits(),
    val usage: PlanUsage = PlanUsage(),
    val stripeCustomerId: String? = null,
    val billingPortalUrl: String? = null,
) {
    val planId: PlanId get() = PlanId.fromString(plan)
}

/**
 * Plan limits mirroring backend shared/lib/plans.ts.
 * - uploadMinutesPerMonth: -1 = unlimited
 * - maxConnectedAccounts: -1 = unlimited
 * - teamSeats: number of team member seats included
 * - watermark: true if clips show a Clipfire watermark
 * - autoGenerateClips: whether auto-generate is available
 * - prioritySupport: whether plan includes priority support
 * TODO(pricing): keep in sync with backend PLANS constant when final prices are confirmed.
 */
@JsonClass(generateAdapter = true)
data class PlanLimits(
    val feeds: Int = 2,
    val uploadMinutesPerMonth: Int = 60, // TODO(pricing): mirror backend free-tier value
    val maxConnectedAccounts: Int = 2,
    val watermark: Boolean = true,
    val teamSeats: Int = 1,
    val autoGenerateClips: Boolean = false,
    val prioritySupport: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class PlanUsage(
    val feeds: Int = 0,
    val uploadMinutesUsed: Int = 0,
)

interface SubscriptionApi {
    @GET("api/user/subscription")
    suspend fun getSubscription(): SubscriptionInfo
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
    val currentPlanId: PlanId get() = PlanId.fromString(currentPlan)
    val isFreeUser: Boolean get() = currentPlanId == PlanId.FREE

    suspend fun refresh(): Result<SubscriptionInfo> {
        val result = safeApiCall(moshi) { api.getSubscription() }
        result.onSuccess { _subscription.value = it }
        return result
    }
}
