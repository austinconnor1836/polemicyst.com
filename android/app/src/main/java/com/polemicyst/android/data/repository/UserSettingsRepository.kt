package com.polemicyst.android.data.repository

import com.polemicyst.android.data.api.safeApiCall
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PUT
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class LlmProviderResponse(
    val llmProvider: String,
)

@JsonClass(generateAdapter = true)
data class UpdateLlmProviderRequest(
    val llmProvider: String,
)

interface UserSettingsApi {
    @GET("api/user/llm-provider")
    suspend fun getLlmProvider(): LlmProviderResponse

    @PUT("api/user/llm-provider")
    suspend fun updateLlmProvider(@Body request: UpdateLlmProviderRequest): LlmProviderResponse
}

@Singleton
class UserSettingsRepository @Inject constructor(
    retrofit: Retrofit,
    private val moshi: Moshi,
) {

    private val api = retrofit.create(UserSettingsApi::class.java)

    suspend fun getLlmProvider(): Result<String> =
        safeApiCall(moshi) { api.getLlmProvider().llmProvider }

    suspend fun updateLlmProvider(provider: String): Result<String> =
        safeApiCall(moshi) { api.updateLlmProvider(UpdateLlmProviderRequest(provider)).llmProvider }
}
