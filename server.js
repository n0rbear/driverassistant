package com.example.driverassistant.ui.screen

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.launch
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.example.driverassistant.R
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.ui.components.AILoadingAnimation
import com.example.driverassistant.ui.components.MileageDialog
import com.example.driverassistant.ui.viewmodel.DashboardViewModel
import com.example.driverassistant.util.FileUtils
import com.example.driverassistant.util.NotificationUtils
import com.example.driverassistant.util.TimeUtils
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = hiltViewModel(),
    aiViewModel: com.example.driverassistant.ui.viewmodel.AIViewModel = hiltViewModel()
) {
    val currentTime = remember { mutableStateOf(System.currentTimeMillis()) }
    val workTimes by viewModel.workTimes.collectAsState()
    val isAIProcessing by aiViewModel.isProcessing.collectAsState()
    val currentTour by viewModel.currentTour.collectAsState()
    val nextStop by viewModel.nextStop.collectAsState()
    val profileDepot by viewModel.profileDepot.collectAsState()
    
    SideEffect {
        if (currentTour != null) {
            android.util.Log.d("DashboardTrace", "DashboardScreen RECOMPOSE: Tour ID: ${currentTour?.id}, UUID: ${currentTour?.uuid}, Name: ${currentTour?.name}, isCurrent: ${currentTour?.isCurrent}")
        } else {
            android.util.Log.d("DashboardTrace", "DashboardScreen RECOMPOSE: currentTour is NULL")
        }
        
        if (nextStop != null) {
            android.util.Log.d("DashboardTrace", "DashboardScreen RECOMPOSE: nextStop: ${nextStop?.contactName}, isCompleted: ${nextStop?.isCompleted}")
        } else {
            android.util.Log.d("DashboardTrace", "DashboardScreen RECOMPOSE: nextStop is NULL")
        }
    }
    val nextStopDistance by viewModel.nextStopDistance.collectAsState()
    val tourRemainingDistance by viewModel.tourRemainingDistance.collectAsState()
    val ongoingTask by viewModel.ongoingWorkTime.collectAsState()
    val currentStatus = ongoingTask?.type ?: "Offline"
    val context = LocalContext.current
    
    var showHistory by remember { mutableStateOf(false) }
    var editingWorkTime by remember { mutableStateOf<WorkTime?>(null) }
    var showMileageDialog by remember { mutableStateOf<String?>(null) }
    val lastData by viewModel.lastData.collectAsState()
    
    var selectedUris by remember { mutableStateOf<List<android.net.Uri>>(emptyList()) }
    var showPageQuestion by remember { mutableStateOf(false) }
    var lastActionByCamera by remember { mutableStateOf(false) }

    var tempUri by remember { mutableStateOf<android.net.Uri?>(null) }
    
    val pendingTour by aiViewModel.pendingTour.collectAsState()
    val existingCustomers by aiViewModel.existingCustomers.collectAsState()

    val photoLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success ->
        if (success) {
            tempUri?.let { u ->
                selectedUris = selectedUris + u
                showPageQuestion = true
            }
        }
    }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let { u ->
            selectedUris = selectedUris + u
            showPageQuestion = true
        }
    }

    if (showPageQuestion) {
        AlertDialog(
            onDismissRequest = { showPageQuestion = false },
            title = { Text("További oldalak?") },
            text = { Text("Szeretnél még egy oldalt hozzáadni ehhez a dokumentumhoz?") },
            confirmButton = {
                Button(onClick = {
                    showPageQuestion = false
                    if (lastActionByCamera) {
                        val uri = FileUtils.getTempUri(context)
                        tempUri = uri
                        photoLauncher.launch(uri)
                    } else {
                        filePickerLauncher.launch("*/*")
                    }
                }) {
                    Text("Igen, újabb oldal")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showPageQuestion = false
                    if (selectedUris.isNotEmpty()) {
                        aiViewModel.processAnyDocument(context, selectedUris) { msg ->
                            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                            selectedUris = emptyList()
                        }
                    }
                }) {
                    Text("Nem, feldolgozás indítása")
                }
            }
        )
    }

    if (pendingTour != null) {
        CustomerSelectionDialog(
            initialCustomer = pendingTour?.customer,
            options = existingCustomers,
            onDismiss = { aiViewModel.clearPendingTour() },
            onConfirm = { name -> aiViewModel.confirmTour(name) }
        )
    }

    LaunchedEffect(Unit) {
        while (true) {
            currentTime.value = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }

    val sdf = SimpleDateFormat("yyyy.MM.dd HH:mm:ss", Locale.getDefault())
    val timeSdf = SimpleDateFormat("HH:mm", Locale.getDefault())

    Box(modifier = Modifier.fillMaxSize()) {
        Image(
            painter = painterResource(id = R.drawable.background_main),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
            alpha = 0.3f
        )
        
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = "Aktuális idő: ${sdf.format(Date(currentTime.value))}", style = MaterialTheme.typography.titleMedium)
                IconButton(onClick = { showHistory = !showHistory }) {
                    Icon(Icons.Default.History, contentDescription = "Előzmények")
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = { 
                        lastActionByCamera = true
                        val uri = FileUtils.getTempUri(context)
                        tempUri = uri
                        photoLauncher.launch(uri) 
                    },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary)
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Fotózás (AI)")
                }

                Button(
                    onClick = { 
                        lastActionByCamera = false
                        filePickerLauncher.launch("*/*") 
                    },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary)
                ) {
                    Icon(Icons.Default.UploadFile, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Feltöltés (AI)")
                }
            }
        
            Spacer(modifier = Modifier.height(16.dp))
            
            DashboardCard("Munkaidő", viewModel.getTotalTime("Munka", currentTime.value))
            DashboardCard("Vezetési idő", viewModel.getTotalTime("Vezetés", currentTime.value))
            DashboardCard("Pihenőidő", viewModel.getTotalTime("Pihenő", currentTime.value))
            
            Spacer(modifier = Modifier.height(16.dp))

            // --- TÉRKÉP SZEKCIÓ ---
            val lastLocation by viewModel.lastLocation.collectAsState()
            val currentStops by viewModel.currentStops.collectAsState()
            
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(320.dp)
                    .padding(vertical = 8.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A1A))
            ) {
                Box(modifier = Modifier.fillMaxSize()) {
                    androidx.compose.ui.viewinterop.AndroidView(
                        factory = { ctx ->
                            android.webkit.WebView(ctx).apply {
                                layoutParams = android.view.ViewGroup.LayoutParams(
                                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                                    android.view.ViewGroup.LayoutParams.MATCH_PARENT
                                )
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.loadWithOverviewMode = true
                                settings.useWideViewPort = true
                                settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                                
                                // OSM Policy: Kötelező egyedi User-Agent beállítása
                                settings.userAgentString = "DriverAssistantApp/1.0 (com.example.driverassistant; contact: horvath.d.norbert@gmail.com)"

                                // Samsung/Modern Android fix: transzparens háttér a WebView-nak
                                setBackgroundColor(0) 
                                
                                webViewClient = object : android.webkit.WebViewClient() {
                                    override fun onPageFinished(view: android.webkit.WebView?, url: String?) {
                                        android.util.Log.d("WebViewTrace", "Map HTML loaded")
                                        view?.evaluateJavascript("setTimeout(function(){ map.invalidateSize(); }, 500);", null)
                                    }
                                }
                                webChromeClient = android.webkit.WebChromeClient()
                            }
                        },
                        update = { webView ->
                            val lat = lastLocation?.latitude ?: 47.4979
                            val lng = lastLocation?.longitude ?: 19.0402
                            
                            val safeLat = if (lat.isNaN() || lat == 0.0) 47.4979 else lat
                            val safeLng = if (lng.isNaN() || lng == 0.0) 19.0402 else lng

                            val stopsJs = currentStops.filter { it.latitude != null && it.longitude != null && !it.latitude!!.isNaN() }
                                .joinToString(",") { "{lat: ${it.latitude}, lng: ${it.longitude}, name: '${it.recipient.replace("'", "")}', completed: ${it.isCompleted}}" }

                            val depotJs = profileDepot?.let { 
                                if (it.latitude != null && it.longitude != null) 
                                    "{lat: ${it.latitude}, lng: ${it.longitude}, name: '${it.name.replace("'", "")}'}" 
                                else "null" 
                            } ?: "null"

                            val html = """
                                <!DOCTYPE html>
                                <html style="height:100%; width:100%;">
                                <head>
                                    <meta charset="utf-8" />
                                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                                    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                                    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                                    <style>
                                        html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #1a1a1a; }
                                        .driver-icon-inner { background:#3498db; width:12px; height:12px; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(52,152,219,0.8); }
                                    </style>
                                </head>
                                <body>
                                    <div id="map"></div>
                                    <script>
                                        var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([$safeLat, $safeLng], 13);
                                        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                                            attribution: '&copy; OpenStreetMap'
                                        }).addTo(map);
                                        
                                        var driverIcon = L.divIcon({
                                            className: 'driver-icon',
                                            html: '<div class="driver-icon-inner"></div>',
                                            iconSize: [18, 18], iconAnchor: [9, 9]
                                        });
                                        var marker = L.marker([$safeLat, $safeLng], { icon: driverIcon }).addTo(map);
                                        
                                        var stops = [$stopsJs];
                                        var depot = $depotJs;
                                        var group = [[$safeLat, $safeLng]];
                                        var nextStop = null;

                                        stops.forEach(function(s) {
                                            var color = s.completed ? '#7f8c8d' : '#e74c3c';
                                            L.circleMarker([s.lat, s.lng], { radius: 6, color: color, fillColor: color, fillOpacity: 0.8 }).addTo(map);
                                            group.push([s.lat, s.lng]);
                                            if (!s.completed && !nextStop) {
                                                nextStop = s;
                                            }
                                        });

                                        if (depot) {
                                            L.marker([depot.lat, depot.lng], { 
                                                icon: L.divIcon({ className: 'depot-icon', html: '<div style="background:#2ecc71; width:10px; height:10px; border-radius:4px; border:2px solid white;"></div>' }) 
                                            }).addTo(map);
                                            group.push([depot.lat, depot.lng]);
                                        }

                                        if (group.length > 1) {
                                            map.fitBounds(group, { padding: [40, 40] });
                                        }
                                        
                                        var waypointStr = $safeLng + ',' + $safeLat;
                                        var incompleteStops = stops.filter(function(s) { return !s.completed; });
                                        
                                        incompleteStops.forEach(function(s) {
                                            waypointStr += ';' + s.lng + ',' + s.lat;
                                        });
                                        
                                        if (depot) {
                                            waypointStr += ';' + depot.lng + ',' + depot.lat;
                                        }

                                        if (waypointStr.includes(';')) {
                                            fetch('https://router.project-osrm.org/route/v1/driving/' + waypointStr + '?overview=full&geometries=geojson')
                                                .then(r => r.json())
                                                .then(data => {
                                                    if (data.routes && data.routes[0]) {
                                                        L.geoJSON(data.routes[0].geometry, { style: { color: '#3498db', weight: 5, opacity: 0.6 } }).addTo(map);
                                                    }
                                                });
                                        }
                                    </script>
                                </body>
                                </html>
                            """.trimIndent()
                            
                            // Csak 50-100 méterenként töltsük újra, vagy ha a megállók/depó változnak
                            val latTag = (safeLat * 1000).toInt()
                            val lngTag = (safeLng * 1000).toInt()
                            val contentTag = "${latTag}_${lngTag}_${stopsJs.hashCode()}_${depotJs.hashCode()}"
                            
                            if (webView.tag != contentTag) {
                                webView.loadDataWithBaseURL("https://www.openstreetmap.org", html, "text/html", "UTF-8", null)
                                webView.tag = contentTag
                            }
                        },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }


            Spacer(modifier = Modifier.height(16.dp))
            
            if (ongoingTask != null) {
                val task = ongoingTask!!
                val duration = currentTime.value - task.startTime
                val hours = duration / 3600000
                val minutes = (duration % 3600000) / 60000
                val seconds = (duration % 60000) / 1000
                
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(text = "Aktív: ${task.type}", style = MaterialTheme.typography.headlineSmall)
                        Text(
                            text = String.format("%02d:%02d:%02d", hours, minutes, seconds),
                            style = MaterialTheme.typography.displayMedium
                        )
                    }
                }
            }

            AnimatedVisibility(visible = showHistory) {
                Column {
                    Text(text = "Mai munkaidők:", style = MaterialTheme.typography.titleSmall)
                    LazyColumn(modifier = Modifier.heightIn(max = 250.dp)) {
                        items(workTimes) { wt ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                val start = timeSdf.format(Date(wt.startTime))
                                val end = wt.endTime?.let { timeSdf.format(Date(it)) } ?: "..."
                                Text("${wt.type}: $start - $end")
                                Row {
                                    IconButton(onClick = { editingWorkTime = wt }, modifier = Modifier.size(24.dp)) {
                                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                    IconButton(onClick = { viewModel.deleteWorkTime(wt) }, modifier = Modifier.size(24.dp)) {
                                        Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                }
                            }
                        }
                    }
                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                }
            }

            if (editingWorkTime != null) {
                EditWorkTimeDialog(
                    workTime = editingWorkTime!!,
                    onDismiss = { editingWorkTime = null },
                    onConfirm = { updated ->
                        viewModel.updateWorkTime(updated)
                        editingWorkTime = null
                    }
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
            
            Text(
                text = if (currentTour == null) {
                    "❌ DEBUG: Nincs aktív túra (currentTour = null)"
                } else {
                    "✅ DEBUG: Aktív túra: ${currentTour!!.name} (isCurrent = ${currentTour!!.isCurrent})"
                },
                color = if (currentTour == null) Color.Red else Color.Green,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(16.dp)
            )

            Text(text = "Következő cím:", style = MaterialTheme.typography.titleMedium)
            
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (nextStop != null || profileDepot != null) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    if (nextStop != null || profileDepot != null) {
                        if (nextStop != null) {
                            Text(text = nextStop!!.contactName, style = MaterialTheme.typography.titleSmall)
                            Text(text = nextStop!!.address, style = MaterialTheme.typography.bodyLarge)
                        } else {
                            Text(text = "Visszatérés a depóba", style = MaterialTheme.typography.titleSmall)
                            Text(text = profileDepot!!.name, style = MaterialTheme.typography.bodyLarge)
                            Text(text = profileDepot!!.address, style = MaterialTheme.typography.bodySmall)
                        }
                        
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                if (nextStop?.timeWindow?.isNotBlank() == true) {
                                    Text(text = "Időablak: ${nextStop!!.timeWindow}", style = MaterialTheme.typography.labelSmall)
                                }
                                nextStopDistance?.let { (dist, dur) ->
                                    val drivingDone = viewModel.drivingTimeTodaySeconds.collectAsState().value
                                    val adjustedDur = TimeUtils.calculateAdjustedDuration(dur, drivingDone)
                                    val formattedDur = TimeUtils.formatDuration(adjustedDur)
                                    Text(
                                        text = String.format("📍 %s: %.1f km (%s)", if (nextStop != null) "Következő" else "Depó", dist, formattedDur),
                                        style = MaterialTheme.typography.titleMedium,
                                        color = MaterialTheme.colorScheme.primary,
                                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
                                    )
                                }
                                tourRemainingDistance?.let { (dist, dur) ->
                                    val drivingDone = viewModel.drivingTimeTodaySeconds.collectAsState().value
                                    val adjustedDur = TimeUtils.calculateAdjustedDuration(dur, drivingDone)
                                    val formattedDur = TimeUtils.formatDuration(adjustedDur)
                                    Text(
                                        text = String.format("🏁 Túra: %.1f km (%s)", dist, formattedDur),
                                        style = MaterialTheme.typography.titleMedium,
                                        color = MaterialTheme.colorScheme.secondary,
                                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold
                                    )
                                }
                            }
                            if (nextStop != null) {
                                TextButton(onClick = { viewModel.completeStop(nextStop!!.id) }) {
                                    Icon(Icons.Default.Check, contentDescription = null)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Kész")
                                }
                            } else {
                                Icon(Icons.Default.Home, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                    } else {
                        Text(text = "Nincs aktív túra vagy több megálló.", style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Text(
                text = "Napi állapot: $currentStatus", 
                color = if (currentStatus == "Offline") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, 
                style = MaterialTheme.typography.titleLarge
            )
            
            Spacer(modifier = Modifier.height(32.dp))
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatusButton("Pihenő", currentStatus, enabled = currentStatus != "Offline" && currentStatus != "Pihenő") { 
                    viewModel.updateStatus("Pihenő")
                    NotificationUtils.showSimpleNotification(context, "Munkaidő napló", "Pihenőidő elindítva")
                }
                StatusButton("Vezetés", currentStatus, enabled = currentStatus != "Offline" && currentStatus != "Vezetés") { 
                    viewModel.updateStatus("Vezetés")
                    NotificationUtils.showSimpleNotification(context, "Munkaidő napló", "Vezetés megkezdve")
                }
                StatusButton("Rakodás", currentStatus, enabled = currentStatus != "Offline" && currentStatus != "Rakodás") { 
                    viewModel.updateStatus("Rakodás")
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                StatusButton("Munka", currentStatus, enabled = currentStatus == "Offline" || currentStatus != "Munka") { 
                    if (currentStatus == "Offline") {
                        showMileageDialog = "Munka"
                    } else {
                        viewModel.updateStatus("Munka")
                    }
                }
                OutlinedButton(
                    onClick = { showMileageDialog = "Offline" },
                    enabled = currentStatus != "Offline"
                ) { Text("Műszak vége") }
            }

            if (showMileageDialog != null) {
                MileageDialog(
                    initialMileage = lastData?.second ?: 0,
                    initialLicensePlate = lastData?.first ?: "",
                    showLicensePlate = showMileageDialog != "Offline",
                    onDismiss = { showMileageDialog = null },
                    onConfirm = { mileageValue, plate ->
                        val type = showMileageDialog!!
                        viewModel.updateStatus(type, mileageValue, plate)
                        if (type == "Offline") {
                            NotificationUtils.showSimpleNotification(context, "Műszak vége", "A mai nap rögzítve lett. Km: $mileageValue")
                        } else {
                            val msg = when(type) {
                                "Vezetés" -> "Vezetés megkezdve"
                                "Pihenő" -> "Pihenőidő elindítva"
                                else -> "Munkaidő napló elindítva"
                            }
                            NotificationUtils.showSimpleNotification(context, "Műszak kezdése", msg)
                        }
                        showMileageDialog = null
                    }
                )
            }
        }

        if (isAIProcessing) {
            AILoadingAnimation()
        }
    }
}

@Composable
fun CustomerSelectionDialog(
    initialCustomer: String?,
    options: List<String>,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var text by remember { mutableStateOf(if (initialCustomer == "UNCLEAR") "" else (initialCustomer ?: "")) }
    var expanded by remember { mutableStateOf(false) }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Megrendelő pontosítása") },
        text = {
            Column {
                Text("Az AI nem tudta pontosan beazonosítani a megrendelőt. Kérlek add meg vagy válaszd ki!")
                Spacer(modifier = Modifier.height(8.dp))
                
                Box {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        label = { Text("Megrendelő neve") },
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = {
                            IconButton(onClick = { expanded = true }) {
                                Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                            }
                        }
                    )
                    DropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false },
                        modifier = Modifier.fillMaxWidth(0.8f)
                    ) {
                        options.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option) },
                                onClick = {
                                    text = option
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(text) }, enabled = text.isNotBlank()) {
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
fun StatusButton(label: String, currentStatus: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = if (currentStatus == label) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary) else ButtonDefaults.buttonColors()
    ) {
        Text(label)
    }
}

@Composable
fun EditWorkTimeDialog(workTime: WorkTime, onDismiss: () -> Unit, onConfirm: (WorkTime) -> Unit) {
    var selectedType by remember { mutableStateOf(workTime.type) }
    val types = listOf("Munka", "Vezetés", "Pihenő", "Rakodás")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Munkaidő szerkesztése") },
        text = {
            Column {
                types.forEach { type ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = selectedType == type, onClick = { selectedType = type })
                        Text(type)
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
                Text("Az időmódosítás ebben a verzióban még nem elérhető.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(workTime.copy(type = selectedType)) }) {
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
fun DashboardCard(label: String, value: String) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
    ) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = label)
            Text(text = value, style = MaterialTheme.typography.titleMedium)
        }
    }
}
