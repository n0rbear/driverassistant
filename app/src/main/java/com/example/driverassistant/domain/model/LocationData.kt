package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "location_history")
data class LocationData(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val latitude: Double,
    val longitude: Double,
    val timestamp: Long,
    val speed: Float = 0f
)
