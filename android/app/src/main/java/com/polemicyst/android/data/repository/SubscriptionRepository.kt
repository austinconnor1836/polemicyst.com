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

@JsonClass(generateAdapter = true)
data class SubscriptionInfo(
    val plan: String = "free",
    val limits: PlanLimits = PlanLimits(),
    val usage: PlanUsage = PlanUsage(),
    val stripeCustomerId: String? = null,
    val billingPortalUrl: String? = null,
)

@JsonClass(generateAdapter = true)
data class PlanLimits(
    val feeds: Int = 3,
    val clipsPerMonth: Int = 10,
    val allowedProviders: List<String> = listOf("openai"),
)

@JsonClass(generateAdapter = true)
data class PlanUsage(
    val feeds: Int = 0,
    val clipsThisMonth: Int = 0,
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
    val isFreeUser: Boolean get() = currentPlan == "free"
    val allowedProviders: List<String> get() = _subscription.value?.limits?.allowedProviders ?: listOf("openai")

    suspend fun refresh(): Result<SubscriptionInfo> {
        val result = safeApiCall(moshi) { api.getSubscription() }
        result.onSuccess { _subscription.value = it }
        return result
    }
}
