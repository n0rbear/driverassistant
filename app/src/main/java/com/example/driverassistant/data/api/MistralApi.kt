package com.example.driverassistant.data.api

import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class MistralMessage(
    val role: String,
    val content: String
)

data class MistralRequest(
    val model: String = "mistral-tiny",
    val messages: List<MistralMessage>,
    val temperature: Double = 0.7
)

data class MistralChoice(
    val message: MistralMessage
)

data class MistralResponse(
    val choices: List<MistralChoice>
)

interface MistralApi {
    @POST("v1/chat/completions")
    suspend fun chat(
        @Header("Authorization") authHeader: String,
        @Body request: MistralRequest
    ): MistralResponse
}
