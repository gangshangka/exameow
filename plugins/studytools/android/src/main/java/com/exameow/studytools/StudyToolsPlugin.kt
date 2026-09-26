package com.exameow.studytools

import android.app.Activity
import android.app.AppOpsManager
import android.app.usage.UsageEvents
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
import java.util.Calendar
import java.util.Date
import java.util.Locale

@InvokeArg
class UsageArgs { var days: Int = 7 }

@TauriPlugin
class StudyToolsPlugin(private val activity: Activity) : Plugin(activity) {
  private fun todayEvents(manager: UsageStatsManager, start: Long, now: Long): Map<String, Long> {
    val totals = mutableMapOf<String, Long>()
    val events = manager.queryEvents(start, now) ?: return totals
    val event = UsageEvents.Event()
    var activePackage: String? = null
    var activeSince = start
    fun closeActive(at: Long) {
      val pkg = activePackage ?: return
      totals[pkg] = (totals[pkg] ?: 0L) + (at - activeSince).coerceAtLeast(0L)
      activePackage = null
    }
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      when (event.eventType) {
        UsageEvents.Event.MOVE_TO_FOREGROUND -> {
          val pkg = event.packageName ?: continue
          if (pkg != activePackage) {
            closeActive(event.timeStamp)
            activePackage = pkg
            activeSince = event.timeStamp
          }
        }
        UsageEvents.Event.MOVE_TO_BACKGROUND -> if (event.packageName == activePackage) closeActive(event.timeStamp)
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> closeActive(event.timeStamp)
      }
    }
    closeActive(now)
    return totals
  }

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
        // Calendar days in the device timezone, including today. A rolling 24-hour
        // window can include part of an extra day and makes "today" ambiguous.
        val start = Calendar.getInstance().apply {
          set(Calendar.HOUR_OF_DAY, 0)
          set(Calendar.MINUTE, 0)
          set(Calendar.SECOND, 0)
          set(Calendar.MILLISECOND, 0)
          add(Calendar.DAY_OF_YEAR, 1 - days)
        }.timeInMillis
        val manager = activity.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val today = formatter.format(Date(now))
        val todayStart = Calendar.getInstance().apply {
          set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
          set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val totals = mutableMapOf<Pair<String, String>, Long>()
        for (entry in manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now).orEmpty()) {
          if (entry.totalTimeInForeground <= 0 || entry.lastTimeStamp <= start) continue
          // The beginning of a returned bucket can precede our requested range.
          // Its ending timestamp identifies the calendar day represented here.
          val date = formatter.format(Date(entry.lastTimeStamp - 1))
          val key = entry.packageName to date
          totals[key] = maxOf(totals[key] ?: 0L, entry.totalTimeInForeground)
        }
        // The current day's aggregate can lag behind foreground transitions.
        // Recent usage events include the app that is still open right now.
        for ((pkg, duration) in todayEvents(manager, todayStart, now)) {
          val key = pkg to today
          totals[key] = maxOf(totals[key] ?: 0L, duration)
        }
        val apps = JSONArray()
        for ((key, duration) in totals) {
          val (packageName, date) = key
          if (duration <= 0) continue
          val label = try {
            activity.packageManager.getApplicationLabel(
              activity.packageManager.getApplicationInfo(packageName, 0)
            ).toString()
          } catch (_: Exception) { packageName }
          apps.put(JSObject().apply {
            put("packageName", packageName)
            put("label", label)
            put("minutes", duration / 60_000.0)
            put("date", date)
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
