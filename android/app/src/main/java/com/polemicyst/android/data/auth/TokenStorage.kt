package com.polemicyst.android.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class TokenStorage(context: Context) {

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        "polemicyst_auth",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun getToken(): String? = prefs.getString(KEY_JWT, null)

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_JWT, token).apply()
    }

    fun clearToken() {
        prefs.edit().remove(KEY_JWT).apply()
    }

    val isLoggedIn: Boolean
        get() = getToken() != null

    companion object {
        private const val KEY_JWT = "jwt_token"
    }
}
