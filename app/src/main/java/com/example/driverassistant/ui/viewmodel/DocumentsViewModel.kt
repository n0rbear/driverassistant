package com.example.driverassistant.ui.viewmodel

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.MistralApi
import com.example.driverassistant.data.api.MistralMessage
import com.example.driverassistant.data.api.MistralRequest
import com.example.driverassistant.domain.model.Document
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.util.OCRUtils
import com.example.driverassistant.util.AiAuth
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DocumentsViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val mistralApi: MistralApi,
    @ApplicationContext private val appContext: Context
) : ViewModel() {

    private val prefs = appContext.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"

    private val _isProcessing = MutableStateFlow(false)
    val isProcessing = _isProcessing.asStateFlow()

    val documents = repository.getAllDocuments(driverName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun addDocument(name: String, type: String, filePath: String, extension: String) {
        viewModelScope.launch {
            repository.insertDocument(
                Document(
                    driverName = driverName,
                    name = name,
                    type = type,
                    filePath = filePath,
                    fileExtension = extension,
                    timestamp = System.currentTimeMillis()
                )
            )
            if (type.equals("Hotel", ignoreCase = true)) {
                repository.insertHotel(Hotel(
                    driverName = driverName,
                    name = name,
                    address = "Dokumentumból csatolva",
                    roomNumber = "",
                    entryCode = "",
                    phoneNumber = "",
                    email = "",
                    timestamp = System.currentTimeMillis()
                ))
            }
        }
    }

    fun deleteDocument(document: Document) {
        viewModelScope.launch {
            repository.deleteDocument(document)
        }
    }

    fun updateDocument(document: Document) {
        viewModelScope.launch {
            repository.updateDocument(document)
        }
    }

    fun processDocumentWithAI(context: Context, uri: Uri, onResult: (String, String) -> Unit) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                // 1. OCR - Szöveg kinyerése
                val extractedText = OCRUtils.extractTextFromUri(context, uri)
                
                // 2. Mistral AI - Adatok elemzése
                val prompt = """
                    Elemezd az alábbi fuvarozási dokumentumból kinyert szöveget:
                    $extractedText
                    
                    Kérlek add meg a következő adatokat JSON formátumban:
                    - name: A dokumentum rövid, beszédes neve (pl. "CMR - Budapest-Prága")
                    - type: A dokumentum típusa. Csak ezeket választhatod: CMR, POD, Fuvarlevél, Hotel, Egyéb
                    - address: Cím (ha a dokumentum tartalmazza, pl. Hotel címe vagy felrakó címe)
                    
                    FONTOS: Címeknél soha ne írd, hogy "AI által kinyert", csak a valós címet! Ha nem találod, hagyd üresen.
                    Csak a JSON-t küldd vissza!
                """.trimIndent()

                val response = mistralApi.chat(
                    authHeader = AiAuth.mistralHeader(),
                    request = MistralRequest(
                        messages = listOf(MistralMessage("user", prompt))
                    )
                )

                val aiText = response.choices.firstOrNull()?.message?.content ?: ""
                val cleanJson = aiText.removeSurrounding("```json", "```").trim()

                val name = extractField(cleanJson, "name")
                val type = extractField(cleanJson, "type")
                val address = extractField(cleanJson, "address")
                
                onResult(name.ifBlank { "AI Feldolgozott" }, type.ifBlank { "Egyéb" })
                
                // Ha Hotel, mentsük el az adatbázisba is a címmel együtt
                if (type.contains("Hotel", ignoreCase = true)) {
                    repository.insertHotel(Hotel(
                        driverName = driverName,
                        name = name.ifBlank { "Szállás" },
                        address = address.ifBlank { "Cím nem található" },
                        roomNumber = "",
                        entryCode = "",
                        phoneNumber = "",
                        email = "",
                        timestamp = System.currentTimeMillis()
                    ))
                }
            } catch (e: Exception) {
                onResult("Hiba a feldolgozásban", "Hiba")
            } finally {
                _isProcessing.value = false
            }
        }
    }

    private fun extractField(text: String, field: String): String {
        val regex = "\"$field\"\\s*:\\s*\"([^\"]*)\"".toRegex()
        return regex.find(text)?.groupValues?.get(1) ?: ""
    }
}
