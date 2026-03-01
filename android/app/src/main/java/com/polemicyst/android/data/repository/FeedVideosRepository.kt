package com.polemicyst.android.data.repository

import com.polemicyst.android.data.api.safeApiCall
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import retrofit2.Retrofit
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class FeedVideo(
    val id: String,
    val feedId: String,
    val videoId: String,
    val title: String,
    val thumbnailUrl: String? = null,
    val s3Url: String,
    val status: String? = null,
    val transcript: String? = null,
    val createdAt: String,
    val userId: String? = null,
    val feed: FeedSummary? = null,
)

@JsonClass(generateAdapter = true)
data class FeedSummary(
    val id: String,
    val name: String,
)

@JsonClass(generateAdapter = true)
data class FeedVideoClipsResponse(
    val feedVideo: FeedVideo,
    val jobState: String? = null,
    val jobMeta: JobMeta? = null,
    val clips: List<ClipRecord>,
)

@JsonClass(generateAdapter = true)
data class JobMeta(
    val enqueuedAt: Long? = null,
    val startedAt: Long? = null,
    val finishedAt: Long? = null,
)

interface FeedVideosApi {
    @GET("api/feedVideos")
    suspend fun getFeedVideos(): List<FeedVideo>

    @GET("api/feedVideos/{id}/clips")
    suspend fun getFeedVideoClips(@Path("id") id: String): FeedVideoClipsResponse

    @POST("api/feedVideos/{id}/transcribe")
    suspend fun transcribeFeedVideo(@Path("id") id: String): Map<String, Any>

    @DELETE("api/feedVideos/{id}")
    suspend fun deleteFeedVideo(@Path("id") id: String): Map<String, Boolean>
}

@Singleton
class FeedVideosRepository @Inject constructor(
    retrofit: Retrofit,
    private val moshi: Moshi,
) {

    private val api = retrofit.create(FeedVideosApi::class.java)

    suspend fun getFeedVideos(): Result<List<FeedVideo>> =
        safeApiCall(moshi) { api.getFeedVideos() }

    suspend fun getFeedVideoClips(feedVideoId: String): Result<FeedVideoClipsResponse> =
        safeApiCall(moshi) { api.getFeedVideoClips(feedVideoId) }

    suspend fun transcribe(feedVideoId: String): Result<Unit> =
        safeApiCall(moshi) { api.transcribeFeedVideo(feedVideoId) }

    suspend fun delete(feedVideoId: String): Result<Unit> =
        safeApiCall(moshi) { api.deleteFeedVideo(feedVideoId) }
}
