package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "costs")
data class Cost(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val driverName: String = "Ismeretlen",
    val amount: Double,
    val currency: String,
    val category: String, // Hotel, Parkolás, Matrica, Útdíj, Tankolás, Egyéb
    val notes: String = "",
    val photoPath: String? = null,
    val status: String = "Rögzítve", // Rögzítve, Beküldve, Elfogadva, Kifizetve
    val timestamp: Long,
    val mileage: Int? = null
)
