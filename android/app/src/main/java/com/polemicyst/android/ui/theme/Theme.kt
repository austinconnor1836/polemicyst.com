package com.polemicyst.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = TokenPrimaryDark,
    secondary = TokenAccentDark,
    tertiary = Pink80,
    background = TokenBackgroundDark,
    surface = TokenSurfaceDark,
    onPrimary = TokenSurfaceDark,
    onSecondary = TokenBackgroundDark,
    onBackground = TokenTextDark,
    onSurface = TokenTextDark,
)

private val LightColorScheme = lightColorScheme(
    primary = TokenPrimaryLight,
    secondary = TokenAccentLight,
    tertiary = Pink40,
    background = TokenBackgroundLight,
    surface = TokenSurfaceLight,
    onPrimary = TokenSurfaceLight,
    onSecondary = TokenBackgroundLight,
    onBackground = TokenTextLight,
    onSurface = TokenTextLight,
)

@Composable
fun PolemicystTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content,
    )
}
