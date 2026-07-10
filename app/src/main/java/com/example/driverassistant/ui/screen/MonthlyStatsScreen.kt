package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.ui.viewmodel.StatsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonthlyStatsScreen(viewModel: StatsViewModel = hiltViewModel()) {
    val summary = viewModel.getMonthlySummary()
    val selectedMonth by viewModel.selectedMonth.collectAsState()

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(title = { Text("Havi Statisztika - $selectedMonth") })
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Zeitkonto Card
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (summary.zeitkontoBalance >= 0) Color(0xFFE8F5E9) else Color(0xFFFFEBEE)
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Zeitkonto (Egyenleg)", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = String.format("%.1f óra", summary.zeitkontoBalance),
                        fontSize = 48.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (summary.zeitkontoBalance >= 0) Color(0xFF2E7D32) else Color(0xFFC62828)
                    )
                    Text(
                        text = if (summary.zeitkontoBalance >= 0) "Túlóra" else "Hiányzó óra",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            // Statisztika sorok
            StatRow("Összes munkaidő", String.format("%.1f óra", summary.totalWorkHours))
            StatRow("Tiszta vezetés", String.format("%.1f óra", summary.driveHours))
            StatRow("Ledolgozott napok", "${summary.workDays} nap")
            
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "Az elszámolás alapja: napi 8 óra munkavégzés.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray
            )
        }
    }
}

@Composable
fun StatRow(label: String, value: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(label)
            Text(value, fontWeight = FontWeight.Bold)
        }
    }
}
