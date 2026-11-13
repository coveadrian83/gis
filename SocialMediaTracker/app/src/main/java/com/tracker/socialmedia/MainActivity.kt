package com.tracker.socialmedia

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.tracker.socialmedia.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val dateFormatter = SimpleDateFormat("EEEE, d MMMM yyyy", Locale("ro", "RO"))
    private val timeFormatter = SimpleDateFormat("HH:mm:ss", Locale("ro", "RO"))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupClickListeners()

        // Show today's date
        binding.tvDate.text = dateFormatter.format(Date())
    }

    override fun onResume() {
        super.onResume()
        // Refresh every time the app comes to the foreground (e.g. after returning
        // from the Usage Access settings screen).
        checkPermissionAndRefresh()
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private fun setupClickListeners() {
        binding.btnRefresh.setOnClickListener {
            checkPermissionAndRefresh()
        }

        binding.btnOpenSettings.setOnClickListener {
            openUsageAccessSettings()
        }
    }

    private fun checkPermissionAndRefresh() {
        if (UsageStatsHelper.hasUsageStatsPermission(this)) {
            showMainContent()
            loadUsageData()
        } else {
            showPermissionRequired()
        }
    }

    private fun showMainContent() {
        binding.layoutPermission.visibility = View.GONE
        binding.layoutContent.visibility = View.VISIBLE
    }

    private fun showPermissionRequired() {
        binding.layoutPermission.visibility = View.VISIBLE
        binding.layoutContent.visibility = View.GONE
    }

    private fun loadUsageData() {
        val usageList = UsageStatsHelper.getTodayUsage(this)

        // Facebook card
        val facebookInfo = usageList.find { it.packageName == "com.facebook.katana" }
        binding.tvFacebookTime.text = facebookInfo?.formattedTime() ?: "0 min"

        // WhatsApp card
        val whatsappInfo = usageList.find { it.packageName == "com.whatsapp" }
        binding.tvWhatsappTime.text = whatsappInfo?.formattedTime() ?: "0 min"

        // Total combined time
        val totalMillis = usageList.sumOf { it.totalTimeMillis }
        binding.tvTotalTime.text = formatTotalTime(totalMillis)

        // Last updated timestamp
        binding.tvLastUpdated.text = getString(R.string.last_updated, timeFormatter.format(Date()))
    }

    private fun formatTotalTime(millis: Long): String {
        val totalSeconds = millis / 1000
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        return when {
            millis <= 0L -> "0 min"
            hours > 0 -> "${hours}h ${minutes}m"
            minutes > 0 -> "${minutes} min"
            else -> "< 1 min"
        }
    }

    private fun openUsageAccessSettings() {
        try {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        } catch (e: Exception) {
            // Fallback: open generic settings if the specific screen is unavailable
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }
}
