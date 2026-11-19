package expo.modules.supforegroundservice

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SupForegroundServiceModule : Module() {

  // Keep-alive headless JS task, held for as long as the service runs.
  // React Native pauses JS timers (setInterval/setTimeout) once the activity
  // is paused UNLESS a headless task is active — the foreground service alone
  // keeps the process and BLE events alive, but not the session's timers.
  private var keepAliveTaskId: Int? = null

  override fun definition() = ModuleDefinition {
    Name("SupForegroundService")

    // Safe to call repeatedly — a running service just refreshes its
    // notification. Throws (as a JS error) if Android refuses to start a
    // foreground service from the background (Android 12+).
    Function("start") { title: String, body: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val intent = Intent(context, PostureTrackingService::class.java)
        .putExtra(PostureTrackingService.EXTRA_TITLE, title)
        .putExtra(PostureTrackingService.EXTRA_BODY, body)
      ContextCompat.startForegroundService(context, intent)
      startKeepAliveTask()
    }

    Function("stop") {
      finishKeepAliveTask()
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, PostureTrackingService::class.java))
      }
    }

    OnDestroy { finishKeepAliveTask() }
  }

  private fun startKeepAliveTask() {
    val reactContext = appContext.reactContext as? ReactContext ?: return
    // startTask must run on the UI thread
    UiThreadUtil.runOnUiThread {
      val tasks = HeadlessJsTaskContext.getInstance(reactContext)
      if (keepAliveTaskId?.let { tasks.isTaskRunning(it) } == true) return@runOnUiThread
      keepAliveTaskId = tasks.startTask(
        HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true)
      )
    }
  }

  private fun finishKeepAliveTask() {
    val reactContext = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      val id = keepAliveTaskId ?: return@runOnUiThread
      keepAliveTaskId = null
      val tasks = HeadlessJsTaskContext.getInstance(reactContext)
      if (tasks.isTaskRunning(id)) tasks.finishTask(id)
    }
  }

  companion object {
    // Registered in JS by modules/sup-foreground-service/index.ts
    private const val KEEP_ALIVE_TASK = "SupTrackingKeepAlive"
  }
}
