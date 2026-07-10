package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "saved_locations")
data class SavedLocation(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val name: String, // Home, Base, Hotel
    val address: String,
    val latitude: Double,
    val longitude: Double,
    val type: String // HOME, BASE, HOTEL
)
