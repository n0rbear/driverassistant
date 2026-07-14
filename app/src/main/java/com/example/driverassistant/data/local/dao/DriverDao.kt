package com.example.driverassistant.data.local.dao

import androidx.room.*
import com.example.driverassistant.domain.model.*
import kotlinx.coroutines.flow.Flow

@Dao
interface DriverDao {
    // Tours
    @Query("SELECT * FROM tours WHERE driverName = :driverName AND deletedAt IS NULL ORDER BY date DESC")
    fun getAllTours(driverName: String): Flow<List<Tour>>

    @Query("SELECT * FROM tours WHERE driverName = :driverName ORDER BY date DESC")
    suspend fun getAllToursWithDeleted(driverName: String): List<Tour>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTour(tour: Tour): Long

    @Update
    suspend fun updateTour(tour: Tour)

    @Delete
    suspend fun deleteTour(tour: Tour)

    // Stops
    @Query("SELECT * FROM stops WHERE tourId = :tourId AND deletedAt IS NULL ORDER BY orderIndex ASC")
    fun getStopsForTour(tourId: Long): Flow<List<Stop>>

    @Query("SELECT * FROM stops WHERE tourId = :tourId ORDER BY orderIndex ASC")
    suspend fun getStopsForTourWithDeleted(tourId: Long): List<Stop>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertStop(stop: Stop)

    @Update
    suspend fun updateStop(stop: Stop)

    @Delete
    suspend fun deleteStop(stop: Stop)

    @Query("""
        SELECT stops.* FROM stops
        INNER JOIN tours ON tours.id = stops.tourId
        WHERE stops.stopType = 'HOTEL'
        AND stops.deletedAt IS NULL
        AND tours.driverName = :driverName
        ORDER BY stops.arrivalTime DESC
    """)
    fun getHotelStops(driverName: String): Flow<List<Stop>>

    // Documents
    @Query("SELECT * FROM documents WHERE driverName = :driverName ORDER BY timestamp DESC")
    fun getAllDocuments(driverName: String): Flow<List<Document>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDocument(document: Document)

    @Update
    suspend fun updateDocument(document: Document)

    @Delete
    suspend fun deleteDocument(document: Document)

    // Costs
    @Query("SELECT * FROM costs WHERE driverName = :driverName ORDER BY timestamp DESC")
    fun getAllCosts(driverName: String): Flow<List<Cost>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCost(cost: Cost)

    @Query("SELECT * FROM costs WHERE uuid = :uuid LIMIT 1")
    suspend fun getCostByUuid(uuid: String): Cost?

    @Update
    suspend fun updateCost(cost: Cost)

    @Delete
    suspend fun deleteCost(cost: Cost)

    // Hotels
    @Query("SELECT * FROM hotels WHERE driverName = :driverName ORDER BY timestamp DESC")
    fun getAllHotels(driverName: String): Flow<List<Hotel>>

    @Query("SELECT * FROM hotels WHERE driverName = :driverName ORDER BY timestamp DESC")
    suspend fun getAllHotelsSnapshot(driverName: String): List<Hotel>

    @Query("SELECT * FROM hotels WHERE uuid = :uuid LIMIT 1")
    suspend fun getHotelByUuid(uuid: String): Hotel?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertHotel(hotel: Hotel)

    @Update
    suspend fun updateHotel(hotel: Hotel)

    @Delete
    suspend fun deleteHotel(hotel: Hotel)

    @Query("DELETE FROM hotels WHERE uuid = :uuid")
    suspend fun deleteHotelByUuid(uuid: String)

    // Location
    @Query("SELECT * FROM location_history ORDER BY timestamp DESC")
    fun getLocationHistory(): Flow<List<LocationData>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLocation(location: LocationData)

    // Work Times
    @Query("SELECT * FROM work_times WHERE date = :date AND driverName = :driverName ORDER BY startTime DESC")
    fun getWorkTimesByDate(date: String, driverName: String): Flow<List<WorkTime>>

    @Query("SELECT * FROM work_times WHERE date LIKE :pattern AND driverName = :driverName ORDER BY startTime DESC")
    fun getWorkTimesByPattern(pattern: String, driverName: String): Flow<List<WorkTime>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWorkTime(workTime: WorkTime)

    @Query("SELECT * FROM work_times WHERE uuid = :uuid LIMIT 1")
    suspend fun getWorkTimeByUuid(uuid: String): WorkTime?

    @Update
    suspend fun updateWorkTime(workTime: WorkTime)

    @Delete
    suspend fun deleteWorkTime(workTime: WorkTime)

    // Saved Locations
    @Query("SELECT * FROM saved_locations")
    fun getAllSavedLocations(): Flow<List<SavedLocation>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSavedLocation(location: SavedLocation)

    @Query("DELETE FROM saved_locations WHERE type = :type")
    suspend fun deleteSavedLocationByType(type: String)

    @Query("SELECT * FROM tours WHERE isCurrent = 1 AND driverName = :driverName LIMIT 1")
    fun getCurrentTour(driverName: String): Flow<Tour?>

    @Query("UPDATE tours SET isCurrent = 0, updatedAt = :now WHERE driverName = :driverName")
    suspend fun unsetCurrentTour(driverName: String, now: Long)

    @Query("UPDATE tours SET isCurrent = 0, updatedAt = :now WHERE driverName = :driverName AND uuid != :currentUuid")
    suspend fun clearOtherCurrentTours(driverName: String, currentUuid: String, now: Long)

    @Transaction
    suspend fun setCurrentTour(tourId: Long) {
        val now = System.currentTimeMillis()
        val tour = getTourById(tourId) ?: return
        unsetCurrentTour(tour.driverName, now)
        markTourAsCurrent(tourId, now)
    }

    @Query("SELECT * FROM tours WHERE id = :tourId LIMIT 1")
    suspend fun getTourById(tourId: Long): Tour?

    @Query("UPDATE tours SET isCurrent = 1, updatedAt = :now WHERE id = :tourId")
    suspend fun markTourAsCurrent(tourId: Long, now: Long)

    @Query("UPDATE stops SET isCompleted = :completed, arrivalTime = :time, updatedAt = :updatedAt WHERE id = :stopId")
    suspend fun updateStopStatus(stopId: Long, completed: Boolean, time: Long?, updatedAt: Long)

    // Cleanup
    @Query("DELETE FROM tours WHERE date < :timestamp")
    suspend fun deleteOldTours(timestamp: Long)

    @Query("SELECT * FROM work_times WHERE driverName = :driverName ORDER BY startTime DESC LIMIT 1")
    suspend fun getLastWorkTime(driverName: String): WorkTime?

    @Query("UPDATE work_times SET driverName = :newName WHERE driverName = :oldName")
    suspend fun updateWorkTimesDriverName(oldName: String, newName: String)

    @Query("UPDATE tours SET driverName = :newName WHERE driverName = :oldName")
    suspend fun updateToursDriverName(oldName: String, newName: String)

    @Query("UPDATE costs SET driverName = :newName WHERE driverName = :oldName")
    suspend fun updateCostsDriverName(oldName: String, newName: String)

    @Query("UPDATE hotels SET driverName = :newName WHERE driverName = :oldName")
    suspend fun updateHotelsDriverName(oldName: String, newName: String)

    @Query("UPDATE documents SET driverName = :newName WHERE driverName = :oldName")
    suspend fun updateDocumentsDriverName(oldName: String, newName: String)

    @Query("UPDATE chat_messages SET driverName = :newName WHERE driverName = :oldName")
    suspend fun updateChatMessagesDriverName(oldName: String, newName: String)

    @Query("DELETE FROM tours WHERE driverName = :driverName")
    suspend fun deleteToursByDriver(driverName: String)

    @Query("SELECT * FROM work_times WHERE driverName = :driverName AND endTime IS NULL ORDER BY startTime DESC")
    suspend fun getAllOngoingWorkTimes(driverName: String): List<WorkTime>

    @Query("SELECT * FROM work_times WHERE driverName = :driverName AND endTime IS NULL ORDER BY startTime DESC")
    fun getOngoingWorkTimesFlow(driverName: String): Flow<List<WorkTime>>

    @Query("UPDATE work_times SET endTime = :endTime WHERE driverName = :driverName AND endTime IS NULL")
    suspend fun closeAllOngoingWorkTimes(driverName: String, endTime: Long)

    // Customer Mappings
    @Query("SELECT * FROM customer_mappings WHERE customerName = :name")
    suspend fun getMappingForCustomer(name: String): CustomerMapping?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCustomerMapping(mapping: CustomerMapping)

    // Chat
    @Query("SELECT * FROM chat_messages WHERE driverName = :driverName ORDER BY timestamp ASC")
    fun getAllMessages(driverName: String): Flow<List<ChatMessage>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ChatMessage)

    @Query("DELETE FROM tours")
    suspend fun deleteAllTours()
    @Query("DELETE FROM stops")
    suspend fun deleteAllStops()
    @Query("DELETE FROM documents")
    suspend fun deleteAllDocuments()
    @Query("DELETE FROM costs")
    suspend fun deleteAllCosts()
    @Query("DELETE FROM hotels")
    suspend fun deleteAllHotels()
    @Query("DELETE FROM location_history")
    suspend fun deleteAllLocationHistory()
    @Query("DELETE FROM work_times")
    suspend fun deleteAllWorkTimes()
    @Query("DELETE FROM saved_locations")
    suspend fun deleteAllSavedLocations()
    @Query("DELETE FROM customer_mappings")
    suspend fun deleteAllCustomerMappings()
    @Query("DELETE FROM chat_messages")
    suspend fun deleteAllChatMessages()

    @Transaction
    suspend fun clearAllData() {
        deleteAllTours()
        deleteAllStops()
        deleteAllDocuments()
        deleteAllCosts()
        deleteAllHotels()
        deleteAllLocationHistory()
        deleteAllWorkTimes()
        deleteAllSavedLocations()
        deleteAllCustomerMappings()
        deleteAllChatMessages()
    }
}
