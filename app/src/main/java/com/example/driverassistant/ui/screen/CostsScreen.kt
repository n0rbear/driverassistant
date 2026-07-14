package com.example.driverassistant.ui.screen

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.launch
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.domain.model.Cost
import com.example.driverassistant.ui.components.MileageDialog
import com.example.driverassistant.ui.viewmodel.CostsViewModel
import com.example.driverassistant.util.FileUtils
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun CostsScreen(viewModel: CostsViewModel = hiltViewModel()) {
    val costs by viewModel.costs.collectAsState()
    val isProcessing by viewModel.isProcessing.collectAsState()
    var showAddDialog by remember { mutableStateOf(false) }
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Lista", "Statisztika")
    val context = LocalContext.current

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "Új költség")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.padding(padding)) {
                Text(
                    text = "Költségek",
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.padding(16.dp)
                )

                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title) }
                        )
                    }
                }

                if (selectedTab == 0) {
                    if (costs.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(text = "Nincsenek rögzített költségek", color = Color.Gray)
                        }
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                            items(costs) { cost ->
                                CostItem(
                                    cost = cost,
                                    onDelete = { viewModel.deleteCost(cost) },
                                    onUpdate = { updatedCost -> viewModel.updateCost(updatedCost) }
                                )
                            }
                        }
                    }
                } else {
                    SpendingChart(costs = costs)
                }
            }
            
            if (isProcessing) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
        }
    }

    if (showAddDialog) {
        var pendingConfirmData by remember { mutableStateOf<Triple<Double, String, String>?>(null) }
        var pendingNotes by remember { mutableStateOf("") }

        AddCostDialog(
            onDismiss = { 
                showAddDialog = false
            },
            onConfirm = { amount, currency, category, notes ->
                if (category == "Tankolás") {
                    pendingConfirmData = Triple(amount, currency, category)
                    pendingNotes = notes
                } else {
                    viewModel.addCost(amount, currency, category, notes)
                    Toast.makeText(context, "Költség mentve", Toast.LENGTH_SHORT).show()
                    showAddDialog = false
                }
            }
        )

        if (pendingConfirmData != null) {
            MileageDialog(
                showLicensePlate = false,
                onDismiss = { pendingConfirmData = null },
                onConfirm = { mileage, _ ->
                    val (amount, currency, category) = pendingConfirmData!!
                    viewModel.addCost(amount, currency, category, pendingNotes, null, mileage)
                    Toast.makeText(context, "Tankolás rögzítve km óra állással", Toast.LENGTH_SHORT).show()
                    pendingConfirmData = null
                    showAddDialog = false
                }
            )
        }
    }
}

@Composable
fun SpendingChart(costs: List<Cost>) {
    if (costs.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Nincs adat a grafikonhoz", color = Color.Gray)
        }
        return
    }

    // Csoportosítás kategóriák szerint, jelenleg csak EUR-ban számolunk
    val spendingByCategory = costs.groupBy { it.category }.mapValues { entry ->
        entry.value.sumOf { it.amount }
    }.toList().sortedByDescending { it.second }

    val maxSpending = spendingByCategory.maxOfOrNull { it.second } ?: 1.0

    Column(modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Text("Költések kategóriánként (EUR)", style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(16.dp))
        
        spendingByCategory.forEach { (category, amount) ->
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text(category, style = MaterialTheme.typography.bodyMedium)
                    Text(String.format("%.2f EUR", amount), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { (amount / maxSpending).toFloat() },
                    modifier = Modifier.fillMaxWidth().height(12.dp).clip(MaterialTheme.shapes.small),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
        }
    }
}

@Composable
fun CostItem(
    cost: Cost,
    onDelete: () -> Unit,
    onUpdate: (Cost) -> Unit
) {
    val sdf = SimpleDateFormat("yyyy.MM.dd", Locale.getDefault())
    var showEditDialog by remember { mutableStateOf(false) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.ReceiptLong, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(16.dp))
                    Column {
                        Text(
                            text = "[#${cost.id} | ${cost.uuid.take(8)}...]",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.Gray
                        )
                        Text(text = "${cost.amount} ${cost.currency}", style = MaterialTheme.typography.titleLarge)
                        Text(text = "${cost.category} • ${sdf.format(Date(cost.timestamp))}", style = MaterialTheme.typography.bodySmall)
                        if (cost.photoPath != null) {
                            Text(text = "Fotó csatolva", style = MaterialTheme.typography.labelSmall, color = Color.DarkGray)
                        }
                    }
                }
                Row {
                    IconButton(onClick = { showEditDialog = true }) {
                        Icon(Icons.Default.Edit, contentDescription = "Szerkesztés")
                    }
                    IconButton(onClick = { showDeleteConfirmation = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Törlés")
                    }
                }
            }
            Text(
                text = cost.status,
                style = MaterialTheme.typography.labelMedium,
                color = when(cost.status) {
                    "Rögzítve" -> Color.Gray
                    "Beküldve" -> Color.Blue
                    "Elfogadva" -> Color.Green
                    "Kifizetve" -> MaterialTheme.colorScheme.primary
                    else -> Color.Black
                },
                modifier = Modifier.align(Alignment.End)
            )
        }
    }

    if (showEditDialog) {
        EditCostDialog(
            cost = cost,
            onDismiss = { showEditDialog = false },
            onConfirm = { updatedCost ->
                onUpdate(updatedCost)
                showEditDialog = false
            }
        )
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Költség törlése") },
            text = { Text("Biztosan törölni szeretnéd ezt a költséget (${cost.amount} ${cost.currency})?") },
            confirmButton = {
                Button(
                    onClick = {
                        onDelete()
                        showDeleteConfirmation = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Törlés")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirmation = false }) {
                    Text("Mégse")
                }
            }
        )
    }
}

@Composable
fun EditCostDialog(cost: Cost, onDismiss: () -> Unit, onConfirm: (Cost) -> Unit) {
    var amount by remember { mutableStateOf(cost.amount.toString()) }
    var selectedCategory by remember { mutableStateOf(cost.category) }
    var notes by remember { mutableStateOf(cost.notes) }

    val categories = listOf("Hotel", "Parkolás", "Matrica", "Útdíj", "Tankolás", "Szerviz", "Adblue", "Mosás", "Egyéb")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Költség szerkesztése") },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                item {
                    TextField(
                        value = amount, 
                        onValueChange = { amount = it }, 
                        label = { Text("Összeg (EUR)") }, 
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Kategória:", style = MaterialTheme.typography.labelMedium)
                    Column {
                        categories.chunked(2).forEach { rowCats ->
                            Row {
                                rowCats.forEach { cat ->
                                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                                        RadioButton(selected = selectedCategory == cat, onClick = { selectedCategory = cat })
                                        Text(cat, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            Button(onClick = { 
                val amt = amount.toDoubleOrNull() ?: 0.0
                onConfirm(cost.copy(amount = amt, currency = "EUR", category = selectedCategory, notes = notes)) 
            }) {
                Text("Mentés")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Mégse")
            }
        }
    )
}

@Composable
fun AddCostDialog(
    onDismiss: () -> Unit,
    onConfirm: (Double, String, String, String) -> Unit
) {
    var amount by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("Egyéb") }
    var notes by remember { mutableStateOf("") }
    
    val categories = listOf("Hotel", "Parkolás", "Matrica", "Útdíj", "Tankolás", "Szerviz", "Adblue", "Mosás", "Egyéb")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Új költség felvétele") },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                item {
                    TextField(
                        value = amount, 
                        onValueChange = { amount = it }, 
                        label = { Text("Összeg (EUR)") }, 
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Kategória:", style = MaterialTheme.typography.labelMedium)
                    Column {
                        categories.chunked(2).forEach { rowCats ->
                            Row {
                                rowCats.forEach { cat ->
                                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                                        RadioButton(selected = selectedCategory == cat, onClick = { selectedCategory = cat })
                                        Text(cat, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            Button(onClick = { 
                val amt = amount.toDoubleOrNull() ?: 0.0
                onConfirm(amt, "EUR", selectedCategory, notes)
            }) {
                Text("Mentés")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Mégse")
            }
        }
    )
}
