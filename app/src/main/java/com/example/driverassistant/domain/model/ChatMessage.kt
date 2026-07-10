package com.example.driverassistant.domain.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chat_messages")
data class ChatMessage(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uuid: String = java.util.UUID.randomUUID().toString(),
    val driverName: String = "Ismeretlen",
    val sender: String,
    val message: String,
    val timestamp: Long,
    val isMe: Boolean
)
