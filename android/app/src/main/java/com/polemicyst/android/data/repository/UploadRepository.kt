package com.polemicyst.android.data.repository

import com.squareup.moshi.JsonClass
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class InitiateUploadRequest(
    val filename: String,
    val contentType: String,
    val totalParts: Int,
    val feedId: String? = null,
)

@JsonClass(generateAdapter = true)
data class InitiateUploadResponse(
    val uploadId: String,
    val key: String,
)

@JsonClass(generateAdapter = true)
data class PartUrlRequest(
    val uploadId: String,
    val key: String,
    val partNumber: Int,
)

@JsonClass(generateAdapter = true)
data class PartUrlResponse(
    val url: String,
)

@JsonClass(generateAdapter = true)
data class CompletePart(
    val partNumber: Int,
    val etag: String,
)

@JsonClass(generateAdapter = true)
data class CompleteUploadRequest(
    val uploadId: String,
    val key: String,
    val parts: List<CompletePart>,
    val feedId: String? = null,
    val title: String? = null,
)

@JsonClass(generateAdapter = true)
data class CompleteUploadResponse(
    val feedVideo: FeedVideo? = null,
    val message: String? = null,
)

@JsonClass(generateAdapter = true)
data class ImportFromUrlRequest(
    val url: String,
    val feedId: String,
    val title: String? = null,
)

@JsonClass(generateAdapter = true)
data class ImportFromUrlResponse(
    val feedVideo: FeedVideo? = null,
    val message: String? = null,
)

interface UploadApi {
    @POST("api/uploads/multipart/initiate")
    suspend fun initiateUpload(@Body request: InitiateUploadRequest): InitiateUploadResponse

    @POST("api/uploads/multipart/part-url")
    suspend fun getPartUrl(@Body request: PartUrlRequest): PartUrlResponse

    @POST("api/uploads/multipart/complete")
    suspend fun completeUpload(@Body request: CompleteUploadRequest): CompleteUploadResponse

    @POST("api/uploads/from-url")
    suspend fun importFromUrl(@Body request: ImportFromUrlRequest): ImportFromUrlResponse
}

@Singleton
class UploadRepository @Inject constructor(
    retrofit: Retrofit,
    private val okHttpClient: OkHttpClient,
) {

    private val api = retrofit.create(UploadApi::class.java)

    companion object {
        private const val PART_SIZE = 5 * 1024 * 1024L // 5 MB
    }

    suspend fun uploadFile(
        file: File,
        feedId: String,
        title: String?,
        onProgress: (Float) -> Unit,
    ): Result<CompleteUploadResponse> = runCatching {
        val contentType = when {
            file.name.endsWith(".mp4") -> "video/mp4"
            file.name.endsWith(".webm") -> "video/webm"
            file.name.endsWith(".mov") -> "video/quicktime"
            else -> "application/octet-stream"
        }

        val fileSize = file.length()
        val totalParts = ((fileSize + PART_SIZE - 1) / PART_SIZE).toInt()

        val initResponse = api.initiateUpload(
            InitiateUploadRequest(
                filename = file.name,
                contentType = contentType,
                totalParts = totalParts,
                feedId = feedId,
            )
        )

        val completedParts = mutableListOf<CompletePart>()

        file.inputStream().use { inputStream ->
            for (partNumber in 1..totalParts) {
                val partSize = if (partNumber == totalParts) {
                    fileSize - (partNumber - 1) * PART_SIZE
                } else {
                    PART_SIZE
                }

                val buffer = ByteArray(partSize.toInt())
                inputStream.read(buffer)

                val partUrlResponse = api.getPartUrl(
                    PartUrlRequest(
                        uploadId = initResponse.uploadId,
                        key = initResponse.key,
                        partNumber = partNumber,
                    )
                )

                val partBody = okhttp3.RequestBody.create(contentType.toMediaType(), buffer)
                val request = Request.Builder()
                    .url(partUrlResponse.url)
                    .put(partBody)
                    .build()

                val response = okHttpClient.newCall(request).execute()
                val etag = response.header("ETag") ?: throw Exception("Missing ETag for part $partNumber")

                completedParts.add(CompletePart(partNumber = partNumber, etag = etag))
                onProgress(partNumber.toFloat() / totalParts)
            }
        }

        api.completeUpload(
            CompleteUploadRequest(
                uploadId = initResponse.uploadId,
                key = initResponse.key,
                parts = completedParts,
                feedId = feedId,
                title = title,
            )
        )
    }

    suspend fun importFromUrl(url: String, feedId: String, title: String? = null): Result<ImportFromUrlResponse> = runCatching {
        api.importFromUrl(ImportFromUrlRequest(url = url, feedId = feedId, title = title))
    }
}
