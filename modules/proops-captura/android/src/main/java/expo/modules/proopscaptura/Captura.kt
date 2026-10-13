package expo.modules.proopscaptura

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * A fila local das notificações capturadas. O serviço grava; o JS lê, envia ao agente e remove o que
 * o agente aceitou. Nada aqui fala com a rede: sem token no nativo (spec, decisão 5).
 */
object Captura {
  private const val PREFS = "proops_captura"
  private const val ARQUIVO = "captura-pendentes.json"
  // ponytail: teto da fila local; passou disso, as mais antigas saem (o app ficou semanas fechado)
  private const val MAX_PENDENTES = 200

  private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun ativa(ctx: Context): Boolean = prefs(ctx).getBoolean("ativa", false)
  fun pacotes(ctx: Context): Set<String> = prefs(ctx).getStringSet("pacotes", emptySet()) ?: emptySet()

  fun configurar(ctx: Context, ativa: Boolean, pacotes: List<String>) {
    prefs(ctx).edit().putBoolean("ativa", ativa).putStringSet("pacotes", pacotes.toSet()).apply()
    if (!ativa) gravar(ctx, emptyList())
  }

  @Synchronized
  fun registrar(ctx: Context, sbn: StatusBarNotification) {
    if (!ativa(ctx) || sbn.packageName !in pacotes(ctx)) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val ex = n.extras ?: return
    val titulo = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().take(200)
    val texto = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString().orEmpty().take(1000)
    if (texto.isBlank()) return
    // ponytail: a mesma notificação reposta em até 5 min é uma só; duas compras idênticas na mesma
    // janela também viram uma (raro; a pessoa lança a segunda à mão)
    val id = sha256("${sbn.packageName}|$titulo|$texto|${sbn.postTime / 300_000}")
    val atuais = ler(ctx)
    if (atuais.any { it.optString("id") == id }) return
    val nova = JSONObject()
      .put("id", id).put("package", sbn.packageName).put("title", titulo)
      .put("text", texto).put("posted_at", sbn.postTime)
    gravar(ctx, (atuais + nova).takeLast(MAX_PENDENTES))
  }

  @Synchronized
  fun pendentes(ctx: Context): List<JSONObject> = ler(ctx)

  @Synchronized
  fun remover(ctx: Context, ids: Set<String>) {
    gravar(ctx, ler(ctx).filter { it.optString("id") !in ids })
  }

  private fun arquivo(ctx: Context) = File(ctx.filesDir, ARQUIVO)

  private fun ler(ctx: Context): List<JSONObject> {
    val f = arquivo(ctx)
    if (!f.exists()) return emptyList()
    return try {
      val arr = JSONArray(f.readText())
      (0 until arr.length()).map { arr.getJSONObject(it) }
    } catch (e: Exception) {
      emptyList() // arquivo corrompido: recomeça vazio em vez de travar a captura
    }
  }

  private fun gravar(ctx: Context, itens: List<JSONObject>) {
    val tmp = File(ctx.filesDir, "$ARQUIVO.tmp")
    tmp.writeText(JSONArray(itens).toString())
    tmp.renameTo(arquivo(ctx))
  }

  private fun sha256(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
