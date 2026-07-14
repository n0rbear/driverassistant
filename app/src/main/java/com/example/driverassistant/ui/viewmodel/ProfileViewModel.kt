package com.example.driverassistant.ui.viewmodel

import android.content.Context
import android.content.Intent
import android.location.Geocoder
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.domain.model.SavedLocation
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.domain.repository.LocationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val locationRepository: LocationRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private var driverUuid: String? = prefs.getString("driver_uuid", null)
    private var profileUpdatedAt: Long = prefs.getLong("profile_updated_at", 0L)
    private val deviceId: String = prefs.getString("device_id", null) ?: java.util.UUID.randomUUID().toString().also {
        prefs.edit().putString("device_id", it).apply()
    }

    private val _events = MutableSharedFlow<String>()
    val events = _events.asSharedFlow()

    private val _driverName = MutableStateFlow(prefs.getString("driver_name", "Ismeretlen Sofőr") ?: "Ismeretlen Sofőr")
    val driverName = _driverName.asStateFlow()

    private val _driverPhone = MutableStateFlow(prefs.getString("driver_phone", "") ?: "")
    val driverPhone = _driverPhone.asStateFlow()

    private val _driverEmail = MutableStateFlow(prefs.getString("driver_email", "") ?: "")
    val driverEmail = _driverEmail.asStateFlow()

    private val _defaultPlate = MutableStateFlow(prefs.getString("default_plate", "") ?: "")
    val defaultPlate = _defaultPlate.asStateFlow()

    private val _driverWhatsapp = MutableStateFlow(prefs.getString("driver_whatsapp", "") ?: "")
    val driverWhatsapp = _driverWhatsapp.asStateFlow()

    private val _driverTelegram = MutableStateFlow(prefs.getString("driver_telegram", "") ?: "")
    val driverTelegram = _driverTelegram.asStateFlow()

    private val _driverPhoto = MutableStateFlow(prefs.getString("driver_photo", null))
    val driverPhoto = _driverPhoto.asStateFlow()

    private val _isLinked = MutableStateFlow(driverUuid != null)
    val isLinked = _isLinked.asStateFlow()

    private val _driverUuidFlow = MutableStateFlow(driverUuid)
    val driverUuidFlow = _driverUuidFlow.asStateFlow()

    val savedLocations = repository.getAllSavedLocations()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        refreshProfileFromServer()
    }

    fun refreshProfileFromServer() {
        viewModelScope.launch {
            val remote = driverUuid?.let { repository.getProfileByUuid(it) }
                ?: repository.getProfile(_driverName.value)
                ?: return@launch
            applyRemoteProfile(
                uuid = remote.uuid,
                name = remote.name,
                phone = remote.phone.orEmpty(),
                email = remote.email.orEmpty(),
                whatsapp = remote.whatsapp.orEmpty(),
                telegram = remote.telegram.orEmpty(),
                plate = remote.licensePlate.orEmpty(),
                photoUrl = remote.photoUrl,
                updatedAt = remote.profileUpdatedAt ?: 0L
            )
        }
    }

    fun linkWithActivationCode(code: String) {
        val cleanCode = code.trim().uppercase(Locale.getDefault())
        if (cleanCode.isBlank()) return
        viewModelScope.launch {
            val remote = repository.activateDriver(cleanCode, deviceId, "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            if (remote == null) {
                _events.emit("Érvénytelen aktiváló kód vagy nem elérhető a szerver.")
                return@launch
            }
            applyRemoteProfile(
                uuid = remote.uuid,
                name = remote.name,
                phone = remote.phone.orEmpty(),
                email = remote.email.orEmpty(),
                whatsapp = remote.whatsapp.orEmpty(),
                telegram = remote.telegram.orEmpty(),
                plate = remote.licensePlate.orEmpty(),
                photoUrl = remote.photoUrl,
                updatedAt = remote.profileUpdatedAt ?: 0L
            )
            _isLinked.value = true
            _events.emit("Telefon társítva: ${remote.name}")
        }
    }

    fun updateProfile(name: String, phone: String, email: String, whatsapp: String, telegram: String, plate: String) {
        val previousName = _driverName.value
        _driverName.value = name
        _driverPhone.value = phone
        _driverEmail.value = email
        _driverWhatsapp.value = whatsapp
        _driverTelegram.value = telegram
        _defaultPlate.value = plate

        prefs.edit().apply {
            putString("driver_name", name)
            putString("driver_phone", phone)
            putString("driver_email", email)
            putString("driver_whatsapp", whatsapp)
            putString("driver_telegram", telegram)
            putString("default_plate", plate)
            apply()
        }
        
        viewModelScope.launch {
            repository.updateDriverName(previousName, name)
            val photoToSend = _driverPhoto.value?.let { if (it.startsWith("content://")) null else it }
            val updatedAt = repository.syncProfile(name, email, phone, whatsapp, telegram, plate, photoToSend, driverUuid, profileUpdatedAt)
            if (updatedAt != null) {
                profileUpdatedAt = updatedAt
                prefs.edit().putLong("profile_updated_at", updatedAt).apply()
                refreshProfileFromServer()
            } else {
                refreshProfileFromServer()
                _events.emit("A weben frissebb profil volt. Frissítettem a telefonon is.")
            }
        }
    }

    fun uploadPhoto(uri: android.net.Uri, offsetX: Float = 0f, offsetY: Float = 0f, zoom: Float = 1f) {
        viewModelScope.launch {
            try {
                val bitmap = decodeOrientedBitmap(uri)

                if (bitmap != null) {
                    val outputStream = java.io.ByteArrayOutputStream()
                    val croppedBitmap = cropProfileBitmap(bitmap, offsetX, offsetY, zoom)
                    croppedBitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, outputStream)
                    val bytes = outputStream.toByteArray()
                    
                    val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                    android.util.Log.d("PhotoUpload", "Sending photo, size: ${bytes.size} bytes, base64 length: ${base64.length}")

                    val upload = repository.uploadPhoto(_driverName.value, base64, driverUuid)
                    val photoUrl = upload?.photoUrl.orEmpty()
                    if (photoUrl.isNotBlank()) {
                        // Ha a szerver visszaküldte a relatív URL-t, tegyük elé a bázis URL-t ha kell, 
                        // de a coil megeszi a relatívat is ha jól van konfigurálva, 
                        // vagy a szerver teljes URL-t ad.
                        // Itt most feltételezzük, hogy a szerver relatívat ad: /uploads/...
                        val finalPhotoUrl = if (photoUrl.startsWith("/")) photoUrl else "/$photoUrl"
                        _driverPhoto.value = finalPhotoUrl
                        upload?.profileUpdatedAt?.let { profileUpdatedAt = it }
                        prefs.edit()
                            .putString("driver_photo", finalPhotoUrl)
                            .putLong("profile_updated_at", profileUpdatedAt)
                            .apply()
                        _events.emit("Profilkép sikeresen feltöltve!")
                    } else {
                        _events.emit("Hiba a kép feltöltésekor! (Szerver hiba)")
                    }
                } else {
                    _events.emit("Hiba: Nem sikerült beolvasni a képet.")
                }
            } catch (e: Exception) {
                _events.emit("Hiba: ${e.message}")
            }
        }
    }

    private fun decodeOrientedBitmap(uri: android.net.Uri): android.graphics.Bitmap? {
        val inputStream = context.contentResolver.openInputStream(uri)
        val bitmap = android.graphics.BitmapFactory.decodeStream(inputStream)
        inputStream?.close()
        if (bitmap == null) return null

        val exifStream = context.contentResolver.openInputStream(uri)
        val orientation = exifStream?.use {
            ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL

        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        if (degrees == 0f) return bitmap

        val matrix = android.graphics.Matrix().apply { postRotate(degrees) }
        return android.graphics.Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun cropProfileBitmap(bitmap: android.graphics.Bitmap, offsetX: Float, offsetY: Float, zoom: Float): android.graphics.Bitmap {
        val safeZoom = zoom.coerceIn(1f, 3f)
        val baseSize = minOf(bitmap.width, bitmap.height).toFloat()
        val cropSize = (baseSize / safeZoom).toInt().coerceAtLeast(1)
        val maxX = ((bitmap.width - cropSize) / 2f).coerceAtLeast(0f)
        val maxY = ((bitmap.height - cropSize) / 2f).coerceAtLeast(0f)
        val centerX = bitmap.width / 2f - offsetX.coerceIn(-1f, 1f) * maxX
        val centerY = bitmap.height / 2f - offsetY.coerceIn(-1f, 1f) * maxY
        val left = (centerX - cropSize / 2f).toInt().coerceIn(0, bitmap.width - cropSize)
        val top = (centerY - cropSize / 2f).toInt().coerceIn(0, bitmap.height - cropSize)
        val cropped = android.graphics.Bitmap.createBitmap(bitmap, left, top, cropSize, cropSize)
        return android.graphics.Bitmap.createScaledBitmap(cropped, 800, 800, true)
    }

    private fun applyRemoteProfile(
        uuid: String?,
        name: String,
        phone: String,
        email: String,
        whatsapp: String,
        telegram: String,
        plate: String,
        photoUrl: String?,
        updatedAt: Long
    ) {
        val previousName = _driverName.value
        driverUuid = uuid ?: driverUuid
        _driverUuidFlow.value = driverUuid
        _isLinked.value = driverUuid != null
        profileUpdatedAt = updatedAt
        _driverName.value = name
        _driverPhone.value = phone
        _driverEmail.value = email
        _driverWhatsapp.value = whatsapp
        _driverTelegram.value = telegram
        _defaultPlate.value = plate
        _driverPhoto.value = photoUrl

        prefs.edit().apply {
            if (driverUuid != null) putString("driver_uuid", driverUuid)
            putLong("profile_updated_at", profileUpdatedAt)
            putString("driver_name", name)
            putString("driver_phone", phone)
            putString("driver_email", email)
            putString("driver_whatsapp", whatsapp)
            putString("driver_telegram", telegram)
            putString("default_plate", plate)
            putString("driver_photo", photoUrl)
            apply()
        }

        viewModelScope.launch {
            if (previousName != name) repository.updateDriverName(previousName, name)
        }
    }

    fun signOut() {
        viewModelScope.launch {
            // 1. Stop location service
            val intent = Intent(context, com.example.driverassistant.service.LocationService::class.java).apply {
                action = com.example.driverassistant.service.LocationService.ACTION_STOP
            }
            context.startService(intent)

            // 2. Unlink this physical device on the server, but keep the driver profile there.
            repository.unlinkDevice(driverUuid, deviceId)

            // 3. Clear database
            repository.clearAllData()

            // 4. Clear profile binding but keep this local device id for future pairing.
            prefs.edit().clear().putString("device_id", deviceId).apply()
            driverUuid = null
            _driverUuidFlow.value = null
            profileUpdatedAt = 0L
            _isLinked.value = false

            // 5. Emit event to UI
            _events.emit("LOGOUT_SUCCESS")
        }
    }

    fun saveLocation(name: String, address: String, lat: Double, lng: Double, type: String) {
        viewModelScope.launch {
            // Először töröljük a régit azonos típusból (pl. csak egy HOME lehet)
            repository.deleteSavedLocationByType(type)
            repository.insertSavedLocation(SavedLocation(name = name, address = address, latitude = lat, longitude = lng, type = type))
        }
    }

    fun saveCurrentPositionAs(type: String) {
        viewModelScope.launch {
            val history = locationRepository.getLocationHistory().first()
            val lastLoc = history.firstOrNull()
            if (lastLoc != null) {
                val address = try {
                    val geocoder = Geocoder(context, Locale.getDefault())
                    // Simple sync version for now, wrapped in coroutine
                    @Suppress("DEPRECATION")
                    val addresses = geocoder.getFromLocation(lastLoc.latitude, lastLoc.longitude, 1)
                    addresses?.firstOrNull()?.getAddressLine(0) ?: "Ismeretlen cím"
                } catch (e: Exception) {
                    "Koordináták: ${lastLoc.latitude}, ${lastLoc.longitude}"
                }

                repository.deleteSavedLocationByType(type)
                repository.insertSavedLocation(
                    SavedLocation(
                        name = if (type == "HOME") "Otthon" else "Telephely",
                        address = address,
                        latitude = lastLoc.latitude,
                        longitude = lastLoc.longitude,
                        type = type
                    )
                )
                _events.emit("Helyszín mentve: $address")
            } else {
                _events.emit("Hiba: Nincs elérhető GPS pozíció!")
            }
        }
    }
}
