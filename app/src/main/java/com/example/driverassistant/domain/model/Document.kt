package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "documents")
data class Document(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val driverName: String = "Ismeretlen",
    val name: String,
    val filePath: String,
    val type: String, // CMR, POD, Fuvarlevél, Hotel, Egyéb
    val timestamp: Long,
    val fileExtension: String // PDF, PNG, JPG
)
