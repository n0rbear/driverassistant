package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(tableName = "tours")
data class Tour(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    @SerializedName("driver_name") val driverName: String = "Ismeretlen",
    val name: String,
    val customer: String = "",
    val date: Long,
    @SerializedName("day_of_week") val dayOfWeek: String? = null,
    val notes: String = "",
    @SerializedName("is_closed") val isClosed: Boolean = false,
    @SerializedName("is_current") val isCurrent: Boolean = false,
    @SerializedName("depot_name") val depotName: String = "",
    @SerializedName("depot_latitude") val depotLatitude: Double? = null,
    @SerializedName("depot_longitude") val depotLongitude: Double? = null,
    @SerializedName("deleted_at") val deletedAt: Long? = null,
    @SerializedName("updated_at") val updatedAt: Long? = null
)
