package com.polemicyst.android.data.repository

import com.squareup.moshi.JsonClass
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class ClipTemplate(
    val id: String,
    val name: String,
    val aspectRatio: String? = null,
    val cropPosition: String? = null,
    val backgroundFill: String? = null,
    val captionStyle: String? = null,
    val captionPlacement: String? = null,
    val createdAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class CreateClipTemplateRequest(
    val name: String,
    val aspectRatio: String? = null,
    val cropPosition: String? = null,
    val backgroundFill: String? = null,
    val captionStyle: String? = null,
    val captionPlacement: String? = null,
)

interface ClipTemplatesApi {
    @GET("api/clip-templates")
    suspend fun getTemplates(): List<ClipTemplate>

    @POST("api/clip-templates")
    suspend fun createTemplate(@Body request: CreateClipTemplateRequest): ClipTemplate
}

@Singleton
class ClipTemplatesRepository @Inject constructor(retrofit: Retrofit) {

    private val api = retrofit.create(ClipTemplatesApi::class.java)

    suspend fun getTemplates(): Result<List<ClipTemplate>> = runCatching {
        api.getTemplates()
    }

    suspend fun createTemplate(request: CreateClipTemplateRequest): Result<ClipTemplate> = runCatching {
        api.createTemplate(request)
    }
}
