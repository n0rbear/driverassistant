package com.example.driverassistant.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

object IntentUtils {
    fun openMaps(context: Context, address: String) {
        val gmmIntentUri = Uri.parse("geo:0,0?q=${Uri.encode(address)}")
        val mapIntent = Intent(Intent.ACTION_VIEW, gmmIntentUri)
        mapIntent.setPackage("com.google.android.apps.maps")
        if (mapIntent.resolveActivity(context.packageManager) != null) {
            context.startActivity(mapIntent)
        } else {
            // Fallback for any map app
            val fallbackIntent = Intent(Intent.ACTION_VIEW, gmmIntentUri)
            context.startActivity(fallbackIntent)
        }
    }

    fun dialPhoneNumber(context: Context, phoneNumber: String) {
        val intent = Intent(Intent.ACTION_DIAL).apply {
            data = Uri.parse("tel:$phoneNumber")
        }
        context.startActivity(intent)
    }

    fun sendEmail(context: Context, email: String) {
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:")
            putExtra(Intent.EXTRA_EMAIL, arrayOf(email))
            putExtra(Intent.EXTRA_SUBJECT, "Driver Assistant üzenet")
        }
        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Nincs e-mail kliens telepítve", Toast.LENGTH_SHORT).show()
        }
    }
}
