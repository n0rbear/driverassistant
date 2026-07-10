package com.example.driverassistant.util

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.tasks.await

object OCRUtils {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    suspend fun extractTextFromUri(context: Context, uri: Uri): String {
        return try {
            val image = InputImage.fromFilePath(context, uri)
            val result = recognizer.process(image).await()
            
            // Koordináták alapján rendezzük a sorokat
            val allLines = result.textBlocks.flatMap { it.lines }
                .sortedWith(compareBy({ it.boundingBox?.top ?: 0 }, { it.boundingBox?.left ?: 0 }))
            
            val structuredText = StringBuilder()
            structuredText.append("<document>\n")
            var currentY = -1
            var lastX = -1
            val threshold = 25 
            
            allLines.forEach { line ->
                val box = line.boundingBox ?: return@forEach
                val top = box.top
                val left = box.left
                val height = box.height()
                
                // Vízszintes elválasztó érzékelése nagy rés esetén
                if (currentY != -1 && (top - (currentY + 20)) > 60) {
                    structuredText.append("</row>\n<separator type=\"horizontal\" />\n")
                    currentY = -1
                }

                if (currentY == -1 || Math.abs(top - currentY) > threshold) {
                    if (currentY != -1) structuredText.append("</row>\n")
                    structuredText.append("<row y=\"$top\">")
                    currentY = top
                    lastX = -1
                }

                // Függőleges rés (oszlop) érzékelése
                if (lastX != -1 && (left - lastX) > 80) {
                    structuredText.append("<v-gap width=\"${left - lastX}\" />")
                }
                
                structuredText.append("<text x=\"$left\" size=\"$height\">${line.text}</text>")
                lastX = left + box.width()
            }
            if (currentY != -1) structuredText.append("</row>\n")
            structuredText.append("</document>")
            
            structuredText.toString()
        } catch (e: Exception) {
            "OCR hiba: ${e.message}"
        }
    }
}
