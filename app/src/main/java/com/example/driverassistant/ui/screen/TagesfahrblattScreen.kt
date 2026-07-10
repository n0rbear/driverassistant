package com.example.driverassistant.ui.screen

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.ui.viewmodel.TagesfahrblattViewModel
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TagesfahrblattScreen(viewModel: TagesfahrblattViewModel = hiltViewModel()) {
    val dayData by viewModel.dayData.collectAsState()
    val selectedDate by viewModel.selectedDate.collectAsState()
    
    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("Tagesfahrblatt - $selectedDate") },
                actions = {
                    IconButton(onClick = { /* PDF Export logic */ }) {
                        Icon(Icons.Default.Download, contentDescription = "PDF Export")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            
            // Grafikus nézet (Vonalak)
            Text("Napi idővonal (Grafikus)", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(16.dp))
            TagesfahrblattChart(dayData)
            
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            
            // Manuális segítő (Lista)
            Text("Manuális kitöltéshez", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(16.dp))
            LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                items(viewModel.getTimelineItems()) { item ->
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = when(item.type) {
                                "Vezetés" -> MaterialTheme.colorScheme.primaryContainer
                                "Pihenő" -> MaterialTheme.colorScheme.secondaryContainer
                                "Rakodás" -> MaterialTheme.colorScheme.tertiaryContainer
                                else -> MaterialTheme.colorScheme.surfaceVariant
                            }
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(item.type, style = MaterialTheme.typography.titleMedium)
                                if (item.notes.isNotBlank()) {
                                    Text(item.notes, style = MaterialTheme.typography.bodySmall)
                                }
                                if (item.mileage != null) {
                                    Text("Km: ${item.mileage}${if (item.endMileage != null) " - ${item.endMileage}" else ""}", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                }
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(item.interval, style = MaterialTheme.typography.headlineSmall)
                                if (item.plate != null) {
                                    Text(item.plate, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TagesfahrblattChart(activities: List<com.example.driverassistant.domain.model.WorkTime>) {
    // Nagyon egyszerűsített vizuális idővonal szimuláció
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(150.dp)
            .padding(horizontal = 16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val width = size.width
            val height = size.height
            val hourWidth = width / 24
            
            // Óra rács
            for (i in 0..24) {
                drawLine(
                    color = Color.LightGray,
                    start = Offset(i * hourWidth, 0f),
                    end = Offset(i * hourWidth, height),
                    strokeWidth = 1f
                )
            }
            
            // Tevékenység vonalak
            activities.forEach { wt ->
                val calendar = Calendar.getInstance()
                calendar.timeInMillis = wt.startTime
                val startHour = calendar.get(Calendar.HOUR_OF_DAY) + calendar.get(Calendar.MINUTE) / 60f
                
                val endTs = wt.endTime ?: System.currentTimeMillis()
                calendar.timeInMillis = endTs
                val endHour = calendar.get(Calendar.HOUR_OF_DAY) + calendar.get(Calendar.MINUTE) / 60f
                
                val yPos = when(wt.type) {
                    "Vezetés" -> height * 0.2f
                    "Munka", "Rakodás" -> height * 0.5f
                    else -> height * 0.8f
                }
                
                drawLine(
                    color = when(wt.type) {
                        "Vezetés" -> Color.Blue
                        "Munka", "Rakodás" -> Color.Red
                        else -> Color.Green
                    },
                    start = Offset(startHour * hourWidth, yPos),
                    end = Offset(endHour * hourWidth, yPos),
                    strokeWidth = 8f
                )
            }
        }
    }
}
