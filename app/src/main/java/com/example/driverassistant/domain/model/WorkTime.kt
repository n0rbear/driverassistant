package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "work_times",
    indices = [Index(value = ["driverName", "startTime"], unique = true)]
)
data class WorkTime(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val driverName: String = "Ismeretlen",
    val type: String, // Munka, Vezetés, Pihenő, Rakodás
    val startTime: Long,
    val endTime: Long? = null,
    val date: String, // yyyy-MM-dd
    val mileage: Int? = null,
    val endMileage: Int? = null,
    val licensePlate: String? = null,
    val notes: String = ""
)
