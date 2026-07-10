package com.example.driverassistant.ui.screen

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import coil.compose.rememberAsyncImagePainter
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.ui.viewmodel.ProfileViewModel
import kotlinx.coroutines.flow.collectLatest

@Composable
fun ProfileScreen(viewModel: ProfileViewModel = hiltViewModel()) {
    val savedLocations by viewModel.savedLocations.collectAsState()
    val driverName by viewModel.driverName.collectAsState()
    val driverPhone by viewModel.driverPhone.collectAsState()
    val driverEmail by viewModel.driverEmail.collectAsState()
    val driverWhatsapp by viewModel.driverWhatsapp.collectAsState()
    val driverTelegram by viewModel.driverTelegram.collectAsState()
    val defaultPlate by viewModel.defaultPlate.collectAsState()
    val driverPhoto by viewModel.driverPhoto.collectAsState()
    val isLinked by viewModel.isLinked.collectAsState()
    
    val context = LocalContext.current
    val activity = context as? android.app.Activity
    var showEditDialog by remember { mutableStateOf(false) }
    var showLinkDialog by remember { mutableStateOf(false) }
    var pendingPhotoUri by remember { mutableStateOf<Uri?>(null) }

    LaunchedEffect(Unit) {
        viewModel.refreshProfileFromServer()
        viewModel.events.collectLatest { message ->
            if (message == "LOGOUT_SUCCESS") {
                activity?.finish()
            } else {
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            }
        }
    }
    
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Surface(
                modifier = Modifier
                    .size(120.dp)
                    .clip(CircleShape),
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(80.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Text(text = driverName, style = MaterialTheme.typography.headlineMedium)
            
            Spacer(modifier = Modifier.height(16.dp))
            
            if (driverPhoto != null) {
                // Prepend base URL if it's a relative path from server
                val displayPhoto = if (driverPhoto!!.startsWith("/")) {
                    "https://driverassistant.onrender.com$driverPhoto"
                } else driverPhoto

                androidx.compose.foundation.Image(
                    painter = rememberAsyncImagePainter(displayPhoto),
                    contentDescription = null,
                    modifier = Modifier.size(100.dp).clip(CircleShape),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop
                )
            }
            
            ProfileInfoRow("Telefonszám", driverPhone.ifBlank { "Nincs megadva" })
            ProfileInfoRow("Email", driverEmail.ifBlank { "Nincs megadva" })
            ProfileInfoRow("WhatsApp", driverWhatsapp.ifBlank { "Nincs megadva" })
            ProfileInfoRow("Telegram", driverTelegram.ifBlank { "Nincs megadva" })
            ProfileInfoRow("Alapértelmezett Rendszám", defaultPlate.ifBlank { "Nincs megadva" })
            ProfileInfoRow("Web társítás", if (isLinked) "Aktív" else "Nincs társítva")
            
            Spacer(modifier = Modifier.height(16.dp))
            
            if (!isLinked) {
                OutlinedButton(onClick = { showLinkDialog = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Link, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Telefon társítása webes profillal")
                }
                Spacer(modifier = Modifier.height(8.dp))
            }

            Button(onClick = { showEditDialog = true }) {
                Text("Profil szerkesztése")
            }
            
            Spacer(modifier = Modifier.height(32.dp))
            
            Text(text = "Mentett helyszínek (GPS logikához)", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { 
                        viewModel.saveCurrentPositionAs("HOME")
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Home, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Otthonom ide")
                }
                Button(
                    onClick = { 
                        viewModel.saveCurrentPositionAs("BASE")
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.LocationOn, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Bázisom ide")
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
        }

        items(savedLocations) { loc ->
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (loc.type == "HOME") Icons.Default.Home else Icons.Default.LocationOn,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(16.dp))
                    Column {
                        Text(text = loc.name, style = MaterialTheme.typography.titleSmall)
                        Text(text = loc.address, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(32.dp))
            
            Button(
                onClick = { viewModel.signOut() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) {
                Text("Kilépés az alkalmazásból")
            }
        }
    }

    if (showEditDialog) {
        val photoPickerLauncher = rememberLauncherForActivityResult(
            contract = ActivityResultContracts.GetContent()
        ) { uri ->
            if (uri != null) {
                pendingPhotoUri = uri
            }
        }

        EditProfileDialog(
            currentName = driverName,
            currentPhone = driverPhone,
            currentEmail = driverEmail,
            currentWhatsapp = driverWhatsapp,
            currentTelegram = driverTelegram,
            currentPlate = defaultPlate,
            onDismiss = { showEditDialog = false },
            onSave = { name, phone, email, whatsapp, telegram, plate ->
                viewModel.updateProfile(name, phone, email, whatsapp, telegram, plate)
                showEditDialog = false
            },
            onPickPhoto = { photoPickerLauncher.launch("image/*") }
        )
    }

    if (showLinkDialog) {
        LinkDeviceDialog(
            onDismiss = { showLinkDialog = false },
            onConfirm = { code ->
                viewModel.linkWithActivationCode(code)
                showLinkDialog = false
            }
        )
    }

    pendingPhotoUri?.let { uri ->
        PhotoCropDialog(
            uri = uri,
            onDismiss = { pendingPhotoUri = null },
            onUpload = { offsetX, offsetY, zoom ->
                viewModel.uploadPhoto(uri, offsetX, offsetY, zoom)
                pendingPhotoUri = null
            }
        )
    }
}

@Composable
fun LinkDeviceDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var code by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Telefon társítása") },
        text = {
            Column {
                Text("Írd be a weben látható aktiváló kódot.")
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase() },
                    label = { Text("Aktiváló kód") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(code) }, enabled = code.isNotBlank()) {
                Text("Társítás")
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
fun EditProfileDialog(
    currentName: String,
    currentPhone: String,
    currentEmail: String,
    currentWhatsapp: String,
    currentTelegram: String,
    currentPlate: String,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String, String, String) -> Unit,
    onPickPhoto: () -> Unit
) {
    var name by remember { mutableStateOf(currentName) }
    var phone by remember { mutableStateOf(currentPhone) }
    var email by remember { mutableStateOf(currentEmail) }
    var whatsapp by remember { mutableStateOf(currentWhatsapp) }
    var telegram by remember { mutableStateOf(currentTelegram) }
    var plate by remember { mutableStateOf(currentPlate) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Profil szerkesztése") },
        text = {
            androidx.compose.foundation.lazy.LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Button(onClick = onPickPhoto, modifier = Modifier.fillMaxWidth()) {
                        Text("Profilkép feltöltése (Web-re is)")
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Név") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Telefonszám") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = whatsapp, onValueChange = { whatsapp = it }, label = { Text("WhatsApp") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = telegram, onValueChange = { telegram = it }, label = { Text("Telegram") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = plate, onValueChange = { plate = it.uppercase() }, label = { Text("Alapértelmezett rendszám") }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(name, phone, email, whatsapp, telegram, plate) }) {
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
fun PhotoCropDialog(
    uri: Uri,
    onDismiss: () -> Unit,
    onUpload: (Float, Float, Float) -> Unit
) {
    var offsetX by remember(uri) { mutableFloatStateOf(0f) }
    var offsetY by remember(uri) { mutableFloatStateOf(0f) }
    var zoom by remember(uri) { mutableFloatStateOf(1.15f) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Profilkép beállítása") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(
                    modifier = Modifier
                        .size(260.dp)
                        .clip(CircleShape),
                    color = Color.Black
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .pointerInput(uri, zoom) {
                                detectDragGestures { change, dragAmount ->
                                    change.consume()
                                    offsetX = (offsetX + dragAmount.x).coerceIn(-180f, 180f)
                                    offsetY = (offsetY + dragAmount.y).coerceIn(-180f, 180f)
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            painter = rememberAsyncImagePainter(uri),
                            contentDescription = null,
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    scaleX = zoom
                                    scaleY = zoom
                                    translationX = offsetX
                                    translationY = offsetY
                                },
                            contentScale = androidx.compose.ui.layout.ContentScale.Crop
                        )
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
                Text("Nagyítás")
                Slider(
                    value = zoom,
                    onValueChange = { zoom = it },
                    valueRange = 1f..3f
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onUpload(
                        (offsetX / 180f).coerceIn(-1f, 1f),
                        (offsetY / 180f).coerceIn(-1f, 1f),
                        zoom
                    )
                }
            ) {
                Text("Feltöltés")
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
fun ProfileInfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, style = MaterialTheme.typography.labelLarge)
        Text(text = value, style = MaterialTheme.typography.bodyLarge)
    }
}
