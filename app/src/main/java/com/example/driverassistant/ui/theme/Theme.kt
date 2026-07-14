package com.example.driverassistant.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.example.driverassistant.BuildConfig

private val DarkColorScheme = darkColorScheme(
    primary = Purple80,
    secondary = PurpleGrey80,
    tertiary = Pink80
)

private val LightColorScheme = lightColorScheme(
    primary = Purple40,
    secondary = PurpleGrey40,
    tertiary = Pink40

    /* Other default colors to override
    background = Color(0xFFFFFBFE),
    surface = Color(0xFFFFFBFE),
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = Color.White,
    onBackground = Color(0xFF1C1B1F),
    onSurface = Color(0xFF1C1B1F),
    */
)

private val LogiHeroLightColorScheme = lightColorScheme(
    primary = LogiHeroGreen,
    onPrimary = LogiHeroBlack,
    primaryContainer = Color(0xFFDBFBCE),
    onPrimaryContainer = LogiHeroInk,
    secondary = LogiHeroGreenDark,
    onSecondary = Color.White,
    secondaryContainer = LogiHeroGreenSoft,
    onSecondaryContainer = LogiHeroInk,
    tertiary = LogiHeroInk,
    onTertiary = Color.White,
    background = Color.White,
    onBackground = LogiHeroInk,
    surface = Color.White,
    onSurface = LogiHeroInk,
    surfaceVariant = LogiHeroGreenSoft,
    onSurfaceVariant = LogiHeroInk,
    outline = Color(0xFFADC2A4),
    error = Color(0xFFDC3545)
)

private val LogiHeroDarkColorScheme = darkColorScheme(
    primary = LogiHeroGreen,
    onPrimary = LogiHeroBlack,
    primaryContainer = Color(0xFF1E4F0A),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFF96F86D),
    onSecondary = LogiHeroBlack,
    secondaryContainer = Color(0xFF162113),
    onSecondaryContainer = Color.White,
    tertiary = Color.White,
    onTertiary = LogiHeroBlack,
    background = LogiHeroBlack,
    onBackground = Color.White,
    surface = Color(0xFF101410),
    onSurface = Color.White,
    surfaceVariant = Color(0xFF1A2117),
    onSurfaceVariant = Color(0xFFE4F1DF),
    outline = Color(0xFF96F86D),
    error = Color(0xFFFFB4AB)
)

@Composable
fun DriverAssistantTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Dynamic color is available on Android 12+
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        BuildConfig.IS_TEST_APP && darkTheme -> LogiHeroDarkColorScheme
        BuildConfig.IS_TEST_APP -> LogiHeroLightColorScheme
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
        content = content
    )
}
