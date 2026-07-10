package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "hotels")
data class Hotel(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val driverName: String = "Ismeretlen",
    val name: String,
    val address: String,
    val roomNumber: String,
    val entryCode: String,
    val bookingNumber: String = "",
    val phoneNumber: String,
    val email: String,
    val notes: String = "",
    val timestamp: Long
)
