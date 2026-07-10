package com.example.driverassistant.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.driverassistant.data.api.ApiChatMessage
import com.example.driverassistant.data.api.BackendApi
import com.example.driverassistant.domain.model.ChatMessage
import com.example.driverassistant.domain.repository.DriverRepository
import com.example.driverassistant.util.NotificationUtils
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repository: DriverRepository,
    private val backendApi: BackendApi,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val prefs = context.getSharedPreferences("driver_prefs", Context.MODE_PRIVATE)
    private val driverName get() = prefs.getString("driver_name", "Ismeretlen") ?: "Ismeretlen"

    val messages = repository.getAllMessages(driverName)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        pollMessages()
    }

    private fun pollMessages() {
        viewModelScope.launch {
            while (true) {
                try {
                    val apiMessages = backendApi.getMessages(driverName)
                    apiMessages.forEach { apiMsg ->
                        val allLocal = messages.value
                        val exists = allLocal.any { (apiMsg.uuid != null && it.uuid == apiMsg.uuid) || (it.message == apiMsg.message && it.timestamp == apiMsg.timestamp) }
                        if (!exists) {
                            val isMe = apiMsg.sender == driverName
                            repository.insertMessage(
                                ChatMessage(
                                    uuid = apiMsg.uuid ?: java.util.UUID.randomUUID().toString(),
                                    driverName = driverName,
                                    sender = apiMsg.sender,
                                    message = apiMsg.message,
                                    timestamp = apiMsg.timestamp,
                                    isMe = isMe
                                )
                            )
                            // Értesítés, ha nem én küldtem és a küldő diszpécser/főnök
                            if (!isMe && (apiMsg.sender == "DISZPÉCSER" || apiMsg.sender == "FŐNÖK")) {
                                NotificationUtils.showSimpleNotification(
                                    context,
                                    "Új üzenet: ${apiMsg.sender}",
                                    apiMsg.message
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                }
                delay(5000) 
            }
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            // Helyi mentés azonnal, hogy ne várjunk a szerverre
            val localMsg = ChatMessage(
                driverName = driverName,
                sender = driverName,
                message = text,
                timestamp = now,
                isMe = true
            )
            repository.insertMessage(localMsg)
            
            try {
                backendApi.sendMessage(
                    ApiChatMessage(
                        uuid = localMsg.uuid,
                        driverName = driverName,
                        sender = driverName,
                        message = text,
                        timestamp = now
                    )
                )
            } catch (e: Exception) {
                // Hiba esetén jelezhetnénk, de a helyi db-ben megmarad
            }
        }
    }
}
