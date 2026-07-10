package com.example.driverassistant.data.api

import com.example.driverassistant.domain.model.*
import retrofit2.http.*

data class LiveUpdate(
    val uuid: String? = null,
    val driverName: String,
    val driverPhoto: String? = null,
    val driverPhone: String? = null,
    val driverEmail: String? = null,
    val licensePlate: String,
    val latitude: Double,
    val longitude: Double,
    val speed: Float,
    val status: String? = null,
    val timestamp: Long,
    val currentTour: String? = null,
    val nextStop: String? = null,
    val nextLat: Double? = null,
    val nextLng: Double? = null,
    val nextStopDistance: Float? = null,
    val tourRemainingDistance: Float? = null,
    val tourRemainingDuration: Long? = null, // In seconds
    val nextStopDuration: Long? = null, // In seconds
    val depotName: String? = null,
    val depotLat: Double? = null,
    val depotLng: Double? = null,
    val includeRests: Boolean = true,
    val nextBreakInSeconds: Long? = null
)

data class TourWithStops(
    val tour: Tour,
    val stops: List<Stop>
)

data class CostStatusUpdate(
    val id: Long, // Server ID
    val uuid: String? = null,
    val status: String,
    val timestamp: Long,
    val amount: Double
)

data class ApiChatMessage(
    val uuid: String? = null,
    val driverName: String,
    val sender: String,
    val message: String,
    val timestamp: Long
)

data class SetCurrentTourRequest(
    val driverName: String,
    val tourUuid: String
)

data class LiveUpdateResponse(
    val status: String,
    val licensePlate: String? = null
)

data class ApiProfile(
    val uuid: String? = null,
    val name: String,
    val email: String,
    val phone: String,
    val whatsapp: String,
    val telegram: String,
    val licensePlate: String,
    val photoUrl: String?,
    val profileUpdatedAt: Long = 0L
)

data class ApiProfileResponse(
    val uuid: String? = null,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val whatsapp: String? = null,
    val telegram: String? = null,
    @com.google.gson.annotations.SerializedName("license_plate") val licensePlate: String? = null,
    @com.google.gson.annotations.SerializedName("photo_url") val photoUrl: String? = null,
    @com.google.gson.annotations.SerializedName("profile_updated_at") val profileUpdatedAt: Long? = null
)

data class ActivateDriverRequest(
    val code: String,
    val deviceId: String,
    val deviceName: String
)

data class UnlinkDeviceRequest(
    val uuid: String? = null,
    val deviceId: String
)

data class ProfileSyncResponse(
    val success: Boolean = true,
    val profileUpdatedAt: Long? = null
)

data class PhotoUploadRequest(
    val driverName: String,
    val imageBase64: String,
    val uuid: String? = null
)

data class PhotoUploadResponse(
    val photoUrl: String,
    val profileUpdatedAt: Long? = null
)

data class StopPhotoUploadRequest(
    val stopUuid: String,
    val imageBase64: String
)

data class StopPhotoUploadResponse(
    val photoUrl: String,
    val updatedAt: Long
)

interface BackendApi {
    @GET("api/cost-status/{driverName}")
    suspend fun getCostStatus(@Path("driverName") driverName: String): List<CostStatusUpdate>

    @GET("api/get-chat/{driverName}")
    suspend fun getMessages(@Path("driverName") driverName: String): List<ApiChatMessage>

    @POST("api/send-chat")
    suspend fun sendMessage(@Body message: ApiChatMessage)

    @POST("api/live-update")
    suspend fun sendLiveUpdate(@Body update: LiveUpdate): LiveUpdateResponse

    @POST("api/sync-costs")
    suspend fun syncCosts(@Body costs: List<Cost>)

    @POST("api/sync-tours/{driverName}")
    suspend fun syncTours(@Path("driverName") driverName: String, @Body tours: List<TourWithStops>)

    @POST("api/sync-worktimes")
    suspend fun syncWorkTimes(@Body workTimes: List<WorkTime>)

    @GET("api/get-tours/{driverName}")
    suspend fun getTours(@Path("driverName") driverName: String): List<TourWithStops>

    @POST("api/set-current-tour")
    suspend fun setCurrentTour(@Body request: SetCurrentTourRequest)

    @POST("api/sync-hotels")
    suspend fun syncHotels(@Body hotels: List<Hotel>)

    @POST("api/sync-profile")
    suspend fun syncProfile(@Body profile: ApiProfile): ProfileSyncResponse

    @POST("api/activate-driver")
    suspend fun activateDriver(@Body request: ActivateDriverRequest): ApiProfileResponse

    @POST("api/unlink-device")
    suspend fun unlinkDevice(@Body request: UnlinkDeviceRequest)

    @GET("api/get-profile/{name}")
    suspend fun getProfile(@Path("name") name: String): ApiProfileResponse

    @GET("api/get-profile-by-uuid/{uuid}")
    suspend fun getProfileByUuid(@Path("uuid") uuid: String): ApiProfileResponse

    @POST("api/upload-photo")
    suspend fun uploadPhoto(@Body request: PhotoUploadRequest): PhotoUploadResponse

    @POST("api/upload-stop-photo")
    suspend fun uploadStopPhoto(@Body request: StopPhotoUploadRequest): StopPhotoUploadResponse
}
