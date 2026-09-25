package com.exameow.studytools

import android.app.Activity
import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@InvokeArg
class UsageArgs { var days: Int = 7 }

@TauriPlugin
class StudyToolsPlugin(private val activity: Activity) : Plugin(activity) {
  private fun allowed(): Boolean {
    val ops = activity.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    return ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName) == AppOpsManager.MODE_ALLOWED
  }

  @Command fun hasUsageAccess(invoke: Invoke) {
    invoke.resolve(JSObject().apply { put("granted", allowed()) })
  }

  @Command fun openUsageAccessSettings(invoke: Invoke) {
    activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    invoke.resolve()
  }

  @Command fun getUsageStats(invoke: Invoke) {
    if (!allowed()) { invoke.reject("usage_access_required"); return }
    val days = invoke.parseArgs(UsageArgs::class.java).days.coerceIn(1, 30)
    Thread {
      try {
        val now = System.currentTimeMillis()
        val start = now - days * 86_400_000L
        val manager = activity.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val apps = JSONArray()
        for (entry in manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now).orEmpty()) {
          if (entry.totalTimeInForeground <= 0 || entry.lastTimeStamp < start) continue
          val label = try {
            activity.packageManager.getApplicationLabel(
              activity.packageManager.getApplicationInfo(entry.packageName, 0)
            ).toString()
          } catch (_: Exception) { entry.packageName }
          apps.put(JSObject().apply {
            put("packageName", entry.packageName)
            put("label", label)
            put("minutes", entry.totalTimeInForeground / 60_000.0)
            put("date", formatter.format(Date(entry.firstTimeStamp)))
          })
        }
        invoke.resolve(JSObject().apply { put("apps", apps) })
      } catch (error: Exception) { invoke.reject(error.message ?: "usage_query_failed") }
    }.start()
  }

  @Command fun takeSelectedText(invoke: Invoke) {
    val prefs = activity.getSharedPreferences("exameow_studytools", Context.MODE_PRIVATE)
    val text = prefs.getString("selected_text", null)
    prefs.edit().remove("selected_text").apply()
    invoke.resolve(JSObject().apply { put("text", text) })
  }
}
