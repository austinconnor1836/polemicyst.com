package com.polemicyst.android.data.repository

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class VideoFeed(
    val id: String,
    val name: String,
    val sourceUrl: String,
    val sourceType: String,
    val pollingInterval: Int? = null,
    val autoGenerateClips: Boolean = false,
    val viralitySettings: ViralitySettings? = null,
    val createdAt: String,
    val updatedAt: String,
    val userId: String? = null,
)

@JsonClass(generateAdapter = true)
data class ViralitySettings(
    val targetPlatform: String? = null,
    val contentStyle: String? = null,
    val scoringMode: String? = null,
    val llmProvider: String? = null,
    val strictness: String? = null,
    val includeAudio: Boolean? = null,
    val saferClips: Boolean? = null,
    val clipLength: String? = null,
)

@JsonClass(generateAdapter = true)
data class CreateFeedRequest(
    val name: String,
    val sourceUrl: String,
    val pollingInterval: Int? = null,
    val autoGenerateClips: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class UpdateFeedRequest(
    val name: String? = null,
    val pollingInterval: Int? = null,
    val autoGenerateClips: Boolean? = null,
    val viralitySettings: ViralitySettings? = null,
)

interface FeedsApi {
    @GET("api/feeds")
    suspend fun getFeeds(): List<VideoFeed>

    @POST("api/feeds")
    suspend fun createFeed(@Body request: CreateFeedRequest): VideoFeed

    @PATCH("api/feeds/{id}")
    suspend fun updateFeed(@Path("id") id: String, @Body request: UpdateFeedRequest): VideoFeed

    @DELETE("api/feeds/{id}")
    suspend fun deleteFeed(@Path("id") id: String): Map<String, Boolean>
}

@Singleton
class FeedsRepository @Inject constructor(retrofit: Retrofit) {

    private val api = retrofit.create(FeedsApi::class.java)

    suspend fun getFeeds(): Result<List<VideoFeed>> = runCatching {
        api.getFeeds()
    }

    suspend fun createFeed(name: String, sourceUrl: String, pollingInterval: Int? = null): Result<VideoFeed> = runCatching {
        api.createFeed(CreateFeedRequest(name = name, sourceUrl = sourceUrl, pollingInterval = pollingInterval))
    }

    suspend fun updateFeed(id: String, request: UpdateFeedRequest): Result<VideoFeed> = runCatching {
        api.updateFeed(id, request)
    }

    suspend fun deleteFeed(id: String): Result<Unit> = runCatching {
        api.deleteFeed(id)
    }
}
