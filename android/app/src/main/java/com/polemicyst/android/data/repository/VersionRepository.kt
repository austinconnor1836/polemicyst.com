package com.polemicyst.android.data.repository

import com.squareup.moshi.JsonClass
import retrofit2.Retrofit
import retrofit2.http.GET
import retrofit2.http.Query
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class VersionCheckResponse(
    val updateRequired: Boolean,
    val minimumVersion: String,
    val latestVersion: String,
    val storeUrl: String
)

interface VersionApi {
    @GET("api/app/version-check")
    suspend fun checkVersion(
        @Query("platform") platform: String,
        @Query("currentVersion") currentVersion: String
    ): VersionCheckResponse
}

@Singleton
class VersionRepository @Inject constructor(
    retrofit: Retrofit
) {
    private val api = retrofit.create(VersionApi::class.java)

    suspend fun checkVersion(currentVersion: String): Result<VersionCheckResponse> = runCatching {
        api.checkVersion(platform = "android", currentVersion = currentVersion)
    }
}
