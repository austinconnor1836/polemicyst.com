package com.polemicyst.android.data.api

import com.squareup.moshi.JsonClass

/**
 * Structured error body returned by the API on 403 and other error responses.
 * Different error codes include different subsets of fields.
 */
@JsonClass(generateAdapter = true)
data class ApiError(
    val code: String? = null,
    val message: String? = null,
    val error: String? = null,
    val allowedProviders: List<String>? = null,
    val plan: String? = null,
    val limit: Int? = null,
    val usage: Int? = null,
) {
    val displayMessage: String
        get() = message ?: error ?: "An unknown error occurred"

    val isQuotaExceeded: Boolean get() = code == CODE_QUOTA_EXCEEDED
    val isPlanRestricted: Boolean get() = code == CODE_PLAN_RESTRICTED

    companion object {
        const val CODE_QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
        const val CODE_PLAN_RESTRICTED = "PLAN_RESTRICTED"
    }
}

/**
 * Exception carrying the parsed [ApiError] and HTTP status code.
 */
class ApiException(
    val statusCode: Int,
    val apiError: ApiError,
) : Exception(apiError.displayMessage)
