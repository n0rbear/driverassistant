package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "customer_mappings")
data class CustomerMapping(
    @PrimaryKey val customerName: String,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val nameIndexToPick: Int // e.g. 0 for first, 1 for second name in potentialNames
)
