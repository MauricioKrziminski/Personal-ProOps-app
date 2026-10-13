package expo.modules.proopscaptura

import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProOpsCapturaModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ProOpsCaptura")

    Function("acessoConcedido") {
      val nome = ComponentName(ctx, CapturaService::class.java).flattenToString()
      val ligados = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners").orEmpty()
      ligados.split(":").any { it == nome }
    }

    Function("abrirAjustes") {
      val detalhe = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
          Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
          ComponentName(ctx, CapturaService::class.java).flattenToString(),
        )
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      try {
        ctx.startActivity(detalhe.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: Exception) {
        ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    Function("estado") {
      mapOf("ativa" to Captura.ativa(ctx), "pacotes" to Captura.pacotes(ctx).toList())
    }

    Function("configurar") { ativa: Boolean, pacotes: List<String> ->
      Captura.configurar(ctx, ativa, pacotes)
    }

    Function("pendentes") {
      Captura.pendentes(ctx).map {
        mapOf(
          "id" to it.optString("id"), "package" to it.optString("package"),
          "title" to it.optString("title"), "text" to it.optString("text"),
          "posted_at" to it.optLong("posted_at"),
        )
      }
    }

    Function("remover") { ids: List<String> ->
      Captura.remover(ctx, ids.toSet())
    }
  }
}
