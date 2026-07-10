package com.example.driverassistant.ui.screen

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.launch
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
import com.example.driverassistant.domain.model.Document
import com.example.driverassistant.ui.viewmodel.AIViewModel
import com.example.driverassistant.ui.viewmodel.DocumentsViewModel
import com.example.driverassistant.util.FileUtils
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun DocumentsScreen(
    viewModel: DocumentsViewModel = hiltViewModel()
) {
    val documents by viewModel.documents.collectAsState()
    val isProcessing by viewModel.isProcessing.collectAsState()
    var showImportDialog by remember { mutableStateOf(false) }
    val context = LocalContext.current
    var selectedUri by remember { mutableStateOf<android.net.Uri?>(null) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        selectedUri = uri
    }

    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { showImportDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "Dokumentum importálása")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.padding(padding)) {
                Text(
                    text = "Dokumentumok",
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.padding(16.dp)
                )

                if (documents.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(text = "Nincsenek dokumentumok", color = Color.Gray)
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                        items(documents) { doc ->
                            DocumentItem(
                                doc = doc,
                                onDelete = { viewModel.deleteDocument(doc) },
                                onUpdate = { updatedDoc -> viewModel.updateDocument(updatedDoc) }
                            )
                        }
                    }
                }
            }

            if (isProcessing) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }

    if (showImportDialog) {
        ImportDialog(
            onDismiss = { 
                showImportDialog = false
                selectedUri = null
            },
            onImport = { name, type ->
                val uri = selectedUri
                if (uri != null) {
                    val path = FileUtils.saveUri(context, uri, "documents")
                    if (path != null) {
                        viewModel.addDocument(name, type, path, path.split(".").last().uppercase())
                        Toast.makeText(context, "Mentve: $path", Toast.LENGTH_LONG).show()
                    }
                } else {
                    viewModel.addDocument(name, type, "manual_entry", "PDF")
                }
                showImportDialog = false
                selectedUri = null
            },
            onPickFile = { filePickerLauncher.launch("*/*") },
            selectedFileName = selectedUri?.path?.split("/")?.lastOrNull()
        )
    }
}

@Composable
fun DocumentItem(
    doc: Document,
    onDelete: () -> Unit,
    onUpdate: (Document) -> Unit
) {
    val sdf = SimpleDateFormat("yyyy.MM.dd HH:mm", Locale.getDefault())
    var showEditDialog by remember { mutableStateOf(false) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (doc.fileExtension == "PDF") Icons.Default.PictureAsPdf else Icons.Default.Description,
                contentDescription = null,
                tint = if (doc.fileExtension == "PDF") Color.Red else Color.Blue,
                modifier = Modifier.size(40.dp)
            )
            Spacer(modifier = Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = doc.name, style = MaterialTheme.typography.titleMedium)
                Text(text = "${doc.type} • ${sdf.format(Date(doc.timestamp))}", style = MaterialTheme.typography.bodySmall)
                if (doc.filePath != "manual_entry") {
                    Text(text = "Elérési út: ${doc.filePath.takeLast(30)}...", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
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
    }

    if (showEditDialog) {
        EditDocumentDialog(
            doc = doc,
            onDismiss = { showEditDialog = false },
            onConfirm = { updatedDoc ->
                onUpdate(updatedDoc)
                showEditDialog = false
            }
        )
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text("Dokumentum törlése") },
            text = { Text("Biztosan törölni szeretnéd a(z) \"${doc.name}\" dokumentumot?") },
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
fun EditDocumentDialog(doc: Document, onDismiss: () -> Unit, onConfirm: (Document) -> Unit) {
    var name by remember { mutableStateOf(doc.name) }
    var selectedType by remember { mutableStateOf(doc.type) }
    val categories = listOf("CMR", "POD", "Fuvarlevél", "Hotel", "Egyéb")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Dokumentum szerkesztése") },
        text = {
            Column {
                TextField(value = name, onValueChange = { name = it }, label = { Text("Dokumentum neve") })
                Spacer(modifier = Modifier.height(16.dp))
                Text("Kategória:", style = MaterialTheme.typography.labelMedium)
                categories.forEach { type ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = selectedType == type, onClick = { selectedType = type })
                        Text(type)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { if (name.isNotEmpty()) onConfirm(doc.copy(name = name, type = selectedType)) }) {
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
fun ImportDialog(
    onDismiss: () -> Unit,
    onImport: (String, String) -> Unit,
    onPickFile: () -> Unit,
    selectedFileName: String?
) {
    var name by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf("CMR") }
    val categories = listOf("CMR", "POD", "Fuvarlevél", "Hotel", "Egyéb")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Dokumentum importálása") },
        text = {
            Column {
                TextField(value = name, onValueChange = { name = it }, label = { Text("Dokumentum neve") })
                Spacer(modifier = Modifier.height(8.dp))
                
                Button(onClick = onPickFile, modifier = Modifier.fillMaxWidth()) {
                    Text(selectedFileName ?: "Fájl kiválasztása (PDF/Kép)")
                }
                
                Spacer(modifier = Modifier.height(8.dp))
                Text("Kategória:", style = MaterialTheme.typography.labelMedium)
                categories.forEach { type ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = selectedType == type, onClick = { selectedType = type })
                        Text(type)
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { if (name.isNotEmpty()) onImport(name, selectedType) }) {
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
