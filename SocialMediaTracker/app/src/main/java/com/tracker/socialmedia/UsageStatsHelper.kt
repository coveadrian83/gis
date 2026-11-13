package com.tracker.socialmedia

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import java.util.Calendar

/**
 * Data class holding the usage result for a single app.
 */
data class AppUsageInfo(
    val packageName: String,
    val appName: String,
    val totalTimeMillis: Long
) {
    /** Formats total time as "Xh Ym" or "Ym" if less than 1 hour, "< 1 min" if trivial. */
    fun formattedTime(): String {
        val totalSeconds = totalTimeMillis / 1000
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60

        return when {
            totalTimeMillis <= 0L -> "0 min"
            hours > 0 -> "${hours}h ${minutes}m"
            minutes > 0 -> "${minutes} min"
            else -> "< 1 min"
        }
    }
}

object UsageStatsHelper {

    private const val FACEBOOK_PKG = "com.facebook.katana"
    private const val WHATSAPP_PKG = "com.whatsapp"

    /**
     * Returns true if the app has been granted the PACKAGE_USAGE_STATS permission.
     */
    fun hasUsageStatsPermission(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /**
     * Queries UsageEvents from midnight today until now for Facebook and WhatsApp,
     * accumulates foreground time for each, and returns the results.
     *
     * Using UsageEvents (rather than UsageStats.totalTimeInForeground) gives accurate
     * per-day figures because UsageStats buckets can span midnight boundaries.
     */
    fun getTodayUsage(context: Context): List<AppUsageInfo> {
        val usageStatsManager =
            context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        // Range: today at 00:00:00.000 → now
        val startOfDay = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val now = System.currentTimeMillis()

        val targetPackages = setOf(FACEBOOK_PKG, WHATSAPP_PKG)

        // Map from packageName → accumulated foreground milliseconds
        val foregroundTime = mutableMapOf<String, Long>()
        // Map from packageName → timestamp of last ACTIVITY_RESUMED event (open session)
        val sessionStart = mutableMapOf<String, Long>()

        targetPackages.forEach { foregroundTime[it] = 0L }

        val usageEvents: UsageEvents = usageStatsManager.queryEvents(startOfDay, now)
        val event = UsageEvents.Event()

        while (usageEvents.hasNextEvent()) {
            usageEvents.getNextEvent(event)
            val pkg = event.packageName ?: continue
            if (pkg !in targetPackages) continue

            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    // Mark the start of a foreground session (only if no session already open)
                    if (sessionStart[pkg] == null) {
                        sessionStart[pkg] = event.timeStamp
                    }
                }

                UsageEvents.Event.ACTIVITY_PAUSED,
                UsageEvents.Event.ACTIVITY_STOPPED -> {
                    val start = sessionStart.remove(pkg)
                    if (start != null) {
                        val elapsed = event.timeStamp - start
                        if (elapsed > 0) {
                            foregroundTime[pkg] = (foregroundTime[pkg] ?: 0L) + elapsed
                        }
                    }
                }
            }
        }

        // Close any sessions that are still open (app is currently in foreground)
        sessionStart.forEach { (pkg, start) ->
            val elapsed = now - start
            if (elapsed > 0) {
                foregroundTime[pkg] = (foregroundTime[pkg] ?: 0L) + elapsed
            }
        }

        return listOf(
            AppUsageInfo(
                packageName = FACEBOOK_PKG,
                appName = "Facebook",
                totalTimeMillis = foregroundTime[FACEBOOK_PKG] ?: 0L
            ),
            AppUsageInfo(
                packageName = WHATSAPP_PKG,
                appName = "WhatsApp",
                totalTimeMillis = foregroundTime[WHATSAPP_PKG] ?: 0L
            )
        )
    }
}
