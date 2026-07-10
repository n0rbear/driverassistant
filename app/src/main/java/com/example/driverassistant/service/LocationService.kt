package com.example.driverassistant.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.LiveUpdate
import com.example.driverassistant.domain.model.*
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.domain.repository.LocationRepository
import com.example.driverassistant.util.NotificationUtils
import com.example.driverassistant.util.TimeUtils
import com.google.android.gms.location.*
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import kotlin.math.*

@AndroidEntryPoint
class LocationService : Service() {

    @Inject
    lateinit var repository: LocationRepository

    @Inject
    lateinit var driverRepository: DriverRepository

    @Inject
    lateinit var backendApi: BackendApi

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    
    private val wakeLock: PowerManager.WakeLock by lazy {
        (getSystemService(Context.POWER_SERVICE) as PowerManager).run {
            newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DriverAssistant::LocationSync")
        }
    }
    
    private val shortRestGraceMs = 3 * 60 * 1000L
    private val dateSdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

    override fun onBind(p0: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_STOP -> handleStop()
        }
        return START_STICKY
    }

    private fun start() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Driver Assistant - Aktív követés")
            .setContentText("GPS pozíció és állapot automatikus rögzítése...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .build()

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(1, notification)
        }
        
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15000)
            .setMinUpdateIntervalMillis(10000)
            .setMaxUpdateDelayMillis(30000)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                locationResult.lastLocation?.let { location ->
                    serviceScope.launch {
                        val currentLoc = LocationData(
                            latitude = location.latitude,
                            longitude = location.longitude,
                            timestamp = System.currentTimeMillis(),
                            speed = location.speed * 3.6f // m/s to km/h
                        )
                        repository.insertLocation(currentLoc)
                        // handleSmartLogic(currentLoc) // DEPRECATED: Logic moved to server
                        syncWithBackend(currentLoc)
                    }
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, null)
        } catch (e: SecurityException) {
            // Permission not granted
        }

        serviceScope.launch {
            // 45 napos takarítás induláskor
            val fortyFiveDaysAgo = System.currentTimeMillis() - (45L * 24 * 60 * 60 * 1000)
            driverRepository.deleteOldTours(fortyFiveDaysAgo)
        }
    }

    private suspend fun syncWithBackend(currentLoc: LocationData) {
        try {
            if (!wakeLock.isHeld) wakeLock.acquire(5000)
            val prefs = getSharedPreferences("driver_prefs", MODE_PRIVATE)
            val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
            val driverPhotoRaw = prefs.getString("driver_photo", null)
            val driverPhoto = if (driverPhotoRaw?.startsWith("content://") == true) null else driverPhotoRaw
            val driverPhone = prefs.getString("driver_phone", "")
            val driverEmail = prefs.getString("driver_email", "")
            
            // android.util.Log.d("StatusTrace", "[LocationService.syncWithBackend] START | driver=$driverName")
            
            val ongoingList = driverRepository.getAllOngoingWorkTimes(driverName)
            val ongoing = ongoingList.firstOrNull()
            
            // Get depot from saved locations (BASE) to send to server
            val savedLocations = driverRepository.getAllSavedLocations().first()
            val baseLoc = savedLocations.find { it.type == "BASE" }
            
            val response = backendApi.sendLiveUpdate(
                LiveUpdate(
                    uuid = currentLoc.uuid,
                    driverName = driverName,
                    driverPhoto = driverPhoto,
                    driverPhone = driverPhone,
                    driverEmail = driverEmail,
                    licensePlate = ongoing?.licensePlate ?: "N/A",
                    latitude = currentLoc.latitude,
                    longitude = currentLoc.longitude,
                    speed = currentLoc.speed,
                    timestamp = currentLoc.timestamp,
                    depotLat = baseLoc?.latitude,
                    depotLng = baseLoc?.longitude,
                    depotName = baseLoc?.name
                )
            )

            // Handle server calculated status
            if (response.status != (ongoing?.type ?: "Offline")) {
                handleServerStatusChange(response.status, currentLoc.timestamp, response.licensePlate ?: ongoing?.licensePlate)
            }
        } catch (e: Exception) {
            android.util.Log.e("StatusTrace", "[LocationService.syncWithBackend] ERROR", e)
        } finally {
            if (wakeLock.isHeld) wakeLock.release()
        }
    }

    private suspend fun handleServerStatusChange(newStatus: String, timestamp: Long, plate: String?) {
        val prefs = getSharedPreferences("driver_prefs", MODE_PRIVATE)
        val driverName = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
        val today = dateSdf.format(Date(timestamp))

        if (discardShortRestIfNeeded(driverName, newStatus, timestamp)) {
            return
        }

        val ongoingTasks = driverRepository.getAllOngoingWorkTimes(driverName)
        ongoingTasks.forEach { ongoing ->
            driverRepository.updateWorkTime(ongoing.copy(endTime = timestamp))
        }

        if (newStatus != "Offline" && newStatus != "N/A") {
            driverRepository.insertWorkTime(WorkTime(
                driverName = driverName,
                type = newStatus,
                startTime = timestamp,
                date = today,
                licensePlate = plate,
                mileage = ongoingTasks.firstOrNull()?.endMileage ?: ongoingTasks.firstOrNull()?.mileage
            ))
        }
    }

    private suspend fun discardShortRestIfNeeded(driverName: String, newStatus: String, timestamp: Long): Boolean {
        if (!newStatus.startsWith("Vezet")) return false

        val ongoingRest = driverRepository.getAllOngoingWorkTimes(driverName)
            .firstOrNull { it.type.startsWith("Pihen") }
            ?: return false

        if (timestamp - ongoingRest.startTime >= shortRestGraceMs) return false

        val restStart = ongoingRest.startTime
        val minPreviousEnd = restStart - shortRestGraceMs
        val maxPreviousEnd = restStart + 1000L
        val workTimes = driverRepository.getWorkTimesByDate(ongoingRest.date, driverName).first()
        val previousDriving = workTimes
            .filter {
                val endTime = it.endTime
                it.id != ongoingRest.id &&
                    it.type.startsWith("Vezet") &&
                    endTime != null &&
                    endTime in minPreviousEnd..maxPreviousEnd
            }
            .maxByOrNull { it.endTime ?: Long.MIN_VALUE }

        if (previousDriving != null) {
            driverRepository.updateWorkTime(previousDriving.copy(endTime = null, endMileage = null))
        }
        driverRepository.deleteWorkTime(ongoingRest)
        return true
    }

    private fun handleStop() {
        fusedLocationClient.removeLocationUpdates(locationCallback)
        stopForeground(true)
        stopSelf()
    }

    private fun stop() {
        stopForeground(true)
        stopSelf()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Location Tracking",
            NotificationManager.IMPORTANCE_LOW
        )
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    companion object {
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val CHANNEL_ID = "location_channel"
    }
}
