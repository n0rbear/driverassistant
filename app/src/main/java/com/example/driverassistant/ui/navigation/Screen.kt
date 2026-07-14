package com.example.driverassistant.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector
import com.example.driverassistant.BuildConfig

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Dashboard : Screen("dashboard", "Dashboard", Icons.Default.Dashboard)
    object Tours : Screen("tours", "Túrák", Icons.Default.Route)
    object Costs : Screen("costs", "Költségek", Icons.Default.Payments)
    object Hotels : Screen("hotels", "Hotelek", Icons.Default.Hotel)
    object Chat : Screen("chat", "Chat", Icons.Default.Chat)
    object Profile : Screen("profile", "Profil", Icons.Default.Person)
    object Settings : Screen("settings", "Beállítások", Icons.Default.Settings)
    object Report : Screen("report", "Menetlevél", Icons.Default.Assignment)
    object Stats : Screen("stats", "Összesítő", Icons.Default.BarChart)
}

val bottomNavItems = if (BuildConfig.IS_TEST_APP) {
    listOf(
        Screen.Dashboard,
        Screen.Hotels,
        Screen.Tours
    )
} else {
    listOf(
        Screen.Dashboard,
        Screen.Tours,
        Screen.Costs,
        Screen.Hotels,
        Screen.Chat,
        Screen.Profile
    )
}

val drawerItems = if (BuildConfig.IS_TEST_APP) {
    listOf(
        Screen.Dashboard,
        Screen.Tours,
        Screen.Hotels,
        Screen.Profile
    )
} else {
    listOf(
        Screen.Dashboard,
        Screen.Tours,
        Screen.Costs,
        Screen.Hotels,
        Screen.Chat,
        Screen.Report,
        Screen.Stats,
        Screen.Profile,
        Screen.Settings
    )
}
