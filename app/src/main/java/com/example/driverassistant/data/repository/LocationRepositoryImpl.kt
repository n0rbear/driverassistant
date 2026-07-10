package com.example.driverassistant.data.repository

import com.example.driverassistant.data.local.dao.DriverDao
import com.example.driverassistant.domain.model.LocationData
import com.example.driverassistant.domain.repository.LocationRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class LocationRepositoryImpl @Inject constructor(
    private val dao: DriverDao
) : LocationRepository {
    override fun getLocationHistory(): Flow<List<LocationData>> = dao.getLocationHistory()
    override suspend fun insertLocation(location: LocationData) = dao.insertLocation(location)
}
