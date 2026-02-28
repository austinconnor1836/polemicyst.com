package com.polemicyst.android.data.repository

import com.polemicyst.android.data.api.safeApiCall
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
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
data class ClipRecord(
    val id: String,
    val videoTitle: String? = null,
    val sharedDescription: String? = null,
    val s3Url: String? = null,
    val s3Key: String? = null,
    val trimStartS: Double? = null,
    val trimEndS: Double? = null,
    val createdAt: String,
    val sourceVideoId: String? = null,
)

@JsonClass(generateAdapter = true)
data class UpdateClipRequest(
    val trimStartS: Double? = null,
    val trimEndS: Double? = null,
    val videoTitle: String? = null,
    val sharedDescription: String? = null,
)

@JsonClass(generateAdapter = true)
data class ExportClipResponse(
    val url: String,
    val s3Key: String,
    val size: Long? = null,
    val durationS: Double? = null,
)

@JsonClass(generateAdapter = true)
data class TriggerClipRequest(
    val feedVideoId: String,
    val userId: String,
    val aspectRatio: String? = null,
    val scoringMode: String = "heuristic",
    val includeAudio: Boolean = false,
    val saferClips: Boolean = false,
    val targetPlatform: String = "all",
    val contentStyle: String = "auto",
    val llmProvider: String = "gemini",
    val clipLength: String? = null,
)

@JsonClass(generateAdapter = true)
data class TriggerClipResponse(
    val message: String,
    val jobId: String,
)

@JsonClass(generateAdapter = true)
data class ClipJobSummary(
    val jobId: String,
    val feedVideoId: String,
    val state: String,
    val enqueuedAt: Long? = null,
    val startedAt: Long? = null,
    val feedName: String? = null,
    val title: String,
    val clipSourceVideoId: String? = null,
)

interface ClipsApi {
    @GET("api/clips")
    suspend fun getClips(): List<ClipRecord>

    @PATCH("api/clips/{id}")
    suspend fun updateClip(@Path("id") id: String, @Body request: UpdateClipRequest): Map<String, Any>

    @DELETE("api/clips/{id}")
    suspend fun deleteClip(@Path("id") id: String): Map<String, Boolean>

    @POST("api/clips/{id}/export")
    suspend fun exportClip(@Path("id") id: String): ExportClipResponse

    @POST("api/trigger-clip")
    suspend fun triggerClip(@Body request: TriggerClipRequest): TriggerClipResponse

    @GET("api/clip-jobs")
    suspend fun getClipJobs(): List<ClipJobSummary>
}

@Singleton
class ClipsRepository @Inject constructor(
    retrofit: Retrofit,
    private val moshi: Moshi,
) {

    private val api = retrofit.create(ClipsApi::class.java)

    suspend fun getClips(): Result<List<ClipRecord>> = runCatching {
        api.getClips()
    }

    suspend fun updateClip(clipId: String, request: UpdateClipRequest): Result<Unit> = runCatching {
        api.updateClip(clipId, request)
    }

    suspend fun updateTrim(clipId: String, startS: Double, endS: Double): Result<Unit> = runCatching {
        api.updateClip(clipId, UpdateClipRequest(trimStartS = startS, trimEndS = endS))
    }

    suspend fun deleteClip(clipId: String): Result<Unit> = runCatching {
        api.deleteClip(clipId)
    }

    suspend fun exportClip(clipId: String): Result<ExportClipResponse> = runCatching {
        api.exportClip(clipId)
    }

    suspend fun triggerClip(request: TriggerClipRequest): Result<TriggerClipResponse> =
        safeApiCall(moshi) { api.triggerClip(request) }

    suspend fun getClipJobs(): Result<List<ClipJobSummary>> = runCatching {
        api.getClipJobs()
    }
}
