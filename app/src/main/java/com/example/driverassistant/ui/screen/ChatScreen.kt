package com.example.driverassistant.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.driverassistant.ui.viewmodel.ChatViewModel

@Composable
fun ChatScreen(viewModel: ChatViewModel = hiltViewModel()) {
    val messages by viewModel.messages.collectAsState()
    var text by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Automatikus görgetés az utolsó üzenethez, ha új érkezik
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            kotlinx.coroutines.delay(100) // Várjunk egy picit a renderelésre
            listState.scrollToItem(messages.size - 1)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(messages) { msg ->
                ChatMessageItem(msg.sender, msg.message, msg.isMe)
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Üzenet írása...") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    if (text.isNotBlank()) {
                        viewModel.sendMessage(text)
                        text = ""
                    }
                })
            )
            Spacer(modifier = Modifier.width(8.dp))
            IconButton(
                onClick = { 
                    if (text.isNotBlank()) {
                        viewModel.sendMessage(text)
                        text = ""
                    }
                }
            ) {
                Icon(Icons.Default.Send, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
fun ChatMessageItem(sender: String, message: String, isMe: Boolean) {
    val isBoss = sender == "DISZPÉCSER" || sender == "FŐNÖK"
    
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalAlignment = if (isMe) Alignment.End else Alignment.Start
    ) {
        Surface(
            color = when {
                isMe -> MaterialTheme.colorScheme.primaryContainer
                isBoss -> Color(0xFFFFF9C4) // Halványsárga a főnöknek
                else -> MaterialTheme.colorScheme.secondaryContainer
            },
            shape = RoundedCornerShape(12.dp),
            tonalElevation = 2.dp
        ) {
            Column(modifier = Modifier.padding(10.dp)) {
                Text(
                    text = sender, 
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isBoss) Color(0xFFF57F17) else Color.Unspecified,
                    fontWeight = FontWeight.Bold
                )
                Text(text = message, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}
