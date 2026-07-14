package com.example.driverassistant.util

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

object FileUtils {
    fun getTempUri(context: Context): Uri {
        val directory = File(context.getExternalFilesDir("Pictures"), "ai_uploads")
        if (!directory.exists()) directory.mkdirs()
        val tempFile = File.createTempFile("IMG_${System.currentTimeMillis()}", ".jpg", directory)
        return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", tempFile)
    }

    fun saveBitmap(context: Context, bitmap: Bitmap, folderName: String): String? {
        val directory = File(context.filesDir, folderName)
        if (!directory.exists()) directory.mkdirs()
        
        val fileName = "IMG_${System.currentTimeMillis()}.jpg"
        val file = File(directory, fileName)
        
        return try {
            val out = FileOutputStream(file)
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            out.flush()
            out.close()
            file.absolutePath
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun saveUri(context: Context, uri: Uri, folderName: String): String? {
        val directory = File(context.filesDir, folderName)
        if (!directory.exists()) directory.mkdirs()
        
        val extension = context.contentResolver.getType(uri)?.split("/")?.lastOrNull() ?: "bin"
        val fileName = "DOC_${System.currentTimeMillis()}.$extension"
        val file = File(directory, fileName)
        
        return try {
            val inputStream: InputStream? = context.contentResolver.openInputStream(uri)
            val outputStream = FileOutputStream(file)
            inputStream?.copyTo(outputStream)
            inputStream?.close()
            outputStream.close()
            file.absolutePath
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun saveBitmapToUri(context: Context, bitmap: Bitmap, folderName: String): Uri? {
        val path = saveBitmap(context, bitmap, folderName)
        return if (path != null) Uri.fromFile(File(path)) else null
    }
}
