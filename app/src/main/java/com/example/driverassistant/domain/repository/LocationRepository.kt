package com.example.driverassistant.domain.repository

import com.example.driverassistant.domain.model.LocationData
import kotlinx.coroutines.flow.Flow

interface LocationRepository {
    fun getLocationHistory(): Flow<List<LocationData>>
    suspend fun insertLocation(location: LocationData)
}
