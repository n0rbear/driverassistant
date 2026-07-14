package com.example.driverassistant.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.domain.model.Hotel
import com.example.driverassistant.domain.repository.DriverRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HotelsViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val backendApi: BackendApi,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen") ?: "Ismeretlen"

    init {
        syncHotelsWithBackend()
    }

    val hotels = combine(
        repository.getAllHotels(driverName),
        repository.getHotelStops(driverName)
    ) { manualHotels, tourHotels ->
        val mappedTourHotels = tourHotels.map { stop ->
            Hotel(
                id = -stop.id,
                uuid = stop.uuid,
                driverName = driverName,
                name = stop.recipient.ifBlank { stop.addressFull.ifBlank { stop.address } },
                address = stop.addressFull.ifBlank { stop.address },
                roomNumber = stop.roomNumber,
                entryCode = stop.entryCode,
                bookingNumber = stop.bookingNumber,
                phoneNumber = stop.phoneNumber,
                email = stop.email,
                notes = stop.notes,
                timestamp = stop.arrivalTime ?: 0L
            )
        }
        (manualHotels + mappedTourHotels).sortedByDescending { it.timestamp }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun addHotel(name: String, address: String, room: String, code: String, bookingNumber: String, phone: String, email: String, notes: String) {
        viewModelScope.launch {
            repository.insertHotel(
                Hotel(
                    driverName = driverName,
                    name = name,
                    address = address,
                    roomNumber = room,
                    entryCode = code,
                    bookingNumber = bookingNumber,
                    phoneNumber = phone,
                    email = email,
                    notes = notes,
                    timestamp = System.currentTimeMillis()
                )
            )
            syncHotelsWithBackend()
        }
    }

    private fun syncHotelsWithBackend() {
        viewModelScope.launch {
            try {
                // 1. PULL manual hotels
                val remoteHotels = backendApi.getManualHotels(driverName)
                val syncStartedAt = System.currentTimeMillis()
                repository.syncRemoteHotels(driverName, remoteHotels, syncStartedAt)

                // 2. PUSH local manual hotels
                val allHotels = repository.getAllHotelsSnapshot(driverName)
                backendApi.syncHotels(allHotels)
            } catch (e: Exception) {
                android.util.Log.e("SyncError", "Failed to sync hotels with backend", e)
            }
        }
    }

    fun updateHotel(hotel: Hotel) {
        viewModelScope.launch {
            repository.updateHotel(hotel)
            syncHotelsWithBackend()
        }
    }

    fun deleteHotel(hotel: Hotel) {
        viewModelScope.launch {
            repository.deleteHotel(hotel)
            syncHotelsWithBackend()
        }
    }
}
