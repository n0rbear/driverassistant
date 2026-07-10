package com.example.driverassistant.util

import com.example.driverassistant.BuildConfig

object AiAuth {
    fun mistralHeader(): String {
        require(BuildConfig.MISTRAL_API_KEY.isNotBlank()) { "MISTRAL_API_KEY nincs beallitva." }
        return "Bearer ${BuildConfig.MISTRAL_API_KEY}"
    }
}
