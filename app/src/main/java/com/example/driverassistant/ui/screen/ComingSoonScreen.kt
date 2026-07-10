package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun ComingSoonScreen(title: String, message: String = "Szerverkapcsolat szükséges") {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(text = title, style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Text(text = message, color = Color.Gray)
        Spacer(modifier = Modifier.height(16.dp))
        Button(onClick = { }, enabled = false) {
            Text(text = "Későbbi verzió")
        }
    }
}
