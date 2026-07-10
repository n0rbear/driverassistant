package com.example.driverassistant.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector

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

val bottomNavItems = listOf(
    Screen.Dashboard,
    Screen.Tours,
    Screen.Report,
    Screen.Stats
)

val drawerItems = listOf(
    Screen.Dashboard,
    Screen.Tours,
    Screen.Costs,
    Screen.Hotels,
    Screen.Chat,
    Screen.Profile,
    Screen.Settings
)
