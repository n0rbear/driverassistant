package com.example.driverassistant.data.repository

import com.example.driverassistant.data.local.dao.DriverDao
import com.example.driverassistant.domain.model.*
import com.example.driverassistant.domain.repository.DriverRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onEach
import javax.inject.Inject

class DriverRepositoryImpl @Inject constructor(
    private val dao: DriverDao,
    private val backendApi: com.example.driverassistant.data.api.BackendApi
) : DriverRepository {
    override fun getAllTours(driverName: String): Flow<List<Tour>> = dao.getAllTours(driverName)
    override suspend fun getAllToursWithDeleted(driverName: String): List<Tour> = dao.getAllToursWithDeleted(driverName)
    override suspend fun insertTour(tour: Tour): Long = dao.insertTour(tour)
    override suspend fun updateTour(tour: Tour) = dao.updateTour(tour)
    override suspend fun deleteTour(tour: Tour) = dao.updateTour(tour.copy(deletedAt = System.currentTimeMillis()))

    override fun getStopsForTour(tourId: Long): Flow<List<Stop>> = dao.getStopsForTour(tourId).onEach { stops ->
        android.util.Log.d("DashboardTrace", "DriverRepository.getStopsForTour EMIT: TourID: $tourId, StopCount: ${stops.size}")
        stops.forEach { stop ->
            android.util.Log.d("DashboardTrace", "  Stop: ID: ${stop.id}, Name: ${stop.contactName}, isCompleted: ${stop.isCompleted}, order: ${stop.orderIndex}")
        }
    }
    override suspend fun getStopsForTourWithDeleted(tourId: Long): List<Stop> = dao.getStopsForTourWithDeleted(tourId)
    override suspend fun insertStop(stop: Stop) = dao.insertStop(stop)
    override suspend fun updateStop(stop: Stop) = dao.updateStop(stop)
    override suspend fun deleteStop(stop: Stop) = dao.updateStop(stop.copy(deletedAt = System.currentTimeMillis()))

    override fun getAllDocuments(driverName: String): Flow<List<Document>> = dao.getAllDocuments(driverName)
    override suspend fun insertDocument(document: Document) = dao.insertDocument(document)
    override suspend fun updateDocument(document: Document) = dao.updateDocument(document)
    override suspend fun deleteDocument(document: Document) = dao.deleteDocument(document)

    override fun getAllCosts(driverName: String): Flow<List<Cost>> = dao.getAllCosts(driverName)
    override suspend fun insertCost(cost: Cost) = dao.insertCost(cost)
    override suspend fun updateCost(cost: Cost) = dao.updateCost(cost)
    override suspend fun deleteCost(cost: Cost) = dao.deleteCost(cost)

    override fun getAllHotels(driverName: String): Flow<List<Hotel>> = dao.getAllHotels(driverName)
    override fun getHotelStops(driverName: String): Flow<List<Stop>> = dao.getHotelStops(driverName)
    override suspend fun insertHotel(hotel: Hotel) = dao.insertHotel(hotel)
    override suspend fun updateHotel(hotel: Hotel) = dao.updateHotel(hotel)
    override suspend fun deleteHotel(hotel: Hotel) = dao.deleteHotel(hotel)
    override suspend fun getAllHotelsSnapshot(driverName: String): List<Hotel> = dao.getAllHotelsSnapshot(driverName)

    override suspend fun syncRemoteHotels(driverName: String, remoteHotels: List<Hotel>, syncStartedAt: Long) {
        val localHotels = dao.getAllHotelsSnapshot(driverName)
        val remoteByUuid = remoteHotels
            .filter { it.uuid.isNotBlank() }
            .associateBy { it.uuid }

        for (remote in remoteHotels) {
            val existing = if (remote.uuid.isNotBlank()) dao.getHotelByUuid(remote.uuid) else null
            val normalizedRemote = remote.copy(
                id = existing?.id ?: 0,
                driverName = driverName,
                roomNumber = remote.roomNumber,
                entryCode = remote.entryCode,
                bookingNumber = remote.bookingNumber,
                phoneNumber = remote.phoneNumber,
                email = remote.email,
                notes = remote.notes
            )

            if (existing == null) {
                dao.insertHotel(normalizedRemote)
            } else if (remote.timestamp >= existing.timestamp) {
                dao.updateHotel(normalizedRemote)
            }
        }

        localHotels
            .filter { it.uuid.isNotBlank() && it.uuid !in remoteByUuid && it.timestamp <= syncStartedAt }
            .forEach { dao.deleteHotelByUuid(it.uuid) }
    }

    override fun getLocationHistory(): Flow<List<LocationData>> = dao.getLocationHistory()
    override suspend fun insertLocation(location: LocationData) = dao.insertLocation(location)

    override fun getWorkTimesByDate(date: String, driverName: String): Flow<List<WorkTime>> = dao.getWorkTimesByDate(date, driverName)
    override fun getWorkTimesByPattern(pattern: String, driverName: String): Flow<List<WorkTime>> = dao.getWorkTimesByPattern(pattern, driverName)
    override suspend fun insertWorkTime(workTime: WorkTime) {
        android.util.Log.d("StatusTrace", "[DriverRepositoryImpl.insertWorkTime] type=${workTime.type}, driver=${workTime.driverName}, uuid=${workTime.uuid}")
        dao.insertWorkTime(workTime)
    }
    override suspend fun updateWorkTime(workTime: WorkTime) {
        android.util.Log.d("StatusTrace", "[DriverRepositoryImpl.updateWorkTime] id=${workTime.id}, type=${workTime.type}, end=${workTime.endTime}")
        dao.updateWorkTime(workTime)
    }
    override suspend fun deleteWorkTime(workTime: WorkTime) = dao.deleteWorkTime(workTime)
    override suspend fun getAllOngoingWorkTimes(driverName: String): List<WorkTime> {
        val result = dao.getAllOngoingWorkTimes(driverName)
        android.util.Log.d("StatusTrace", "[DriverRepositoryImpl.getAllOngoingWorkTimes] driver=$driverName, found=${result.size}")
        return result
    }
    override fun getOngoingWorkTimesFlow(driverName: String): Flow<List<WorkTime>> = dao.getOngoingWorkTimesFlow(driverName)
    override suspend fun closeAllOngoingWorkTimes(driverName: String, endTime: Long) = dao.closeAllOngoingWorkTimes(driverName, endTime)

    override suspend fun syncRemoteWorkTimes(driverName: String, remoteWorkTimes: List<WorkTime>) {
        for (remote in remoteWorkTimes) {
            val existing = dao.getWorkTimeByUuid(remote.uuid)
            if (existing == null) {
                dao.insertWorkTime(remote.copy(id = 0))
            } else {
                // If remote has an end time but local doesn't, or end time is different, update.
                // WorkTimes don't have an explicit 'updated_at', but we can assume newer timestamps or just replace.
                dao.updateWorkTime(remote.copy(id = existing.id))
            }
        }
    }

    override suspend fun syncRemoteCosts(driverName: String, remoteCosts: List<Cost>) {
        val localCosts = dao.getAllCosts(driverName).first()
        val remoteByUuid = remoteCosts.associateBy { it.uuid }
        
        for (remote in remoteCosts) {
            val existing = dao.getCostByUuid(remote.uuid)
            if (existing == null) {
                dao.insertCost(remote.copy(id = 0))
            } else {
                dao.updateCost(remote.copy(id = existing.id))
            }
        }

        // Handle deletions: if a cost is in local but not in remote list, and remote list is not empty, delete it locally
        if (remoteCosts.isNotEmpty()) {
            localCosts.forEach { local ->
                if (local.uuid !in remoteByUuid) {
                    dao.deleteCost(local)
                }
            }
        }
    }

    override fun getAllSavedLocations(): Flow<List<SavedLocation>> = dao.getAllSavedLocations()
    override suspend fun insertSavedLocation(location: SavedLocation) = dao.insertSavedLocation(location)
    override suspend fun deleteSavedLocationByType(type: String) = dao.deleteSavedLocationByType(type)

    override suspend fun deleteOldTours(timestamp: Long) = dao.deleteOldTours(timestamp)

    override fun getCurrentTour(driverName: String): Flow<Tour?> = dao.getCurrentTour(driverName).onEach { tour ->
        if (tour != null) {
            android.util.Log.d("DashboardTrace", "DriverRepository.getCurrentTour EMIT: ID: ${tour.id}, UUID: ${tour.uuid}, Name: ${tour.name}, isCurrent: ${tour.isCurrent}, isClosed: ${tour.isClosed}, updatedAt: ${tour.updatedAt}")
        } else {
            android.util.Log.d("DashboardTrace", "DriverRepository.getCurrentTour EMIT: NULL")
        }
    }
    override suspend fun setCurrentTour(tourId: Long) = dao.setCurrentTour(tourId)

    override suspend fun syncRemoteTours(driverName: String, remoteTours: List<com.example.driverassistant.data.api.TourWithStops>) {
        android.util.Log.d("SyncDebug", "DriverRepository: Starting syncRemoteTours with ${remoteTours.size} tours")
        if (remoteTours.isEmpty()) {
            android.util.Log.d("SyncDebug", "DriverRepository: Remote tours list is empty, skipping.")
            return
        }
        
        val localTours = dao.getAllToursWithDeleted(driverName)
        android.util.Log.d("SyncDebug", "DriverRepository: Local tours in DB: ${localTours.size}")
        
        for (remote in remoteTours) {
            val existing = localTours.find { it.uuid == remote.tour.uuid }
            
            // 1. Handle Tour Deletion
            if (remote.tour.deletedAt != null) {
                if (existing != null) {
                    android.util.Log.d("SyncDebug", "DriverRepository: DELETE Tour (Local ID: ${existing.id}, UUID: ${existing.uuid})")
                    dao.deleteTour(existing)
                } else {
                    android.util.Log.d("SyncDebug", "DriverRepository: Remote tour is deleted but not found locally (UUID: ${remote.tour.uuid})")
                }
                continue
            }

            val remoteUpdatedAt = remote.tour.updatedAt ?: 0
            val localUpdatedAt = existing?.updatedAt ?: 0
            
            android.util.Log.d("SyncDebug", "Merge check: tour ${remote.tour.uuid} localUpdatedAt=$localUpdatedAt remoteUpdatedAt=$remoteUpdatedAt, localIsCurrent=${existing?.isCurrent} remoteIsCurrent=${remote.tour.isCurrent}")

            // 2. Upsert Tour - Restore updatedAt check
            val tourId = if (existing != null) {
                if (remoteUpdatedAt > localUpdatedAt) {
                    android.util.Log.d("DashboardTrace", "DriverRepository: UPDATE Tour ID: ${existing.id}, UUID: ${remote.tour.uuid}, Name: ${remote.tour.name}, isCurrent: ${remote.tour.isCurrent}, isClosed: ${remote.tour.isClosed}, updatedAt: ${remote.tour.updatedAt}")
                    dao.updateTour(remote.tour.copy(id = existing.id))
                } else {
                    android.util.Log.d("DashboardTrace", "DriverRepository: SKIP Tour Update ID: ${existing.id}, UUID: ${remote.tour.uuid}, localAt=$localUpdatedAt, remoteAt=$remoteUpdatedAt")
                }
                existing.id
            } else {
                android.util.Log.d("DashboardTrace", "DriverRepository: INSERT NEW Tour UUID: ${remote.tour.uuid}, Name: ${remote.tour.name}, isCurrent: ${remote.tour.isCurrent}, isClosed: ${remote.tour.isClosed}, updatedAt: ${remote.tour.updatedAt}")
                dao.insertTour(remote.tour.copy(id = 0))
            }

            // If this is the current tour, ensure no other tour is marked current for this driver
            if (remote.tour.isCurrent) {
                android.util.Log.d("SyncDebug", "DriverRepository: Tour ${remote.tour.uuid} is CURRENT, clearing others for ${remote.tour.driverName}")
                dao.clearOtherCurrentTours(remote.tour.driverName, remote.tour.uuid, System.currentTimeMillis())
            }
            
            // 3. Handle Stops
            val localStops = dao.getStopsForTourWithDeleted(tourId)
            android.util.Log.d("SyncDebug", "DriverRepository: Processing ${remote.stops.size} stops for Tour ID: $tourId. Local stops: ${localStops.size}")
            val remoteStopUuids = remote.stops.map { it.uuid }.toSet()
            val newestLocalStopChange = localStops
                .map { maxOf(it.updatedAt ?: 0L, it.deletedAt ?: 0L) }
                .maxOrNull() ?: 0L
            val newestLocalChange = maxOf(localUpdatedAt, newestLocalStopChange)
            
            for (rStop in remote.stops) {
                val existingStop = localStops.find { it.uuid == rStop.uuid }
                
                if (rStop.deletedAt != null) {
                    if (existingStop != null) {
                        android.util.Log.d("SyncDebug", "DriverRepository: DELETE Stop (Local ID: ${existingStop.id}, UUID: ${existingStop.uuid})")
                        dao.deleteStop(existingStop)
                    }
                    continue
                }

                val remoteStopUpdatedAt = rStop.updatedAt ?: 0
                val localStopUpdatedAt = existingStop?.updatedAt ?: 0
                
                if (existingStop != null) {
                    if (remoteStopUpdatedAt > localStopUpdatedAt) {
                        android.util.Log.d("SyncDebug", "DriverRepository: UPDATE Stop (Local ID: ${existingStop.id}, Remote: $remoteStopUpdatedAt > Local: $localStopUpdatedAt)")
                        dao.updateStop(rStop.copy(id = existingStop.id, tourId = tourId))
                    } else {
                        // Log skip
                        // android.util.Log.d("SyncDebug", "DriverRepository: SKIP Stop Update (Local ID: ${existingStop.id})")
                    }
                } else {
                    android.util.Log.d("SyncDebug", "DriverRepository: INSERT NEW Stop (UUID: ${rStop.uuid})")
                    dao.insertStop(rStop.copy(id = 0, tourId = tourId))
                }
            }

            if (remoteUpdatedAt > newestLocalChange) {
                localStops
                    .filter { it.deletedAt == null && it.uuid !in remoteStopUuids }
                    .forEach { staleStop ->
                        android.util.Log.d("SyncDebug", "DriverRepository: MARK Stop deleted because it is absent remotely (Local ID: ${staleStop.id}, UUID: ${staleStop.uuid})")
                        dao.updateStop(staleStop.copy(deletedAt = remoteUpdatedAt, updatedAt = remoteUpdatedAt))
                    }
            }
        }
        val finalTours = dao.getAllToursWithDeleted(driverName)
        android.util.Log.d("SyncDebug", "Local tours after sync: ${finalTours.map { it.uuid to it.isCurrent }}")
        android.util.Log.d("SyncDebug", "DriverRepository: syncRemoteTours completed")
    }

    override suspend fun updateStopStatus(stopId: Long, completed: Boolean, time: Long?) = dao.updateStopStatus(stopId, completed, time, System.currentTimeMillis())

    override suspend fun getLastWorkTime(driverName: String): WorkTime? = dao.getLastWorkTime(driverName)
    
    override suspend fun updateDriverName(oldName: String, newName: String) {
        dao.updateWorkTimesDriverName(oldName, newName)
        dao.updateToursDriverName(oldName, newName)
        dao.updateCostsDriverName(oldName, newName)
        dao.updateHotelsDriverName(oldName, newName)
        dao.updateDocumentsDriverName(oldName, newName)
        dao.updateChatMessagesDriverName(oldName, newName)
    }

    override suspend fun syncProfile(name: String, email: String, phone: String, whatsapp: String, telegram: String, plate: String, photoUrl: String?, uuid: String?, profileUpdatedAt: Long): Long? {
        return try {
            val response = backendApi.syncProfile(
                com.example.driverassistant.data.api.ApiProfile(
                    uuid = uuid,
                    name = name,
                    email = email,
                    phone = phone,
                    whatsapp = whatsapp,
                    telegram = telegram,
                    licensePlate = plate,
                    photoUrl = photoUrl,
                    profileUpdatedAt = profileUpdatedAt
                )
            )
            response.profileUpdatedAt
        } catch (e: Exception) {
            android.util.Log.e("DriverRepository", "Failed to sync profile", e)
            null
        }
    }

    override suspend fun getProfile(name: String): com.example.driverassistant.data.api.ApiProfileResponse? {
        return try {
            backendApi.getProfile(name)
        } catch (e: Exception) {
            android.util.Log.e("DriverRepository", "Failed to fetch profile", e)
            null
        }
    }

    override suspend fun activateDriver(code: String, deviceId: String, deviceName: String): com.example.driverassistant.data.api.ApiProfileResponse? {
        return try {
            backendApi.activateDriver(com.example.driverassistant.data.api.ActivateDriverRequest(code, deviceId, deviceName))
        } catch (e: Exception) {
            android.util.Log.e("DriverRepository", "Failed to activate driver", e)
            null
        }
    }

    override suspend fun unlinkDevice(uuid: String?, deviceId: String) {
        try {
            backendApi.unlinkDevice(com.example.driverassistant.data.api.UnlinkDeviceRequest(uuid, deviceId))
        } catch (e: Exception) {
            android.util.Log.e("DriverRepository", "Failed to unlink device", e)
        }
    }

    override suspend fun getProfileByUuid(uuid: String): com.example.driverassistant.data.api.ApiProfileResponse? {
        return try {
            backendApi.getProfileByUuid(uuid)
        } catch (e: Exception) {
            android.util.Log.e("DriverRepository", "Failed to fetch profile by UUID", e)
            null
        }
    }

    override suspend fun uploadPhoto(driverName: String, base64: String, uuid: String?): com.example.driverassistant.data.api.PhotoUploadResponse? {
        return try {
            backendApi.uploadPhoto(
                com.example.driverassistant.data.api.PhotoUploadRequest(driverName, base64, uuid)
            )
        } catch (e: Exception) {
            android.util.Log.e("DriverRepository", "Failed to upload photo", e)
            null
        }
    }

    override suspend fun getMappingForCustomer(name: String): CustomerMapping? = dao.getMappingForCustomer(name)
    override suspend fun insertCustomerMapping(mapping: CustomerMapping) = dao.insertCustomerMapping(mapping)

    override fun getAllMessages(driverName: String): Flow<List<ChatMessage>> = dao.getAllMessages(driverName)
    override suspend fun insertMessage(message: ChatMessage) = dao.insertMessage(message)
    override suspend fun clearAllData() = dao.clearAllData()
}
