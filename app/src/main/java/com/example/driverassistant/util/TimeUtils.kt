package com.example.driverassistant.util

import java.util.Locale

object TimeUtils {

    data class DurationInfo(
        val totalSeconds: Long,
        val nextBreakInSeconds: Long?,
        val breakCount: Int
    )

    /**
     * Formats seconds into "d nap, HH:mm" or "HH:mm"
     */
    fun formatDuration(seconds: Long): String {
        if (seconds <= 0) return "0:00"
        
        val totalMinutes = (seconds + 30) / 60 // Round to nearest minute
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        val days = hours / 24
        val remainingHours = hours % 24
        
        return if (days > 0) {
            String.format(Locale.getDefault(), "%d nap, %d:%02d", days, remainingHours, minutes)
        } else {
            String.format(Locale.getDefault(), "%d:%02d", remainingHours, minutes)
        }
    }
    
    /**
     * Calculates duration info including mandatory rests if requested.
     */
    fun calculateDurationInfo(
        pureDrivingSeconds: Long, 
        drivingDoneTodaySeconds: Long,
        includeRests: Boolean
    ): DurationInfo {
        if (pureDrivingSeconds <= 0) return DurationInfo(0, null, 0)
        if (!includeRests) return DurationInfo(pureDrivingSeconds, null, 0)
        
        var totalSeconds = pureDrivingSeconds
        val blockSize = 4.5 * 3600 // 16200 seconds
        val restSize = 45 * 60 // 2700 seconds
        
        val currentBlockProgress = drivingDoneTodaySeconds % blockSize.toLong()
        val remainingInBlock = blockSize.toLong() - currentBlockProgress
        
        var breakCount = 0
        var nextBreakIn: Long? = null

        if (pureDrivingSeconds > remainingInBlock) {
            // First rest
            totalSeconds += restSize
            breakCount++
            nextBreakIn = remainingInBlock
            
            val leftAfterFirstRest = pureDrivingSeconds - remainingInBlock
            val additionalBreaks = (leftAfterFirstRest / blockSize.toLong()).toInt()
            totalSeconds += additionalBreaks * restSize
            breakCount += additionalBreaks
        }
        
        // Simple daily limit: if total driving exceeds 9h, add 11h rest
        if (drivingDoneTodaySeconds + pureDrivingSeconds > 9 * 3600) {
            totalSeconds += 11 * 3600
            breakCount++
            val remainingToDaily = (9 * 3600) - drivingDoneTodaySeconds
            if (nextBreakIn == null || remainingToDaily < nextBreakIn) {
                nextBreakIn = if (remainingToDaily > 0) remainingToDaily else 0
            }
        }
        
        return DurationInfo(totalSeconds, nextBreakIn, breakCount)
    }

    // Deprecated but kept for compatibility during migration if needed
    fun calculateAdjustedDuration(pureDrivingSeconds: Long, drivingDoneTodaySeconds: Long): Long {
        return calculateDurationInfo(pureDrivingSeconds, drivingDoneTodaySeconds, true).totalSeconds
    }
}
