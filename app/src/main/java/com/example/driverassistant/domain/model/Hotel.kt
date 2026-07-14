package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.google.gson.annotations.SerializedName

@Entity(tableName = "hotels")
data class Hotel(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    @SerializedName("driver_name")
    val driverName: String = "Ismeretlen",
    val name: String,
    val address: String,
    @SerializedName("room_number")
    val roomNumber: String,
    @SerializedName("entry_code")
    val entryCode: String,
    @SerializedName("booking_number")
    val bookingNumber: String = "",
    @SerializedName("phone_number")
    val phoneNumber: String,
    val email: String,
    val notes: String = "",
    val timestamp: Long
)
