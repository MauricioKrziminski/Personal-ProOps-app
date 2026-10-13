package expo.modules.proopscaptura

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class CapturaService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      Captura.registrar(applicationContext, sbn)
    } catch (e: Exception) {
      Log.w("ProOpsCaptura", "não consegui registrar a notificação", e)
    }
  }
}
