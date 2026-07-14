package com.example.driverassistant.ui.viewmodel

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.MistralApi
import com.example.driverassistant.data.api.MistralMessage
import com.example.driverassistant.data.api.MistralRequest
import com.example.driverassistant.data.api.SetCurrentTourRequest
import com.example.driverassistant.data.api.StopPhotoUploadRequest
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.domain.model.Stop
import com.example.driverassistant.domain.model.Tour
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
class ToursViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val mistralApi: MistralApi,
    private val backendApi: BackendApi,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val gson = Gson()
    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"

    private val _isProcessing = MutableStateFlow(false)
    val isProcessing = _isProcessing.asStateFlow()

    private val _syncError = MutableStateFlow<String?>(null)
    val syncError = _syncError.asStateFlow()

    val tours = repository.getAllTours(driverName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val hotels = repository.getAllHotels(driverName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun addTour(name: String, customer: String, date: Long, notes: String) {
        viewModelScope.launch {
            repository.insertTour(Tour(
                driverName = driverName,
                name = name, 
                customer = customer, 
                date = date, 
                notes = notes
            ))
            syncToursWithBackend()
        }
    }

    fun syncToursWithBackend() {
        viewModelScope.launch {
            _isProcessing.value = true
            _syncError.value = null
            try {
                android.util.Log.d("SyncDebug", "--- START SYNC (ToursViewModel) ---")
                
                // 1. PUSH local changes
                val tours = repository.getAllToursWithDeleted(driverName)
                val toursWithStops = tours.map { t ->
                    com.example.driverassistant.data.api.TourWithStops(t, repository.getStopsForTourWithDeleted(t.id))
                }
                android.util.Log.d("SyncDebug", "PUSH Payload for driver: $driverName")
                backendApi.syncTours(driverName, toursWithStops)

                // 2. PULL remote changes
                val remoteTours = backendApi.getTours(driverName)
                repository.syncRemoteTours(driverName, remoteTours)
                
                android.util.Log.d("SyncDebug", "--- SYNC COMPLETED SUCCESSFULLY ---")
                
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "--- SYNC FAILED ---", e)
                _syncError.value = "Hiba a szinkronizálás során: ${e.message}"
            } finally {
                _isProcessing.value = false
            }
        }
    }

    private fun fetchToursFromBackend() {
        // Debounced or internal sync logic can go here if needed,
        // but now we'll trigger it explicitly from UI for better control.
    }

    fun deleteTour(tour: Tour) {
        viewModelScope.launch {
            repository.deleteTour(tour)
            syncToursWithBackend()
        }
    }

    fun setCurrentTour(tour: Tour) {
        viewModelScope.launch {
            repository.setCurrentTour(tour.id)
            try {
                backendApi.setCurrentTour(
                    SetCurrentTourRequest(
                        driverName = tour.driverName,
                        tourUuid = tour.uuid
                    )
                )
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "Failed to set current tour on backend", e)
            }
            syncToursWithBackend()
        }
    }

    fun updateTour(tour: Tour) {
        viewModelScope.launch {
            repository.updateTour(tour.copy(updatedAt = System.currentTimeMillis()))
            syncToursWithBackend()
        }
    }

    fun getStops(tourId: Long): Flow<List<Stop>> {
        return repository.getStopsForTour(tourId)
    }

    fun addStop(
        tourId: Long,
        recipient: String,
        street: String,
        houseNumber: String,
        postalCode: String,
        city: String,
        contact: String,
        phone: String,
        email: String,
        window: String,
        stopDate: Long?,
        notes: String,
        stopType: String = "DELIVERY"
    ) {
        viewModelScope.launch {
            val currentStops = repository.getStopsForTour(tourId).first()
            val nextOrderIndex = (currentStops.maxOfOrNull { it.orderIndex } ?: -1) + 1
            val addressFull = "$street $houseNumber, $postalCode $city".trim().removePrefix(",").trim()
            repository.insertStop(
                Stop(
                    tourId = tourId,
                    address = addressFull,
                    recipient = recipient,
                    street = street,
                    houseNumber = houseNumber,
                    postalCode = postalCode,
                    city = city,
                    addressFull = addressFull,
                    contactName = contact,
                    phoneNumber = phone,
                    email = email,
                    timeWindow = window,
                    stopDate = stopDate,
                    notes = notes,
                    stopType = stopType,
                    orderIndex = nextOrderIndex
                )
            )
            syncToursWithBackend()
        }
    }

    fun addHotelStop(tourId: Long, hotel: Hotel, afterStopId: Long?) {
        viewModelScope.launch {
            val stops = repository.getStopsForTour(tourId).first()
            val afterStop = stops.firstOrNull { it.id == afterStopId }
            val newOrderIndex = if (afterStop != null) afterStop.orderIndex + 1 else (stops.maxOfOrNull { it.orderIndex } ?: -1) + 1
            val now = System.currentTimeMillis()

            stops
                .filter { it.orderIndex >= newOrderIndex }
                .forEach { repository.updateStop(it.copy(orderIndex = it.orderIndex + 1, updatedAt = now)) }

            repository.insertStop(
                Stop(
                    tourId = tourId,
                    address = hotel.address,
                    recipient = hotel.name,
                    addressFull = hotel.address,
                    contactName = hotel.name,
                    phoneNumber = hotel.phoneNumber,
                    email = hotel.email,
                    timeWindow = "",
                    notes = listOfNotNull(
                        hotel.roomNumber.takeIf { it.isNotBlank() }?.let { "Szoba: $it" },
                        hotel.entryCode.takeIf { it.isNotBlank() }?.let { "Kód: $it" },
                        hotel.bookingNumber.takeIf { it.isNotBlank() }?.let { "Buchungsnummer: $it" },
                        hotel.notes.takeIf { it.isNotBlank() }
                    ).joinToString(" | "),
                    stopType = "HOTEL",
                    orderIndex = newOrderIndex,
                    updatedAt = now
                )
            )
            syncToursWithBackend()
        }
    }

    fun updateStop(stop: Stop) {
        viewModelScope.launch {
            repository.updateStop(stop.copy(updatedAt = System.currentTimeMillis()))
            syncToursWithBackend()
        }
    }

    fun moveStopUp(tourId: Long, stop: Stop) {
        viewModelScope.launch {
            val stops = repository.getStopsForTour(tourId).first().toMutableList()
            val index = stops.indexOfFirst { it.id == stop.id }
            if (index > 0) {
                val prevStop = stops[index - 1]
                val now = System.currentTimeMillis()
                repository.updateStop(stop.copy(orderIndex = prevStop.orderIndex, updatedAt = now))
                repository.updateStop(prevStop.copy(orderIndex = stop.orderIndex, updatedAt = now))
                syncToursWithBackend()
            }
        }
    }

    fun moveStopDown(tourId: Long, stop: Stop) {
        viewModelScope.launch {
            val stops = repository.getStopsForTour(tourId).first().toMutableList()
            val index = stops.indexOfFirst { it.id == stop.id }
            if (index != -1 && index < stops.size - 1) {
                val nextStop = stops[index + 1]
                val now = System.currentTimeMillis()
                repository.updateStop(stop.copy(orderIndex = nextStop.orderIndex, updatedAt = now))
                repository.updateStop(nextStop.copy(orderIndex = stop.orderIndex, updatedAt = now))
                syncToursWithBackend()
            }
        }
    }

    fun uploadStopPhoto(stop: Stop, uri: Uri) {
        viewModelScope.launch {
            try {
                val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                if (bitmap == null) {
                    _syncError.value = "Nem sikerült beolvasni a képet."
                    return@launch
                }

                val resized = resizeBitmap(bitmap, 1400)
                val output = java.io.ByteArrayOutputStream()
                resized.compress(Bitmap.CompressFormat.JPEG, 82, output)
                val base64 = android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP)
                val uploaded = backendApi.uploadStopPhoto(StopPhotoUploadRequest(stop.uuid, base64))
                repository.updateStop(stop.copy(photoUrl = uploaded.photoUrl, updatedAt = uploaded.updatedAt))
                syncToursWithBackend()
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "Failed to upload stop photo", e)
                _syncError.value = "Hiba a megálló fotó feltöltésekor: ${e.message}"
            }
        }
    }

    private fun resizeBitmap(bitmap: Bitmap, maxSide: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maxSide) return bitmap
        val scale = maxSide.toFloat() / longest.toFloat()
        val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
        val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, width, height, true)
    }

    fun deleteStop(stop: Stop) {
        viewModelScope.launch {
            repository.deleteStop(stop)
            syncToursWithBackend()
        }
    }

    fun selectCorrectName(tour: Tour, stop: Stop, selectedName: String, nameIndex: Int) {
        viewModelScope.launch {
            // Update current stop
            repository.updateStop(stop.copy(contactName = selectedName, updatedAt = System.currentTimeMillis()))
            
            // Learn mapping for the future if customer is present
            if (tour.customer.isNotBlank()) {
                repository.insertCustomerMapping(
                    com.example.driverassistant.domain.model.CustomerMapping(
                        customerName = tour.customer,
                        nameIndexToPick = nameIndex
                    )
                )
            }
            syncToursWithBackend()
        }
    }

    fun processTourWithAI(context: Context, uri: Uri) {
        viewModelScope.launch {
            _isProcessing.value = true
            try {
                val extractedText = OCRUtils.extractTextFromUri(context, uri)
                val prompt = """
                    Elemezd ezt a fuvartervet/rollkartét és add meg az adatokat JSON formátumban:
                    $extractedText
                    
                    Mezők:
                    - tourName: A túra neve
                    - stops: Lista az állomásokkal (A SORREND PONTOSAN AZ LEGYEN, AMI A PAPÍRON!)
                        - recipient: Címzett (személy vagy cég)
                        - street: Utca
                        - houseNumber: Házszám
                        - postalCode: Irányítószám
                        - city: Város
                        - contactName: Kapcsolattartó
                        - phoneNumber: Telefonszám
                        - timeWindow: Időablak
                        - notes: Megjegyzés
                        - alternativeNames: Ha több lehetséges címzett van, sorold fel őket pipe-pal elválasztva (pl. "DHL Express|DHL Freight")
                    
                    Csak a JSON-t küldd vissza, markdown blokkok nélkül!
                """.trimIndent()

                val response = mistralApi.chat(
                    authHeader = AiAuth.mistralHeader(),
                    request = MistralRequest(messages = listOf(MistralMessage("user", prompt)))
                )

                val aiText = response.choices.firstOrNull()?.message?.content ?: ""
                val cleanJson = aiText.removeSurrounding("```json", "```").trim()
                
                fun extractField(text: String, field: String): String {
                    val regex = "\"$field\"\\s*:\\s*\"([^\"]*)\"".toRegex()
                    return regex.find(text)?.groupValues?.get(1) ?: ""
                }

                val tourName = extractField(cleanJson, "tourName")
                
                val tourId = repository.insertTour(
                    Tour(
                        driverName = driverName,
                        name = tourName.ifBlank { "Importált Túra" }, 
                        date = System.currentTimeMillis(), 
                        notes = "AI generált"
                    )
                )

                // Állomások kinyerése
                val stopRegex = "\\{[^}]*recipient[^}]*\\}".toRegex()
                val stopMatches = stopRegex.findAll(cleanJson)
                
                stopMatches.forEachIndexed { index, match ->
                    val block = match.value
                    val recipient = extractField(block, "recipient")
                    val street = extractField(block, "street")
                    val house = extractField(block, "houseNumber")
                    val postal = extractField(block, "postalCode")
                    val city = extractField(block, "city")
                    val addressFull = "$street $house, $postal $city".trim().removePrefix(",").trim()
                    
                    if (recipient.isNotEmpty() || street.isNotEmpty()) {
                        repository.insertStop(
                            Stop(
                                tourId = tourId,
                                address = addressFull,
                                recipient = recipient,
                                street = street,
                                houseNumber = house,
                                postalCode = postal,
                                city = city,
                                addressFull = addressFull,
                                contactName = extractField(block, "contactName"),
                                phoneNumber = extractField(block, "phoneNumber"),
                                email = "",
                                timeWindow = extractField(block, "timeWindow"),
                                notes = extractField(block, "notes"),
                                alternativeNames = extractField(block, "alternativeNames"),
                                orderIndex = index
                            )
                        )
                    }
                }
                syncToursWithBackend()
            } catch (e: Exception) {
                // Hiba kezelés
            } finally {
                _isProcessing.value = false
            }
        }
    }
}
