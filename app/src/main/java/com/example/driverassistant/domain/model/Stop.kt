package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(
    tableName = "stops",
    foreignKeys = [
        ForeignKey(
            entity = Tour::class,
            parentColumns = ["id"],
            childColumns = ["tourId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["tourId"])]
)
data class Stop(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    @SerializedName("tour_id") val tourId: Long,
    val address: String,
    val recipient: String = "",
    val street: String = "",
    @SerializedName("house_number") val houseNumber: String = "",
    @SerializedName("postal_code") val postalCode: String = "",
    val city: String = "",
    @SerializedName("address_full") val addressFull: String = "",
    @SerializedName("contact_name") val contactName: String,
    @SerializedName("phone_number") val phoneNumber: String,
    val email: String,
    @SerializedName("time_window") val timeWindow: String,
    @SerializedName("stop_date") val stopDate: Long? = null,
    val notes: String = "",
    @SerializedName("alternative_names") val alternativeNames: String? = null, // JSON list of potential names
    @SerializedName("order_index") val orderIndex: Int,
    val latitude: Double? = null,
    val longitude: Double? = null,
    @SerializedName("is_completed") val isCompleted: Boolean = false,
    @SerializedName("stop_type") val stopType: String = "DELIVERY", // DELIVERY, PICKUP, HOTEL, DEPOT
    @SerializedName("arrival_time") val arrivalTime: Long? = null,
    @SerializedName("photo_url") val photoUrl: String? = null,
    @SerializedName("room_number") val roomNumber: String = "",
    @SerializedName("entry_code") val entryCode: String = "",
    @SerializedName("booking_number") val bookingNumber: String = "",
    @SerializedName("deleted_at") val deletedAt: Long? = null,
    @SerializedName("updated_at") val updatedAt: Long? = null
)
