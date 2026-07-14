package com.example.driverassistant.ui.viewmodel

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.MistralApi
import com.example.driverassistant.data.api.MistralMessage
import com.example.driverassistant.data.api.MistralRequest
import com.example.driverassistant.domain.model.Cost
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.util.OCRUtils
import com.example.driverassistant.util.AiAuth
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CostsViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val mistralApi: MistralApi,
    private val backendApi: BackendApi,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val gson = Gson()
    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen") ?: "Ismeretlen"

    private val _isProcessing = MutableStateFlow(false)
    val isProcessing = _isProcessing.asStateFlow()

    val costs = repository.getAllCosts(driverName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        fetchStatusUpdates()
    }

    private fun fetchStatusUpdates() {
        viewModelScope.launch {
            while(true) {
                try {
                    android.util.Log.d("SyncDebug", "CostsViewModel: Fetching cost status updates for $driverName")
                    val updates = backendApi.getCostStatus(driverName)
                    android.util.Log.d("SyncDebug", "CostsViewModel: Received ${updates.size} updates: ${gson.toJson(updates)}")
                    
                    updates.forEach { update ->
                        // Helyi azonosítás UUID alapján, vagy régi adatoknál timestamp és összeg alapján
                        costs.value.find { (update.uuid != null && it.uuid == update.uuid) || (it.timestamp == update.timestamp && it.amount == update.amount) }?.let { local ->
                            if (local.status != update.status) {
                                android.util.Log.d("SyncDebug", "CostsViewModel: Updating local cost status for ${local.uuid ?: local.id} to ${update.status}")
                                repository.updateCost(local.copy(status = update.status))
                            }
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("SyncDebug", "CostsViewModel: Failed to fetch cost status updates", e)
                }
                kotlinx.coroutines.delay(60000) 
            }
        }
    }

    fun addCost(amount: Double, currency: String, category: String, notes: String, photoPath: String? = null, mileage: Int? = null) {
        viewModelScope.launch {
            val cost = Cost(
                driverName = driverName,
                amount = amount,
                currency = currency,
                category = category,
                notes = notes,
                photoPath = photoPath,
                timestamp = System.currentTimeMillis(),
                mileage = mileage
            )
            repository.insertCost(cost)
            syncCostsWithBackend()
        }
    }

    private fun syncCostsWithBackend() {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                android.util.Log.d("SyncDebug", "CostsViewModel: START syncCostsWithBackend")
                
                // 1. PULL remote costs
                val remoteCosts = backendApi.getCosts(driverName)
                repository.syncRemoteCosts(driverName, remoteCosts)

                // 2. PUSH local costs
                val allCosts = repository.getAllCosts(driverName).first()
                android.util.Log.d("SyncDebug", "CostsViewModel: PUSH Payload")
                backendApi.syncCosts(allCosts)
                
                android.util.Log.d("SyncDebug", "CostsViewModel: syncCostsWithBackend COMPLETED")
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "CostsViewModel: Failed to sync costs with backend", e)
            } finally {
                _isProcessing.value = false
            }
        }
    }

    fun deleteCost(cost: Cost) {
        viewModelScope.launch {
            repository.deleteCost(cost)
            syncCostsWithBackend()
        }
    }

    fun updateCost(cost: Cost) {
        viewModelScope.launch {
            repository.updateCost(cost)
            syncCostsWithBackend()
        }
    }

    fun processReceiptsWithAI(context: Context, uris: List<Uri>, onPreview: (List<Cost>) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                val fullText = StringBuilder()
                uris.forEachIndexed { index, uri ->
                    val text = OCRUtils.extractTextFromUri(context, uri)
                    fullText.append("--- Page ${index + 1} ---\n")
                    fullText.append(text).append("\n\n")
                }

                val prompt = """
                    You are an expert receipt parser. Analyze the following text extracted from one or more pages of a receipt/invoice.
                    The goal is to record all expenses in EUR.
                    
                    Extracted text from all pages:
                    $fullText
                    
                    Rules:
                    1. Identify each expense item on the document(s).
                    2. For each item, if it's in a currency other than EUR (like HUF, RON, CZK, etc.), convert the amount to EUR using a current approximate exchange rate.
                    3. The "amount" in your JSON must ALWAYS be the EUR value.
                    4. The "currency" in your JSON must ALWAYS be "EUR".
                    5. In "notes", mention the original amount and currency (e.g., "Original: 5000 HUF").
                    6. Categorize each item into: Hotel, Parkolás, Matrica, Útdíj, Tankolás, Szerviz, Adblue, Mosás, Egyéb.
                    7. Respond ONLY with a valid JSON object.
                    
                    Format:
                    {
                      "items": [
                        {
                          "amount": 12.34,
                          "currency": "EUR",
                          "category": "Tankolás",
                          "notes": "OMV diesel (Original: 5000 HUF)"
                        }
                      ]
                    }
                """.trimIndent()

                val response = mistralApi.chat(
                    authHeader = AiAuth.mistralHeader(),
                    request = MistralRequest(
                        model = "mistral-small-latest",
                        messages = listOf(MistralMessage("user", prompt))
                    )
                )

                val aiText = response.choices.firstOrNull()?.message?.content ?: ""
                val jsonStart = aiText.indexOf("{")
                val jsonEnd = aiText.lastIndexOf("}")
                
                if (jsonStart != -1 && jsonEnd != -1) {
                    val cleanJson = aiText.substring(jsonStart, jsonEnd + 1)
                    val itemRegex = "\\{[^}]*amount[^}]*\\}".toRegex()
                    val itemMatches = itemRegex.findAll(cleanJson)
                    
                    val detectedCosts = mutableListOf<Cost>()
                    itemMatches.forEach { match ->
                        val block = match.value
                        val amountStr = "\"amount\"\\s*:\\s*([0-9.]+)".toRegex().find(block)?.groupValues?.get(1)
                        val amount = amountStr?.toDoubleOrNull() ?: 0.0
                        val currency = extractField(block, "currency")
                        val category = extractField(block, "category")
                        val notes = extractField(block, "notes")

                        if (amount > 0) {
                            detectedCosts.add(Cost(
                                driverName = driverName,
                                amount = amount,
                                currency = currency.ifBlank { "EUR" },
                                category = category.ifBlank { "Egyéb" },
                                notes = notes,
                                photoPath = uris.firstOrNull()?.toString(), // Use the first page as reference
                                timestamp = System.currentTimeMillis()
                            ))
                        }
                    }
                    
                    if (detectedCosts.isNotEmpty()) {
                        onPreview(detectedCosts)
                    } else {
                        onError("Nem sikerült tételeket azonosítani a dokumentumon.")
                    }
                } else {
                    onError("Az AI válasza nem tartalmaz feldolgozható adatot.")
                }
            } catch (e: Exception) {
                onError("Hiba a feldolgozás során: ${e.message}")
            } finally {
                _isProcessing.value = false
            }
        }
    }

    fun saveMultipleCosts(costs: List<Cost>) {
        viewModelScope.launch {
            costs.forEach { repository.insertCost(it.copy(driverName = driverName)) }
        }
    }

    private fun extractField(text: String, field: String): String {
        val regex = "\"$field\"\\s*:\\s*\"([^\"]*)\"".toRegex()
        return regex.find(text)?.groupValues?.get(1) ?: ""
    }
}
