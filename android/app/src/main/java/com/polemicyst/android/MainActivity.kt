package com.polemicyst.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.polemicyst.android.ui.navigation.AppNavGraph
import com.polemicyst.android.ui.theme.PolemicystTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PolemicystTheme {
                AppNavGraph()
            }
        }
    }
}
