package com.polemicyst.android.data.repository

import com.squareup.moshi.JsonClass
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
class UserSettingsRepository @Inject constructor(retrofit: Retrofit) {

    private val api = retrofit.create(UserSettingsApi::class.java)

    suspend fun getLlmProvider(): Result<String> = runCatching {
        api.getLlmProvider().llmProvider
    }

    suspend fun updateLlmProvider(provider: String): Result<String> = runCatching {
        api.updateLlmProvider(UpdateLlmProviderRequest(provider)).llmProvider
    }
}
