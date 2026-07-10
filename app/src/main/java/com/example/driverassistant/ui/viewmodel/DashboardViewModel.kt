package com.example.driverassistant.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.data.api.OsrmApi
import com.example.driverassistant.domain.model.Stop
import com.example.driverassistant.domain.model.WorkTime
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.domain.repository.LocationRepository
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val locationRepository: LocationRepository,
    private val backendApi: BackendApi,
    private val osrmApi: OsrmApi,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context
) : ViewModel() {

    private val gson = Gson()
    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    
    // Reaktív sofőr név, ami figyeli a változásokat
    private val _driverName = MutableStateFlow(prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr")
    val driverNameFlow = _driverName.asStateFlow()
    private val driverName get() = _driverName.value

    val lastLocation = locationRepository.getLocationHistory()
        .map { it.firstOrNull() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private val dateSdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    fun getCurrentDate() = dateSdf.format(Date())

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val workTimes = combine(
        flow {
            while(true) {
                emit(getCurrentDate())
                kotlinx.coroutines.delay(60000)
            }
        },
        driverNameFlow
    ) { date, name ->
        date to name
    }.flatMapLatest { (date, name) ->
        repository.getWorkTimesByDate(date, name)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val ongoingWorkTime = driverNameFlow.flatMapLatest { name ->
        repository.getOngoingWorkTimesFlow(name)
    }.map { all ->
        all.firstOrNull()
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private val _lastData = MutableStateFlow<Pair<String, Int>?>(null)
    val lastData = _lastData.asStateFlow()

    private val _includeRests = MutableStateFlow(prefs.getBoolean("include_rests", true))
    val includeRests = _includeRests.asStateFlow()

    fun setIncludeRests(value: Boolean) {
        _includeRests.value = value
        prefs.edit().putBoolean("include_rests", value).apply()
    }

    val drivingTimeTodaySeconds = workTimes.map { list ->
        list.filter { it.type == "Vezetés" }
            .sumOf { (it.endTime ?: System.currentTimeMillis()) - it.startTime } / 1000
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0L)

    init {
        // Figyeljük a preferenciák változását (pl. profil szerkesztés után)
        viewModelScope.launch {
            while(true) {
                val latest = prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr"
                if (latest != _driverName.value) _driverName.value = latest
                kotlinx.coroutines.delay(2000)
            }
        }

        viewModelScope.launch {
            val last = repository.getLastWorkTime(_driverName.value)
            val defaultPlate = prefs.getString("default_plate", "") ?: ""
            if (last != null) {
                _lastData.value = (last.licensePlate ?: defaultPlate) to (last.endMileage ?: last.mileage ?: 0)
            } else if (defaultPlate.isNotBlank()) {
                _lastData.value = defaultPlate to 0
            }
            
            while(true) {
                syncWithBackend()
                syncTours()
                syncHotels()
                kotlinx.coroutines.delay(60000)
            }
        }
    }

    private fun syncTours() {
        viewModelScope.launch {
            try {
                android.util.Log.d("SyncDebug", "--- START SYNC (DashboardViewModel) ---")
                
                // 1. PUSH
                val tours = repository.getAllToursWithDeleted(_driverName.value)
                val toursWithStops = tours.map { t ->
                    com.example.driverassistant.data.api.TourWithStops(t, repository.getStopsForTourWithDeleted(t.id))
                }
                android.util.Log.d("SyncDebug", "PUSH Payload isCurrent values: ${toursWithStops.map { it.tour.uuid to it.tour.isCurrent }}")
                backendApi.syncTours(_driverName.value, toursWithStops)

                // 2. PULL
                android.util.Log.d("SyncDebug", "PULL Request for driver: ${_driverName.value}")
                val remoteTours = backendApi.getTours(_driverName.value)
                android.util.Log.d("SyncDebug", "PULL Response isCurrent values: ${remoteTours.map { it.tour.uuid to it.tour.isCurrent }}")
                
                repository.syncRemoteTours(_driverName.value, remoteTours)
                
                android.util.Log.d("SyncDebug", "--- SYNC COMPLETED SUCCESSFULLY (Dashboard) ---")
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "--- SYNC FAILED (Dashboard) ---", e)
            }
        }
    }

    private fun syncHotels() {
        viewModelScope.launch {
            try {
                val allHotels = repository.getAllHotels(_driverName.value).first()
                backendApi.syncHotels(allHotels)
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "--- HOTEL SYNC FAILED (Dashboard) ---", e)
            }
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val currentTour = driverNameFlow.flatMapLatest { name ->
        repository.getCurrentTour(name)
    }
        .onEach { tour ->
            if (tour != null) {
                android.util.Log.d("DashboardTrace", "DashboardViewModel.currentTour COLLECT: ID: ${tour.id}, UUID: ${tour.uuid}, Name: ${tour.name}, isCurrent: ${tour.isCurrent}, isClosed: ${tour.isClosed}, updatedAt: ${tour.updatedAt}")
            } else {
                android.util.Log.d("DashboardTrace", "DashboardViewModel.currentTour COLLECT: NULL")
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val currentStops = currentTour.flatMapLatest { tour ->
        if (tour != null) repository.getStopsForTour(tour.id) else flowOf(emptyList())
    }.onEach { stops ->
        stops.forEach { stop ->
            if (stop.latitude == null || stop.latitude == 0.0) {
                geocodeStop(stop)
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val profileDepot = repository.getAllSavedLocations()
        .map { it.find { loc -> loc.type == "BASE" } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val nextStop = currentTour.flatMapLatest { tour ->
        if (tour != null) {
            repository.getStopsForTour(tour.id).map { stops ->
                val stop = stops.find { !it.isCompleted }
                android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop COMPUTE: TourID: ${tour.id}, StopFound: ${stop?.contactName}")
                stop
            }
        } else {
            android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop COMPUTE: Tour is NULL")
            flowOf(null)
        }
    }.onEach { stop ->
        if (stop != null) {
            android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop EMIT: ${stop.contactName}, isCompleted: ${stop.isCompleted}")
        } else {
            android.util.Log.d("DashboardTrace", "DashboardViewModel.nextStop EMIT: NULL")
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun geocodeStop(stop: Stop) {
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val geocoder = android.location.Geocoder(context, java.util.Locale.getDefault())
                @Suppress("DEPRECATION")
                val addresses = geocoder.getFromLocationName(stop.address, 1)
                addresses?.firstOrNull()?.let { addr ->
                    repository.updateStop(stop.copy(
                        latitude = addr.latitude,
                        longitude = addr.longitude,
                        updatedAt = System.currentTimeMillis()
                    ))
                    android.util.Log.d("Geocode", "Successfully geocoded stop ${stop.id}: ${addr.latitude}, ${addr.longitude}")
                }
            } catch (e: Exception) {
                android.util.Log.e("Geocode", "Failed to geocode stop ${stop.id}: ${stop.address}", e)
            }
        }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val nextStopDistance = combine(
        locationRepository.getLocationHistory().map { it.firstOrNull() },
        nextStop,
        currentTour,
        repository.getAllSavedLocations().map { it.find { loc -> loc.type == "BASE" } }
    ) { location, stop, tour, profileDepot ->
        if (location != null) {
            val targetLat: Double
            val targetLng: Double
            
            if (stop != null && stop.latitude != null && stop.longitude != null) {
                targetLat = stop.latitude
                targetLng = stop.longitude
            } else if (profileDepot != null) {
                targetLat = profileDepot.latitude
                targetLng = profileDepot.longitude
            } else {
                return@combine null
            }

            try {
                val coords = "${location.longitude},${location.latitude};$targetLng,$targetLat"
                val response = osrmApi.getRoute(coords)
                val route = response.routes.firstOrNull()
                (route?.distance ?: 0.0) / 1000.0 to (route?.duration?.toLong() ?: 0L)
            } catch (e: Exception) {
                null
            }
        } else {
            null
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    val tourRemainingDistance = combine(
        locationRepository.getLocationHistory().map { it.firstOrNull() },
        currentTour,
        currentTour.flatMapLatest { tour ->
            if (tour != null) repository.getStopsForTour(tour.id) else flowOf(emptyList())
        },
        repository.getAllSavedLocations().map { it.find { loc -> loc.type == "BASE" } }
    ) { location, tour, stops, profileDepot ->
        if (location != null && tour != null) {
            val incompleteStops = stops.filter { !it.isCompleted && it.latitude != null && it.longitude != null }
            
            val depotLat = profileDepot?.latitude
            val depotLng = profileDepot?.longitude

            if (incompleteStops.isEmpty() && (depotLat == null || depotLng == null)) return@combine null

            try {
                val waypoints = mutableListOf("${location.longitude},${location.latitude}")
                waypoints.addAll(incompleteStops.map { "${it.longitude},${it.latitude}" })
                
                if (depotLat != null && depotLng != null) {
                    waypoints.add("$depotLng,$depotLat")
                }
                
                if (waypoints.size < 2) return@combine null
                
                val coords = waypoints.joinToString(";")
                val response = osrmApi.getRoute(coords)
                val route = response.routes.firstOrNull()
                (route?.distance ?: 0.0) / 1000.0 to (route?.duration?.toLong() ?: 0L)
            } catch (e: Exception) {
                null
            }
        } else {
            null
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun completeStop(stopId: Long) {
        viewModelScope.launch {
            repository.updateStopStatus(stopId, true, System.currentTimeMillis())
        }
    }

    fun getTotalTime(type: String, now: Long): String {
        val times = workTimes.value.filter { it.type == type }
        
        var totalMs = 0L
        times.forEach { wt ->
            if (wt.endTime != null) {
                totalMs += (wt.endTime - wt.startTime)
            }
        }
        
        // Csak a legutolsó nyitott bejegyzést mérjük valós időben, ha az a megfelelő típusú
        // Ez megakadályozza a "gyorsuló" időt, ha véletlenül több bejegyzés maradt nyitva
        workTimes.value.filter { it.endTime == null }
            .maxByOrNull { it.startTime }
            ?.let { latestOngoing ->
                if (latestOngoing.type == type) {
                    totalMs += (now - latestOngoing.startTime)
                }
            }
        
        val hours = totalMs / 3600000
        val minutes = (totalMs % 3600000) / 60000
        return String.format("%02d:%02d", hours, minutes)
    }

    fun updateStatus(type: String, mileage: Int? = null, license_plate: String? = null) {
        viewModelScope.launch {
            val currentDriverName = driverName
            val today = getCurrentDate()
            val now = System.currentTimeMillis()
            
            android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] START | type=$type | driver=$currentDriverName")

            // 1. Ha már ebben a státuszban vagyunk, ne csináljunk semmit (duplikáció védelem)
            val currentlyOngoing = repository.getAllOngoingWorkTimes(currentDriverName)
            android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Found ${currentlyOngoing.size} ongoing tasks for $currentDriverName")
            currentlyOngoing.forEach { 
                android.util.Log.d("StatusTrace", "  Ongoing: id=${it.id}, type=${it.type}, start=${it.startTime}")
            }

            if (currentlyOngoing.any { it.type == type }) {
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Status $type already active, skipping insert.")
                return@launch
            }
            
            // 2. Minden futó feladatot lezárunk
            currentlyOngoing.forEach { ongoing ->
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Closing ongoing task: ${ongoing.type} (id=${ongoing.id})")
                repository.updateWorkTime(ongoing.copy(
                    endTime = now, 
                    endMileage = if (type == "Offline") mileage else ongoing.endMileage
                ))
            }
            
            // 3. Új feladat indítása (ha nem kilépés)
            if (type != "Offline") {
                val newWork = WorkTime(
                    driverName = currentDriverName,
                    type = type,
                    startTime = now,
                    date = today,
                    mileage = mileage,
                    licensePlate = license_plate
                )
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Inserting new task: $type (UUID=${newWork.uuid})")
                repository.insertWorkTime(newWork)
                
                // Verification read-back
                val verify = repository.getAllOngoingWorkTimes(currentDriverName)
                android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] Post-insert verification: found ${verify.size} ongoing tasks")
                verify.forEach { 
                    android.util.Log.d("StatusTrace", "  Verify Ongoing: id=${it.id}, type=${it.type}, start=${it.startTime}, uuid=${it.uuid}")
                }
            }
            syncWithBackend()
            android.util.Log.d("StatusTrace", "[DashboardViewModel.updateStatus] END")
        }
    }

    private fun syncWithBackend() {
        viewModelScope.launch {
            try {
                android.util.Log.d("SyncDebug", "DashboardViewModel: START syncWithBackend (WorkTimes)")
                // Szinkronizáljuk az összes adatot a pontos statisztikához (vagy pl. utolsó 30 nap)
                val monthSdf = SimpleDateFormat("yyyy-MM", Locale.getDefault())
                val currentMonth = monthSdf.format(Date())
                repository.getWorkTimesByPattern("$currentMonth%", driverName).first().let { allTimes ->
                    android.util.Log.d("SyncDebug", "DashboardViewModel: PUSH WorkTimes Payload: ${gson.toJson(allTimes)}")
                    backendApi.syncWorkTimes(allTimes)
                }
                android.util.Log.d("SyncDebug", "DashboardViewModel: syncWithBackend COMPLETED")
            } catch (e: Exception) {
                android.util.Log.e("SyncDebug", "DashboardViewModel: Failed to sync work times", e)
            }
        }
    }

    fun deleteWorkTime(workTime: WorkTime) {
        viewModelScope.launch {
            repository.deleteWorkTime(workTime)
        }
    }

    fun updateWorkTime(workTime: WorkTime) {
        viewModelScope.launch {
            repository.updateWorkTime(workTime)
        }
    }
}
