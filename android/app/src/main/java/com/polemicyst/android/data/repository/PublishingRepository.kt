package com.polemicyst.android.data.repository

import com.squareup.moshi.JsonClass
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class AuthStatusResponse(
    val bluesky: Boolean = false,
    val facebook: Boolean = false,
    val instagram: Boolean = false,
    val youtube: Boolean = false,
    val twitter: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class BlueskyLoginRequest(
    val handle: String,
    val appPassword: String,
)

@JsonClass(generateAdapter = true)
data class BlueskyLoginResponse(
    val success: Boolean,
    val message: String? = null,
)

@JsonClass(generateAdapter = true)
data class BlueskyPostRequest(
    val text: String,
    val clipId: String? = null,
)

@JsonClass(generateAdapter = true)
data class PostResponse(
    val success: Boolean,
    val url: String? = null,
    val message: String? = null,
)

@JsonClass(generateAdapter = true)
data class MetaUploadRequest(
    val clipId: String,
    val description: String? = null,
)

@JsonClass(generateAdapter = true)
data class YouTubeUploadRequest(
    val clipId: String,
    val title: String? = null,
    val description: String? = null,
)

@JsonClass(generateAdapter = true)
data class TwitterPostRequest(
    val text: String,
    val clipId: String? = null,
)

@JsonClass(generateAdapter = true)
data class GenerateDescriptionRequest(
    val clipId: String,
    val platform: String? = null,
)

@JsonClass(generateAdapter = true)
data class GenerateDescriptionResponse(
    val description: String,
)

interface PublishingApi {
    @GET("api/auth/status")
    suspend fun getAuthStatus(): AuthStatusResponse

    @POST("api/bluesky/login")
    suspend fun blueskyLogin(@Body request: BlueskyLoginRequest): BlueskyLoginResponse

    @POST("api/bluesky/post")
    suspend fun blueskyPost(@Body request: BlueskyPostRequest): PostResponse

    @POST("api/meta/upload/facebook")
    suspend fun facebookUpload(@Body request: MetaUploadRequest): PostResponse

    @POST("api/meta/upload/instagram")
    suspend fun instagramUpload(@Body request: MetaUploadRequest): PostResponse

    @POST("api/youtube/upload")
    suspend fun youtubeUpload(@Body request: YouTubeUploadRequest): PostResponse

    @POST("api/twitter/post")
    suspend fun twitterPost(@Body request: TwitterPostRequest): PostResponse

    @POST("api/generateDescription")
    suspend fun generateDescription(@Body request: GenerateDescriptionRequest): GenerateDescriptionResponse
}

@Singleton
class PublishingRepository @Inject constructor(retrofit: Retrofit) {

    private val api = retrofit.create(PublishingApi::class.java)

    suspend fun getAuthStatus(): Result<AuthStatusResponse> = runCatching {
        api.getAuthStatus()
    }

    suspend fun blueskyLogin(handle: String, appPassword: String): Result<BlueskyLoginResponse> = runCatching {
        api.blueskyLogin(BlueskyLoginRequest(handle, appPassword))
    }

    suspend fun blueskyPost(text: String, clipId: String?): Result<PostResponse> = runCatching {
        api.blueskyPost(BlueskyPostRequest(text, clipId))
    }

    suspend fun facebookUpload(clipId: String, description: String?): Result<PostResponse> = runCatching {
        api.facebookUpload(MetaUploadRequest(clipId, description))
    }

    suspend fun instagramUpload(clipId: String, description: String?): Result<PostResponse> = runCatching {
        api.instagramUpload(MetaUploadRequest(clipId, description))
    }

    suspend fun youtubeUpload(clipId: String, title: String?, description: String?): Result<PostResponse> = runCatching {
        api.youtubeUpload(YouTubeUploadRequest(clipId, title, description))
    }

    suspend fun twitterPost(text: String, clipId: String?): Result<PostResponse> = runCatching {
        api.twitterPost(TwitterPostRequest(text, clipId))
    }

    suspend fun generateDescription(clipId: String, platform: String? = null): Result<String> = runCatching {
        api.generateDescription(GenerateDescriptionRequest(clipId, platform)).description
    }
}
