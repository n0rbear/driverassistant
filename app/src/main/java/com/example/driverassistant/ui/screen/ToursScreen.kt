package com.example.driverassistant.ui.screen

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.rememberAsyncImagePainter
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.domain.model.Stop
import com.example.driverassistant.domain.model.Tour
import com.example.driverassistant.ui.components.AILoadingAnimation
import com.example.driverassistant.ui.viewmodel.ToursViewModel
import androidx.activity.result.launch
import com.example.driverassistant.util.FileUtils
import com.example.driverassistant.util.IntentUtils
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun ToursScreen(viewModel: ToursViewModel = hiltViewModel()) {
    val tours by viewModel.tours.collectAsState()
    val isProcessing by viewModel.isProcessing.collectAsState()
    val syncError by viewModel.syncError.collectAsState()
    var showDialog by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.syncToursWithBackend()
        while(true) {
            kotlinx.coroutines.delay(60000)
            viewModel.syncToursWithBackend()
        }
    }

    LaunchedEffect(syncError) {
        syncError?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
        }
    }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { showDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "Új túra")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.padding(padding)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Túrák",
                        style = MaterialTheme.typography.headlineMedium
                    )
                    IconButton(onClick = { viewModel.syncToursWithBackend() }) {
                        Icon(Icons.Default.Sync, contentDescription = "Szinkronizálás")
                    }
                }

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp)
                ) {
                    items(tours) { tour ->
                        TourItem(tour, viewModel, onDelete = { viewModel.deleteTour(tour) })
                    }
                }
            }

            if (isProcessing) {
                AILoadingAnimation()
            }
        }
    }

    if (showDialog) {
        AddTourDialog(
            onDismiss = { showDialog = false },
            onConfirm = { name, customer, notes ->
                viewModel.addTour(name, customer, System.currentTimeMillis(), notes)
                showDialog = false
            }
        )
    }
}

@Composable
fun TourItem(tour: Tour, viewModel: ToursViewModel, onDelete: () -> Unit) {
    val context = LocalContext.current
    val sdf = SimpleDateFormat("yyyy.MM.dd", Locale.getDefault())
    var expanded by remember { mutableStateOf(false) }
    val stops by viewModel.getStops(tour.id).collectAsState(initial = emptyList())
    val hotels by viewModel.hotels.collectAsState()
    var showAddStopDialog by remember { mutableStateOf(false) }
    var showAddHotelDialog by remember { mutableStateOf(false) }
    var showEditTourDialog by remember { mutableStateOf(false) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        onClick = { expanded = !expanded }
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = tour.name, style = MaterialTheme.typography.titleLarge)
                    if (tour.customer.isNotBlank()) {
                        Text(text = tour.customer, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = sdf.format(Date(tour.date)), style = MaterialTheme.typography.bodyMedium)
                        if (!tour.dayOfWeek.isNullOrBlank()) {
                            Text(text = " (${tour.dayOfWeek})", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.secondary)
                        }
                    }
                }
                Row {
                    if (!tour.isCurrent) {
                        IconButton(onClick = { viewModel.setCurrentTour(tour) }) {
                            Icon(Icons.Default.PlayArrow, contentDescription = "Túra indítása", tint = Color.Green)
                        }
                    } else {
                        Icon(
                            Icons.Default.CheckCircle, 
                            contentDescription = "Aktív túra", 
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(12.dp)
                        )
                    }
                    IconButton(onClick = { showEditTourDialog = true }) {
                        Icon(Icons.Default.Edit, contentDescription = "Szerkesztés")
                    }
                    IconButton(onClick = { showDeleteConfirmation = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Törlés")
                    }
                }
            }
            
            if (tour.notes.isNotEmpty()) {
                Text(text = tour.notes, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 4.dp))
            }

            AnimatedVisibility(visible = expanded) {
                Column {
                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                    Text(text = "Állomások (${stops.size})", style = MaterialTheme.typography.titleSmall)
                    
                    stops.forEachIndexed { index, stop ->
                        StopItem(
                            tour = tour,
                            stop = stop,
                            viewModel = viewModel,
                            onDelete = { viewModel.deleteStop(stop) },
                            onUpdate = { updatedStop -> viewModel.updateStop(updatedStop) },
                            onMoveUp = { viewModel.moveStopUp(tour.id, stop) },
                            onMoveDown = { viewModel.moveStopDown(tour.id, stop) },
                            isFirst = index == 0,
                            isLast = index == stops.size - 1
                        )
                    }

                    Button(
                        onClick = { showAddStopDialog = true },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) {
                        Icon(Icons.Default.AddLocation, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Új állomás hozzáadása")
                    }

                    OutlinedButton(
                        onClick = { showAddHotelDialog = true },
                        enabled = hotels.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                    ) {
                        Icon(Icons.Default.Hotel, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (hotels.isEmpty()) "Nincs mentett hotel" else "Hotel beszúrása a túrába")
                    }
                }
            }
        }
    }

    if (showAddStopDialog) {
        AddStopDialog(
            onDismiss = { showAddStopDialog = false },
            onConfirm = { recipient, street, house, postal, city, contact, phone, email, window, notes, type ->
                viewModel.addStop(tour.id, recipient, street, house, postal, city, contact, phone, email, window, notes, type)
                showAddStopDialog = false
            }
        )
    }

    if (showAddHotelDialog) {
        AddHotelStopDialog(
            hotels = hotels,
            stops = stops,
            onDismiss = { showAddHotelDialog = false },
            onConfirm = { hotel, afterStopId ->
                viewModel.addHotelStop(tour.id, hotel, afterStopId)
                showAddHotelDialog = false
            }
        )
    }

    if (showEditTourDialog) {
        EditTourDialog(
            tour = tour,
            onDismiss = { showEditTourDialog = false },
            onConfirm = { updatedTour ->
                viewModel.updateTour(updatedTour)
                showEditTourDialog = false
            }
        )
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Túra törlése") },
            text = { Text("Biztosan törölni szeretnéd a(z) \"${tour.name}\" túrát?") },
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
fun StopItem(
    tour: Tour,
    stop: Stop,
    viewModel: ToursViewModel,
    onDelete: () -> Unit,
    onUpdate: (Stop) -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    isFirst: Boolean,
    isLast: Boolean
) {
    val context = LocalContext.current
    var showEditDialog by remember { mutableStateOf(false) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }
    var showDetailsDialog by remember { mutableStateOf(false) }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        onClick = { showDetailsDialog = true }
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    if (stop.recipient.isNotBlank()) {
                        Text(text = stop.recipient, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Text(text = stop.addressFull.ifBlank { stop.address }, style = MaterialTheme.typography.bodyLarge)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (stop.stopType == "HOTEL") {
                            Icon(Icons.Default.Hotel, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                            Spacer(modifier = Modifier.width(4.dp))
                        } else if (stop.stopType == "DEPOT") {
                            Icon(Icons.Default.Warehouse, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                            Spacer(modifier = Modifier.width(4.dp))
                        }
                        Text(text = "${stop.contactName} • ${stop.timeWindow}", style = MaterialTheme.typography.bodySmall)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        IconButton(onClick = onMoveUp, enabled = !isFirst, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.ArrowUpward, contentDescription = null, modifier = Modifier.size(16.dp))
                        }
                        IconButton(onClick = onMoveDown, enabled = !isLast, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.ArrowDownward, contentDescription = null, modifier = Modifier.size(16.dp))
                        }
                    }
                    IconButton(onClick = { showEditDialog = true }) {
                        Icon(Icons.Default.Edit, contentDescription = "Szerkesztés", modifier = Modifier.size(20.dp))
                    }
                    IconButton(onClick = { showDeleteConfirmation = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Törlés", modifier = Modifier.size(20.dp))
                    }
                }
            }
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = { IntentUtils.openMaps(context, stop.address) }) {
                    Icon(Icons.Default.Navigation, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("Navigálás", style = MaterialTheme.typography.labelSmall)
                }
                if (stop.phoneNumber.isNotBlank()) {
                    TextButton(onClick = { IntentUtils.dialPhoneNumber(context, stop.phoneNumber) }) {
                        Icon(Icons.Default.Phone, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("Hívás", style = MaterialTheme.typography.labelSmall)
                    }
                }
                if (stop.email.isNotBlank()) {
                    TextButton(onClick = { IntentUtils.sendEmail(context, stop.email) }) {
                        Icon(Icons.Default.Email, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("Email", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }

    if (showDetailsDialog) {
        StopDetailsDialog(
            tour = tour,
            stop = stop,
            viewModel = viewModel,
            onDismiss = { showDetailsDialog = false }
        )
    }

    if (showEditDialog) {
        EditStopDialog(
            stop = stop,
            onDismiss = { showEditDialog = false },
            onConfirm = { updatedStop ->
                onUpdate(updatedStop)
                showEditDialog = false
            }
        )
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Állomás törlése") },
            text = { Text("Biztosan törölni szeretnéd ezt az állomást?") },
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
fun StopDetailsDialog(tour: Tour, stop: Stop, viewModel: ToursViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val photoPickerLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.uploadStopPhoto(stop, it) }
    }
    val potentialNames = remember(stop.alternativeNames) {
        try {
            if (stop.alternativeNames != null) {
                if (stop.alternativeNames.contains("|")) {
                    stop.alternativeNames.split("|")
                } else {
                    com.google.gson.Gson().fromJson(stop.alternativeNames, Array<String>::class.java).toList()
                }
            } else emptyList()
        } catch (e: Exception) {
            emptyList<String>()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Állomás részletei") },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (stop.recipient.isNotBlank()) {
                    Text(text = "Címzett:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(text = stop.recipient, style = MaterialTheme.typography.bodyLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Text(text = "Cím:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(text = stop.addressFull.ifBlank { stop.address }, style = MaterialTheme.typography.bodyLarge)
                Spacer(modifier = Modifier.height(8.dp))
                
                Text(text = "Aktuális kapcsolattartó:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(text = stop.contactName.ifBlank { "Nincs megadva" }, style = MaterialTheme.typography.bodyLarge)
                
                if (potentialNames.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(text = "Másik név választása:", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                    potentialNames.forEachIndexed { index, name ->
                        OutlinedButton(
                            onClick = { 
                                viewModel.selectCorrectName(tour, stop, name, index)
                                onDismiss()
                            },
                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            enabled = name != stop.contactName
                        ) {
                            Text(name, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                
                Text(text = "Időablak:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(text = stop.timeWindow.ifBlank { "Nincs megadva" }, style = MaterialTheme.typography.bodyLarge)
                Spacer(modifier = Modifier.height(8.dp))
                
                if (stop.phoneNumber.isNotBlank()) {
                    Text(text = "Telefonszám:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(text = stop.phoneNumber, style = MaterialTheme.typography.bodyLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                
                if (stop.email.isNotBlank()) {
                    Text(text = "Email:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(text = stop.email, style = MaterialTheme.typography.bodyLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                
                if (stop.notes.isNotBlank()) {
                    Text(text = "Megjegyzés:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(text = stop.notes, style = MaterialTheme.typography.bodyLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }

                if (!stop.photoUrl.isNullOrBlank()) {
                    Text(text = "Helyszíni fotó:", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    val photoUrl = if (stop.photoUrl.startsWith("/")) "https://driverassistant.onrender.com${stop.photoUrl}" else stop.photoUrl
                    Image(
                        painter = rememberAsyncImagePainter(photoUrl),
                        contentDescription = "Helyszíni fotó",
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .padding(top = 4.dp),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { photoPickerLauncher.launch("image/*") }) {
                    Icon(Icons.Default.PhotoCamera, contentDescription = null)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Fotó")
                }
                Button(onClick = onDismiss) {
                    Text("Bezárás")
                }
            }
        }
    )
}

@Composable
fun AddHotelStopDialog(
    hotels: List<Hotel>,
    stops: List<Stop>,
    onDismiss: () -> Unit,
    onConfirm: (Hotel, Long?) -> Unit
) {
    var selectedHotel by remember(hotels) { mutableStateOf(hotels.firstOrNull()) }
    var selectedAfterStopId by remember(stops) { mutableStateOf<Long?>(stops.lastOrNull()?.id) }
    var hotelExpanded by remember { mutableStateOf(false) }
    var positionExpanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Hotel beszúrása") },
        text = {
            Column {
                Text("Hotel", style = MaterialTheme.typography.labelSmall)
                Box(modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = { hotelExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(selectedHotel?.name ?: "Válassz hotelt")
                        Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                    }
                    DropdownMenu(expanded = hotelExpanded, onDismissRequest = { hotelExpanded = false }) {
                        hotels.forEach { hotel ->
                            DropdownMenuItem(
                                text = { Text(hotel.name) },
                                onClick = {
                                    selectedHotel = hotel
                                    hotelExpanded = false
                                }
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
                Text("Helye a túrában", style = MaterialTheme.typography.labelSmall)
                Box(modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = { positionExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                        val label = stops.firstOrNull { it.id == selectedAfterStopId }?.let { selectedStop ->
                            "Ez után: ${selectedStop.recipient.ifBlank { selectedStop.addressFull.ifBlank { selectedStop.address } }}"
                        } ?: "A lista végére"
                        Text(label, maxLines = 1)
                        Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                    }
                    DropdownMenu(expanded = positionExpanded, onDismissRequest = { positionExpanded = false }) {
                        DropdownMenuItem(
                            text = { Text("A lista végére") },
                            onClick = {
                                selectedAfterStopId = stops.lastOrNull()?.id
                                positionExpanded = false
                            }
                        )
                        stops.forEach { stop ->
                            DropdownMenuItem(
                                text = { Text("Ez után: ${stop.recipient.ifBlank { stop.addressFull.ifBlank { stop.address } }}") },
                                onClick = {
                                    selectedAfterStopId = stop.id
                                    positionExpanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { selectedHotel?.let { onConfirm(it, selectedAfterStopId) } },
                enabled = selectedHotel != null
            ) {
                Text("Beszúrás")
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
fun EditTourDialog(tour: Tour, onDismiss: () -> Unit, onConfirm: (Tour) -> Unit) {
    var name by remember { mutableStateOf(tour.name) }
    var customer by remember { mutableStateOf(tour.customer) }
    var dayOfWeek by remember { mutableStateOf(tour.dayOfWeek ?: "") }
    var notes by remember { mutableStateOf(tour.notes) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Túra szerkesztése") },
        text = {
            Column {
                TextField(value = name, onValueChange = { name = it }, label = { Text("Túra neve") }, modifier = Modifier.fillMaxWidth())
                Spacer(modifier = Modifier.height(8.dp))
                TextField(value = customer, onValueChange = { customer = it }, label = { Text("Megrendelő") }, modifier = Modifier.fillMaxWidth())
                Spacer(modifier = Modifier.height(8.dp))
                TextField(value = dayOfWeek, onValueChange = { dayOfWeek = it }, label = { Text("Nap (Hétfő, Kedd...)") }, modifier = Modifier.fillMaxWidth())
                Spacer(modifier = Modifier.height(8.dp))
                TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(tour.copy(name = name, customer = customer, dayOfWeek = if (dayOfWeek.isBlank()) null else dayOfWeek, notes = notes)) }) {
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
fun EditStopDialog(stop: Stop, onDismiss: () -> Unit, onConfirm: (Stop) -> Unit) {
    var recipient by remember { mutableStateOf(stop.recipient) }
    var street by remember { mutableStateOf(stop.street) }
    var houseNumber by remember { mutableStateOf(stop.houseNumber) }
    var postalCode by remember { mutableStateOf(stop.postalCode) }
    var city by remember { mutableStateOf(stop.city) }
    var contact by remember { mutableStateOf(stop.contactName) }
    var phone by remember { mutableStateOf(stop.phoneNumber) }
    var email by remember { mutableStateOf(stop.email) }
    var window by remember { mutableStateOf(stop.timeWindow) }
    var notes by remember { mutableStateOf(stop.notes) }
    var stopType by remember { mutableStateOf(stop.stopType) }
    
    val potentialNames = remember(stop.alternativeNames) {
        try {
            if (stop.alternativeNames != null) {
                if (stop.alternativeNames!!.contains("|")) {
                    stop.alternativeNames!!.split("|")
                } else {
                    com.google.gson.Gson().fromJson(stop.alternativeNames, Array<String>::class.java).toList()
                }
            } else emptyList()
        } catch (e: Exception) {
            emptyList<String>()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Állomás szerkesztése") },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 450.dp)) {
                item {
                    if (potentialNames.isNotEmpty()) {
                        var expanded by remember { mutableStateOf(false) }
                        Text(text = "Címzett választása:", style = MaterialTheme.typography.labelSmall)
                        Box(modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = { expanded = true },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(recipient.ifBlank { "Válassz..." })
                                Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                            }
                            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                                potentialNames.forEach { name ->
                                    DropdownMenuItem(
                                        text = { Text(name) },
                                        onClick = {
                                            recipient = name
                                            expanded = false
                                        }
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text("-- Egyéni --") },
                                    onClick = {
                                        expanded = false
                                    }
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    TextField(value = recipient, onValueChange = { recipient = it }, label = { Text("Címzett") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth()) {
                        TextField(value = street, onValueChange = { street = it }, label = { Text("Utca") }, modifier = Modifier.weight(2f))
                        Spacer(modifier = Modifier.width(8.dp))
                        TextField(value = houseNumber, onValueChange = { houseNumber = it }, label = { Text("Hsz") }, modifier = Modifier.weight(1f))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth()) {
                        TextField(value = postalCode, onValueChange = { postalCode = it }, label = { Text("Irsz") }, modifier = Modifier.weight(1f))
                        Spacer(modifier = Modifier.width(8.dp))
                        TextField(value = city, onValueChange = { city = it }, label = { Text("Város") }, modifier = Modifier.weight(2f))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = contact, onValueChange = { contact = it }, label = { Text("Kapcsolattartó") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = phone, onValueChange = { phone = it }, label = { Text("Telefonszám") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = window, onValueChange = { window = it }, label = { Text("Időablak") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(text = "Típus:", style = MaterialTheme.typography.labelSmall)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("DELIVERY", "PICKUP", "HOTEL", "DEPOT").forEach { type ->
                            FilterChip(
                                selected = stopType == type,
                                onClick = { stopType = type },
                                label = { Text(type, style = MaterialTheme.typography.labelSmall) }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { 
                val addressFull = "$street $houseNumber, $postalCode $city".trim().removePrefix(",").trim()
                onConfirm(stop.copy(
                    recipient = recipient,
                    street = street,
                    houseNumber = houseNumber,
                    postalCode = postalCode,
                    city = city,
                    addressFull = addressFull,
                    address = addressFull,
                    contactName = contact,
                    phoneNumber = phone,
                    email = email,
                    timeWindow = window,
                    notes = notes,
                    stopType = stopType
                )) 
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
fun AddTourDialog(onDismiss: () -> Unit, onConfirm: (String, String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var customer by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Új túra létrehozása") },
        text = {
            Column {
                TextField(value = name, onValueChange = { name = it }, label = { Text("Túra neve") }, modifier = Modifier.fillMaxWidth())
                Spacer(modifier = Modifier.height(8.dp))
                TextField(value = customer, onValueChange = { customer = it }, label = { Text("Megrendelő") }, modifier = Modifier.fillMaxWidth())
                Spacer(modifier = Modifier.height(8.dp))
                TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            Button(onClick = { if (name.isNotEmpty()) onConfirm(name, customer, notes) }) {
                Text("Létrehozás")
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
fun AddStopDialog(onDismiss: () -> Unit, onConfirm: (String, String, String, String, String, String, String, String, String, String, String) -> Unit) {
    var recipient by remember { mutableStateOf("") }
    var street by remember { mutableStateOf("") }
    var houseNumber by remember { mutableStateOf("") }
    var postalCode by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var contact by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var window by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var stopType by remember { mutableStateOf("DELIVERY") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Új állomás") },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 450.dp)) {
                item {
                    TextField(value = recipient, onValueChange = { recipient = it }, label = { Text("Címzett") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth()) {
                        TextField(value = street, onValueChange = { street = it }, label = { Text("Utca") }, modifier = Modifier.weight(2f))
                        Spacer(modifier = Modifier.width(8.dp))
                        TextField(value = houseNumber, onValueChange = { houseNumber = it }, label = { Text("Hsz") }, modifier = Modifier.weight(1f))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(modifier = Modifier.fillMaxWidth()) {
                        TextField(value = postalCode, onValueChange = { postalCode = it }, label = { Text("Irsz") }, modifier = Modifier.weight(1f))
                        Spacer(modifier = Modifier.width(8.dp))
                        TextField(value = city, onValueChange = { city = it }, label = { Text("Város") }, modifier = Modifier.weight(2f))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = contact, onValueChange = { contact = it }, label = { Text("Kapcsolattartó") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = phone, onValueChange = { phone = it }, label = { Text("Telefonszám") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = window, onValueChange = { window = it }, label = { Text("Időablak") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    TextField(value = notes, onValueChange = { notes = it }, label = { Text("Megjegyzés") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(text = "Típus:", style = MaterialTheme.typography.labelSmall)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("DELIVERY", "PICKUP", "HOTEL", "DEPOT").forEach { type ->
                            FilterChip(
                                selected = stopType == type,
                                onClick = { stopType = type },
                                label = { Text(type, style = MaterialTheme.typography.labelSmall) }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { 
                if (recipient.isNotEmpty() || street.isNotEmpty()) {
                    onConfirm(recipient, street, houseNumber, postalCode, city, contact, phone, email, window, notes, stopType)
                }
            }) {
                Text("Hozzáadás")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Mégse")
            }
        }
    )
}
