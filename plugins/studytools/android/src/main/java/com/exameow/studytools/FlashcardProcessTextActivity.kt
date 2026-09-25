package com.exameow.studytools

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class FlashcardProcessTextActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val selected = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.trim().orEmpty()
    if (selected.isNotEmpty()) {
      getSharedPreferences("exameow_studytools", MODE_PRIVATE).edit()
        .putString("selected_text", selected.take(4000)).apply()
      packageManager.getLaunchIntentForPackage(packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        startActivity(this)
      }
    }
    finish()
  }
}
