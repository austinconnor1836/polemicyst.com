package com.polemicyst.android.data.api

import com.squareup.moshi.Moshi
import retrofit2.HttpException

/**
 * Wraps a suspending Retrofit call, catching [HttpException] and parsing the
 * structured JSON error body into an [ApiException].
 */
suspend fun <T> safeApiCall(moshi: Moshi, block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: HttpException) {
        val apiError = parseErrorBody(moshi, e)
        Result.failure(ApiException(statusCode = e.code(), apiError = apiError))
    } catch (e: Exception) {
        Result.failure(e)
    }

private fun parseErrorBody(moshi: Moshi, e: HttpException): ApiError {
    val raw = e.response()?.errorBody()?.string()
    if (raw.isNullOrBlank()) return ApiError(message = "HTTP ${e.code()}")
    return try {
        moshi.adapter(ApiError::class.java).fromJson(raw) ?: ApiError(message = raw.take(500))
    } catch (_: Exception) {
        ApiError(message = raw.take(500))
    }
}
