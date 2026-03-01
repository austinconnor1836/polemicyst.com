package com.polemicyst.android

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.polemicyst.android.data.repository.VersionRepository
import com.polemicyst.android.ui.navigation.AppNavGraph
import com.polemicyst.android.ui.screens.update.ForceUpdateScreen
import com.polemicyst.android.ui.theme.PolemicystTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var versionRepository: VersionRepository

    private var forceUpdate by mutableStateOf(false)
    private var storeUrl by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        checkForUpdates()
        setContent {
            PolemicystTheme {
                if (forceUpdate) {
                    ForceUpdateScreen(storeUrl = storeUrl)
                } else {
                    AppNavGraph()
                }
            }
        }
    }

    private fun checkForUpdates() {
        checkServerVersion()
        checkPlayStoreUpdate()
    }

    private fun checkServerVersion() {
        val currentVersion = BuildConfig.VERSION_NAME
        lifecycleScope.launch {
            versionRepository.checkVersion(currentVersion)
                .onSuccess { response ->
                    if (response.updateRequired) {
                        storeUrl = response.storeUrl
                        forceUpdate = true
                    }
                }
                .onFailure {
                    Log.w("MainActivity", "Version check failed, continuing", it)
                }
        }
    }

    private fun checkPlayStoreUpdate() {
        val appUpdateManager = AppUpdateManagerFactory.create(this)
        appUpdateManager.appUpdateInfo.addOnSuccessListener { info ->
            if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
            ) {
                try {
                    appUpdateManager.startUpdateFlowForResult(
                        info, AppUpdateType.FLEXIBLE, this, UPDATE_REQUEST_CODE
                    )
                } catch (e: Exception) {
                    Log.w("MainActivity", "Play Core update flow failed", e)
                }
            }
        }
    }

    companion object {
        private const val UPDATE_REQUEST_CODE = 9001
    }
}
