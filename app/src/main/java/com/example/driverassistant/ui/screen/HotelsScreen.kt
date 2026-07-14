package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.ui.viewmodel.HotelsViewModel
import com.example.driverassistant.util.IntentUtils

@Composable
fun HotelsScreen(viewModel: HotelsViewModel = hiltViewModel()) {
    val hotels by viewModel.hotels.collectAsState()
    var showAddDialog by remember { mutableStateOf(false) }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "Új hotel")
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            Text(
                text = "Hotelek",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(16.dp)
            )

            if (hotels.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(text = "Nincsenek rögzített szállások", color = Color.Gray)
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                    items(hotels) { hotel ->
                        HotelItem(
                            hotel = hotel,
                            onDelete = { viewModel.deleteHotel(hotel) },
                            onUpdate = { updatedHotel -> viewModel.updateHotel(updatedHotel) }
                        )
                    }
                }
            }
        }
    }

    if (showAddDialog) {
        HotelDetailsDialog(
            title = "Új hotel rögzítése",
            onDismiss = { showAddDialog = false },
            onConfirm = { name, address, room, code, bookingNumber, phone, email, notes ->
                viewModel.addHotel(name, address, room, code, bookingNumber, phone, email, notes)
                showAddDialog = false
            }
        )
    }
}

@Composable
fun HotelItem(
    hotel: Hotel,
    onDelete: () -> Unit,
    onUpdate: (Hotel) -> Unit
) {
    val context = LocalContext.current
    var showEditDialog by remember { mutableStateOf(false) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "[#${hotel.id} | ${hotel.uuid.take(8)}...]",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.Gray
                    )
                    Text(text = hotel.name, style = MaterialTheme.typography.titleLarge)
                    if (hotel.address.isNotBlank()) {
                        Text(text = hotel.address, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Row {
                    if (hotel.id < 0) {
                        AssistChip(
                            onClick = {},
                            enabled = false,
                            label = { Text("Túra része") },
                            leadingIcon = {
                                Icon(Icons.Default.Route, contentDescription = null, modifier = Modifier.size(18.dp))
                            }
                        )
                    } else {
                        IconButton(onClick = { showEditDialog = true }) {
                            Icon(Icons.Default.Edit, contentDescription = "Szerkesztés")
                        }
                        IconButton(onClick = { showDeleteConfirmation = true }) {
                            Icon(Icons.Default.Delete, contentDescription = "Törlés")
                        }
                    }
                }
            }
            
            if (hotel.roomNumber.isNotBlank() || hotel.entryCode.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    if (hotel.roomNumber.isNotBlank()) {
                        Text(text = "Szoba: ${hotel.roomNumber}")
                    }
                    if (hotel.entryCode.isNotBlank()) {
                        Text(text = "Kód: ${hotel.entryCode}", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            if (hotel.bookingNumber.isNotBlank()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = "Buchungsnummer: ${hotel.bookingNumber}", style = MaterialTheme.typography.bodyMedium)
            }
            
            if (hotel.notes?.isNotBlank() == true) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = hotel.notes!!, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }

            val hasActions = hotel.address.isNotBlank() || hotel.phoneNumber.isNotBlank() || hotel.email.isNotBlank()
            if (hasActions) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (hotel.address.isNotBlank()) {
                    AssistChip(
                        onClick = { IntentUtils.openMaps(context, hotel.address) },
                        label = { Text("Navigálás") },
                        leadingIcon = { Icon(Icons.Default.Navigation, contentDescription = null, modifier = Modifier.size(18.dp)) }
                    )
                }
                if (hotel.phoneNumber.isNotBlank()) {
                    AssistChip(
                        onClick = { IntentUtils.dialPhoneNumber(context, hotel.phoneNumber) },
                        label = { Text("Hívás") },
                        leadingIcon = { Icon(Icons.Default.Phone, contentDescription = null, modifier = Modifier.size(18.dp)) }
                    )
                }
                if (hotel.email.isNotBlank()) {
                    AssistChip(
                        onClick = { IntentUtils.sendEmail(context, hotel.email) },
                        label = { Text("Email") },
                        leadingIcon = { Icon(Icons.Default.Email, contentDescription = null, modifier = Modifier.size(18.dp)) }
                    )
                }
                }
            }
        }
    }

    if (showEditDialog) {
        HotelDetailsDialog(
            title = "Hotel szerkesztése",
            initialHotel = hotel,
            onDismiss = { showEditDialog = false },
            onConfirm = { name, address, room, code, bookingNumber, phone, email, notes ->
                onUpdate(hotel.copy(
                    name = name,
                    address = address,
                    roomNumber = room,
                    entryCode = code,
                    bookingNumber = bookingNumber,
                    phoneNumber = phone,
                    email = email,
                    notes = notes
                ))
                showEditDialog = false
            }
        )
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Hotel törlése") },
            text = { Text("Biztosan törölni szeretnéd a(z) \"${hotel.name}\" szállást?") },
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
fun HotelDetailsDialog(
    title: String,
    initialHotel: Hotel? = null,
    onDismiss: () -> Unit,
    onConfirm: (String, String, String, String, String, String, String, String) -> Unit
) {
    var name by remember { mutableStateOf(initialHotel?.name ?: "") }
    var address by remember { mutableStateOf(initialHotel?.address ?: "") }
    var room by remember { mutableStateOf(initialHotel?.roomNumber ?: "") }
    var code by remember { mutableStateOf(initialHotel?.entryCode ?: "") }
    var bookingNumber by remember { mutableStateOf(initialHotel?.bookingNumber ?: "") }
    var phone by remember { mutableStateOf(initialHotel?.phoneNumber ?: "") }
    var email by remember { mutableStateOf(initialHotel?.email ?: "") }
    var notes by remember { mutableStateOf(initialHotel?.notes ?: "") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                item {
                    TextField(value = name, onValueChange = { name = it }, label = { Text("Hotel neve") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = address, onValueChange = { address = it }, label = { Text("Cím") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = room, onValueChange = { room = it }, label = { Text("Szobaszám") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = code, onValueChange = { code = it }, label = { Text("Belépőkód") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = bookingNumber, onValueChange = { bookingNumber = it }, label = { Text("Buchungsnummer") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = phone, onValueChange = { phone = it }, label = { Text("Telefonszám") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            Button(onClick = { if (name.isNotEmpty()) onConfirm(name, address, room, code, bookingNumber, phone, email, notes) }) {
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
