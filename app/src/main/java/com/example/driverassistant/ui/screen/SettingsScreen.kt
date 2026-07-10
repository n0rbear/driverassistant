package com.example.driverassistant.ui.screen

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.driverassistant.service.LocationService

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    var gpsEnabled by remember { mutableStateOf(false) }
    var notificationsEnabled by remember { mutableStateOf(true) }
    var aiProcessingEnabled by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(text = "Beállítások", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(24.dp))

        Text(text = "Téma", style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = true, onClick = { })
            Text("Rendszer")
            RadioButton(selected = false, onClick = { })
            Text("Világos")
            RadioButton(selected = false, onClick = { })
            Text("Sötét")
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("GPS követés")
                Text("Munkaidő alatt automatikusan aktív", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            Icon(
                imageVector = Icons.Default.GpsFixed,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Értesítések")
            Switch(checked = notificationsEnabled, onCheckedChange = { notificationsEnabled = it })
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("AI feldolgozás")
                Text("Későbbi verzió", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            Switch(checked = aiProcessingEnabled, onCheckedChange = null, enabled = false)
        }
    }
}
