package expo.modules.supforegroundservice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps the app process (and with it the BLE stream + JS session tracking)
 * alive while a posture session runs in the background. Without a foreground
 * service Android freezes or kills the process a few minutes after it's
 * backgrounded, and Doze cuts its network so Supabase writes fail too.
 *
 * Started/stopped from IMUContext via SupForegroundServiceModule.
 */
class PostureTrackingService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null

  // Latest text from JS, so a notification the user swipes away can be put
  // back exactly as it was (see ACTION_REPOST / setDeleteIntent below).
  private var lastTitle: String? = null
  private var lastBody: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val repost = intent?.action == ACTION_REPOST
    if (repost) {
      // The user swiped the notification away (Android 13+ allows that for
      // foreground services). Put it straight back while the session runs. A
      // fresh instance (no text yet) means the service had already stopped:
      // don't let a late dismissal start it again.
      if (lastTitle == null) {
        stopSelf(startId)
        return START_NOT_STICKY
      }
    } else {
      lastTitle = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
      lastBody  = intent?.getStringExtra(EXTRA_BODY) ?: DEFAULT_BODY
    }
    val title = lastTitle ?: DEFAULT_TITLE
    val body  = lastBody ?: DEFAULT_BODY

    ensureChannel()

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    } else {
      0
    }
    val notification = buildNotification(title, body)
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    // After a dismissal, also post it directly so it reappears straight away.
    if (repost) getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)

    // BLE packets wake the CPU, but JS timers (SHS/CPL ticks, snapshots) can
    // stall between them with the screen off. Capped so a missed stop() can
    // never drain the battery indefinitely.
    if (wakeLock?.isHeld != true) {
      val pm = getSystemService(POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sup:posture-tracking").apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_TIMEOUT_MS)
      }
    }

    // If the process is killed the JS session is gone with it — don't let
    // Android restart an empty service.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
      description = "shown while s'up is tracking a posture session"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, body: String) =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(launchIntent())
      .setDeleteIntent(repostIntent())
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()

  // Tapping the notification brings the app back to the front
  private fun launchIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this, 0, launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  // Sent by Android when the user dismisses the notification → re-posted in onStartCommand.
  private fun repostIntent(): PendingIntent =
    PendingIntent.getService(
      this, REQUEST_REPOST,
      Intent(this, PostureTrackingService::class.java).setAction(ACTION_REPOST),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

  // Same icon expo-notifications uses when one is configured, else the app icon
  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY  = "body"
    const val ACTION_REPOST = "expo.modules.supforegroundservice.REPOST"
    private const val REQUEST_REPOST = 1

    private const val CHANNEL_ID      = "sup-posture-tracking"
    private const val CHANNEL_NAME    = "posture tracking"
    private const val NOTIFICATION_ID = 4107
    private const val DEFAULT_TITLE   = "s'up is tracking your posture"
    private const val DEFAULT_BODY    = "your s'pots are connected"
    private const val WAKE_LOCK_TIMEOUT_MS = 12 * 60 * 60 * 1000L
  }
}
