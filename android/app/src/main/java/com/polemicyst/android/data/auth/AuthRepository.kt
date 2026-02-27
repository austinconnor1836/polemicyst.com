package com.polemicyst.android.data.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.polemicyst.android.BuildConfig
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import dagger.hilt.android.qualifiers.ApplicationContext
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.POST
import javax.inject.Inject
import javax.inject.Singleton

@JsonClass(generateAdapter = true)
data class MobileAuthRequest(
    val idToken: String
)

@JsonClass(generateAdapter = true)
data class MobileAuthResponse(
    val token: String,
    val user: AuthUser
)

@JsonClass(generateAdapter = true)
data class AuthUser(
    val id: String,
    val email: String,
    val name: String? = null,
    val image: String? = null
)

private interface MobileAuthApi {
    @POST("api/auth/mobile/google")
    suspend fun exchangeGoogleToken(@Body request: MobileAuthRequest): MobileAuthResponse
}

@Singleton
class AuthRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialManager: CredentialManager,
    private val tokenStorage: TokenStorage,
    retrofit: Retrofit,
) {
    private val authApi = retrofit.create(MobileAuthApi::class.java)

    val isLoggedIn: Boolean
        get() = tokenStorage.isLoggedIn

    suspend fun signInWithGoogle(): Result<AuthUser> = runCatching {
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(BuildConfig.GOOGLE_CLIENT_ID)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        val result = credentialManager.getCredential(context, request)
        val credential = result.credential
        val googleIdToken = GoogleIdTokenCredential.createFrom(credential.data)

        val response = authApi.exchangeGoogleToken(
            MobileAuthRequest(idToken = googleIdToken.idToken)
        )
        tokenStorage.saveToken(response.token)
        response.user
    }

    fun signOut() {
        tokenStorage.clearToken()
    }
}
