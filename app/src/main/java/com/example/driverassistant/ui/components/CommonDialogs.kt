package com.example.driverassistant.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
fun MileageDialog(
    initialMileage: Int = 0,
    showLicensePlate: Boolean = false,
    initialLicensePlate: String = "",
    onDismiss: () -> Unit,
    onConfirm: (Int, String?) -> Unit
) {
    var mileage by remember(initialMileage) { mutableStateOf(if (initialMileage > 0) initialMileage.toString() else "") }
    var licensePlate by remember(initialLicensePlate) { mutableStateOf(initialLicensePlate) }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (showLicensePlate) "Műszak kezdése" else "Kilométeróra állása") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (showLicensePlate) {
                    OutlinedTextField(
                        value = licensePlate,
                        onValueChange = { licensePlate = it.uppercase() },
                        label = { Text("Rendszám") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                OutlinedTextField(
                    value = mileage,
                    onValueChange = { if (it.all { char -> char.isDigit() }) mileage = it },
                    label = { Text("Aktuális km állás") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(onClick = { 
                mileage.toIntOrNull()?.let { onConfirm(it, if (showLicensePlate) licensePlate else null) } 
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
