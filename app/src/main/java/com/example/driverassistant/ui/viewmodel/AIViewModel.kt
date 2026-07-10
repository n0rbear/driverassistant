package com.example.driverassistant.ui.viewmodel

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.*
import com.example.driverassistant.domain.model.*
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.util.OCRUtils
import com.example.driverassistant.util.AiAuth
import android.location.Geocoder
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

@HiltViewModel
class AIViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val mistralApi: MistralApi,
    private val backendApi: BackendApi,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context
) : ViewModel() {

    private val gson = Gson()
    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)

    private val _isProcessing = MutableStateFlow(false)
    val isProcessing = _isProcessing.asStateFlow()

    private val _pendingTour = MutableStateFlow<AIResponse?>(null)
    val pendingTour = _pendingTour.asStateFlow()

    private val _existingCustomers = MutableStateFlow<List<String>>(emptyList())
    val existingCustomers = _existingCustomers.asStateFlow()

    init {
        viewModelScope.launch {
            val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
            repository.getAllTours(driverName).collect { tours ->
                _existingCustomers.value = tours.map { it.customer }.distinct().filter { it.isNotBlank() }
            }
        }
    }

    fun clearPendingTour() {
        _pendingTour.value = null
    }

    fun confirmTour(customerName: String) {
        val tour = _pendingTour.value ?: return
        viewModelScope.launch {
            saveTour(tour.copy(customer = customerName))
            _pendingTour.value = null
            syncToursWithBackend()
        }
    }

    private fun syncToursWithBackend() {
        viewModelScope.launch {
            try {
                android.util.Log.d("SyncDebug", "--- START SYNC (AIViewModel) ---")
                val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
                
                // 1. PUSH
                val tours = repository.getAllToursWithDeleted(driverName)
                val toursWithStops = tours.map { t ->
                    TourWithStops(t, repository.getStopsForTourWithDeleted(t.id))
                }
                
                android.util.Log.d("SyncDebug", "PUSH Payload: ${gson.toJson(toursWithStops)}")
                backendApi.syncTours(driverName, toursWithStops)

                // 2. PULL
                android.util.Log.d("SyncDebug", "PULL Request for driver: $driverName")
                val remoteTours = backendApi.getTours(driverName)
                
                android.util.Log.d("SyncDebug", "PULL Response JSON: ${gson.toJson(remoteTours)}")
                repository.syncRemoteTours(driverName, remoteTours)
                
                android.util.Log.d("SyncDebug", "--- SYNC COMPLETED SUCCESSFULLY (AI) ---")
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "--- SYNC FAILED (AI) ---", e)
            }
        }
    }

    fun processAnyDocument(context: Context, uris: List<Uri>, onComplete: (String) -> Unit) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                val fullText = StringBuilder()
                uris.forEachIndexed { index, uri ->
                    val text = OCRUtils.extractTextFromUri(context, uri)
                    fullText.append("--- Page ${index + 1} ---\n")
                    fullText.append(text).append("\n\n")
                }
                
                val dispatchPrompt = """
                    You are a professional assistant for truck drivers. Analyze the provided pseudo-HTML text and extract data.
                    
                    STEP 1: Identify the category of the document:
                    - RECEIPT: Gas station receipt (tankolási blokk), shop receipt, toll (útdíj/matrica), invoice.
                    - ROLLKARTE: Tour plan, delivery list, "fuvarlevél" with multiple stops.
                    - DOCUMENT: CMR, POD, Permit, or Hotel Booking/Confirmation.
                    
                    STEP 2: Extract data based on the category:
                    
                    For RECEIPT:
                    - Extract all individual items (e.g., Diesel, AdBlue, Matrica, Coffee).
                    - CRITICAL: Distinguish between Quantity (liters/pcs) and PRICE. The price is usually at the END of the line or labeled as 'Total', 'Bruttó', 'Fizetendő'.
                    - CURRENCY: Use the ACTUAL currency found on the bill (HUF, EUR, etc.). NEVER convert currencies 1:1. 1000 HUF is NOT 1000 EUR.
                    - 'items': [ { 'description', 'amount', 'currency', 'itemCategory', 'date' } ]
                    - itemCategory: "Tankolás", "Útdíj", "Parkolás", "Hotel", "Egyéb".
                    
                    For ROLLKARTE:
                    - Identify the 'customer' (who issued the document).
                    - Extract 'stops' from ALL pages (Page 1, Page 2, Page 3...).
                    - STOP FIELDS:
                        * 'address': MANDATORY FULL ADDRESS. You MUST extract all components: 
                          1. ZIP CODE (Irányítószám)
                          2. CITY (Város)
                          3. STREET NAME (Utca)
                          4. HOUSE NUMBER (Házszám)
                          Example of desired output: "1234 Budapest, Fő utca 12."
                          CRITICAL: If the street or house number is on a separate line or nearby, you MUST join them into a single string. NEVER output only the city.
                        * 'potentialNames': MANDATORY: List ALL names (Company or Person) found within the block BEFORE or NEAR the address.
                        * 'contactName': Pick the name physically CLOSEST to the address as default.
                        * 'phoneNumber': Look for phone numbers in the SAME block. Look for 'Avis', 'Tel', 'Phone' or patterns like +49, 00..., 06...
                        * 'timeWindow': Time/Day info.
                        * 'notes': Any other relevant info.
                    
                    For DOCUMENT:
                    - If it's a HOTEL booking or confirmation:
                        * Set 'category' to "DOCUMENT".
                        * Set 'docType' to "Hotel".
                        * Extract 'docName' (Hotel name) and 'address' (Hotel address).
                    
                    STRICT RULES:
                    - NO HALLUCINATION.
                    - For 'Diesel' or 'Benzin', 'amount' is the TOTAL PRICE paid, not the number of liters.
                    - For 'Matrica' (Toll), specify the type (e.g., 'Heti matrica') in 'description'.
                    
                    INPUT STRUCTURE:
                    $fullText
                    
                    Respond ONLY with a clean JSON object:
                    {
                      "category": "ROLLKARTE" | "RECEIPT" | "DOCUMENT",
                      "tourName": "...",
                      "customer": "...",
                      "date": "YYYY-MM-DD",
                      "stops": [ 
                        { "address", "contactName", "potentialNames": ["Name1", "Name2"], "phoneNumber", "timeWindow", "notes" }
                      ],
                      "items": [ ... only for RECEIPT ... ]
                    }
                """.trimIndent()

                val response = mistralApi.chat(
                    authHeader = AiAuth.mistralHeader(),
                    request = MistralRequest(
                        model = "mistral-small-latest", // Switching back to small for more literal extraction
                        messages = listOf(MistralMessage("user", dispatchPrompt))
                    )
                )

                val aiText = response.choices.firstOrNull()?.message?.content ?: ""
                val jsonStart = aiText.indexOf("{")
                val jsonEnd = aiText.lastIndexOf("}")
                
                if (jsonStart != -1 && jsonEnd != -1) {
                    val cleanJson = aiText.substring(jsonStart, jsonEnd + 1)
                    val result = gson.fromJson(cleanJson, AIResponse::class.java)
                    
                    when (result.category) {
                        "ROLLKARTE" -> {
                            if (result.customer == "UNCLEAR" || result.customer.isNullOrBlank()) {
                                _pendingTour.value = result
                                onComplete("Megrendelő nem egyértelmű (${result.stops?.size ?: 0} megálló beolvasva). Kérlek válaszd ki!")
                            } else {
                                saveTour(result)
                                syncToursWithBackend()
                                onComplete("Túra rögzítve: ${result.stops?.size ?: 0} megálló összesen.")
                            }
                        }
                        "RECEIPT" -> {
                            saveCosts(result, uris.firstOrNull()?.toString() ?: "")
                            syncCostsWithBackend()
                            onComplete("${result.items?.size ?: 0} költségtétel rögzítve!")
                        }
                        else -> {
                            saveDocument(result, uris.firstOrNull()?.toString() ?: "")
                            syncHotelsWithBackend()
                            onComplete("Dokumentum mentve!")
                        }
                    }
                } else {
                    onComplete("Nem sikerült értelmezni a dokumentumot.")
                }
            } catch (e: Exception) {
                onComplete("Hiba a feldolgozás során: ${e.message}")
            } finally {
                _isProcessing.value = false
            }
        }
    }

    private fun syncCostsWithBackend() {
        viewModelScope.launch {
            try {
                val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
                backendApi.syncCosts(repository.getAllCosts(driverName).first())
            } catch (e: Exception) {
                android.util.Log.e("SyncError", "Failed to sync costs from AI processing", e)
            }
        }
    }

    private fun syncHotelsWithBackend() {
        viewModelScope.launch {
            try {
                val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
                backendApi.syncHotels(repository.getAllHotels(driverName).first())
            } catch (e: Exception) {
                android.util.Log.e("SyncError", "Failed to sync hotels from AI processing", e)
            }
        }
    }

    private suspend fun saveTour(data: AIResponse) {
        val tourDate = parseDate(data.date)
        val customerName = if (data.customer == "UNCLEAR") "" else (data.customer ?: "")
        val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
        
        val mapping = if (customerName.isNotBlank()) {
            repository.getMappingForCustomer(customerName)
        } else null

        val tourId = repository.insertTour(Tour(
            driverName = driverName,
            name = data.tourName ?: "Importált Túra",
            customer = customerName,
            date = tourDate,
            dayOfWeek = data.dayOfWeek,
            notes = "AI Rollkarte"
        ))
        
        data.stops?.forEachIndexed { index, stop ->
            if (stop.address.isNotBlank()) {
                val finalContactName = if (mapping != null && stop.potentialNames != null && mapping.nameIndexToPick < stop.potentialNames.size) {
                    stop.potentialNames[mapping.nameIndexToPick]
                } else {
                    stop.contactName ?: ""
                }

                // Cím koordinátákká alakítása (Geocoding) - Háttérszálon
                val coords = withContext(kotlinx.coroutines.Dispatchers.IO) {
                    try {
                        val geocoder = android.location.Geocoder(context, java.util.Locale.getDefault())
                        @Suppress("DEPRECATION")
                        val addresses = geocoder.getFromLocationName(stop.address, 1)
                        addresses?.firstOrNull()?.let { it.latitude to it.longitude }
                    } catch (e: Exception) { null }
                }

                repository.insertStop(Stop(
                    tourId = tourId,
                    address = stop.address,
                    contactName = finalContactName,
                    phoneNumber = stop.phoneNumber ?: "",
                    email = "",
                    timeWindow = stop.timeWindow ?: "",
                    notes = stop.notes ?: "",
                    alternativeNames = stop.potentialNames?.let { gson.toJson(it) },
                    orderIndex = index,
                    latitude = coords?.first,
                    longitude = coords?.second
                ))
            }
        }
    }

    private suspend fun saveCosts(data: AIResponse, path: String) {
        val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
        data.items?.forEach { item ->
            val itemDate = if (item.date != null) parseDate(item.date) else System.currentTimeMillis()
            repository.insertCost(Cost(
                driverName = driverName,
                amount = item.amount,
                currency = item.currency ?: "EUR",
                category = item.itemCategory ?: "Egyéb",
                notes = item.description ?: "",
                photoPath = path,
                timestamp = itemDate,
                mileage = item.mileage
            ))
            
            // Ha tankolás, keressük meg a kapcsolódó pihenőidőt és javítsuk ki
            if (item.itemCategory == "Tankolás") {
                val dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(itemDate))
                val workTimes = repository.getWorkTimesByDate(dateStr, driverName).first()
                // Keressük azt a pihenőt, ami alatt a tankolás történt (vagy 15 percen belül van)
                workTimes.find { it.type == "Pihenő" && itemDate >= it.startTime && (it.endTime == null || itemDate <= it.endTime) }?.let { rest ->
                    val currentItemMileage = item.mileage
                    repository.updateWorkTime(rest.copy(
                        type = "Munka", 
                        notes = "Tankolás rögzítve: ${item.amount} ${item.currency}",
                        mileage = currentItemMileage
                    ))
                }
            }
        }
    }

    private suspend fun saveDocument(data: AIResponse, path: String) {
        val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
        val docDate = if (data.date != null) parseDate(data.date) else System.currentTimeMillis()
        repository.insertDocument(Document(
            driverName = driverName,
            name = data.docName ?: "Dokumentum",
            type = data.docType ?: "Egyéb",
            filePath = path,
            fileExtension = "AI",
            timestamp = docDate
        ))
        
        if (data.docType?.contains("Hotel", true) == true || data.docName?.contains("Hotel", true) == true) {
            repository.insertHotel(Hotel(
                driverName = driverName,
                name = data.docName ?: "Szállás",
                address = data.address ?: "Cím nem található",
                roomNumber = "",
                entryCode = "",
                phoneNumber = "",
                email = "",
                timestamp = docDate
            ))
        }
    }

    private fun parseDate(dateStr: String?): Long {
        if (dateStr == null) return System.currentTimeMillis()
        return try {
            val formats = listOf("yyyy-MM-dd", "yyyy.MM.dd", "dd.MM.yyyy")
            var time: Long? = null
            for (format in formats) {
                try {
                    time = SimpleDateFormat(format, Locale.getDefault()).parse(dateStr)?.time
                    if (time != null) break
                } catch (e: Exception) {
                    android.util.Log.w("AIViewModel", "Failed to parse date $dateStr with format $format")
                }
            }
            time ?: System.currentTimeMillis()
        } catch (e: Exception) {
            System.currentTimeMillis()
        }
    }
}

data class AIResponse(
    val category: String,
    val tourName: String? = null,
    val customer: String? = null,
    val date: String? = null,
    val dayOfWeek: String? = null,
    val stops: List<AIStop>? = null,
    val items: List<AICostItem>? = null,
    val docName: String? = null,
    val docType: String? = null,
    val address: String? = null
)

data class AIStop(
    val address: String,
    val contactName: String? = null,
    val potentialNames: List<String>? = null,
    val phoneNumber: String? = null,
    val timeWindow: String? = null,
    val notes: String? = null
)

data class AICostItem(
    val description: String? = null,
    val amount: Double,
    val currency: String? = null,
    val itemCategory: String? = null,
    val date: String? = null,
    val mileage: Int? = null
)
