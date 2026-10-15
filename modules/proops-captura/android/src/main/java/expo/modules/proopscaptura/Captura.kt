package expo.modules.proopscaptura

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * A fila local das notificações capturadas. O serviço grava; o JS lê, envia ao agente e remove o que
 * o agente aceitou. Nada aqui fala com a rede: sem token no nativo (spec, decisão 5).
 */
object Captura {
  private const val PREFS = "proops_captura"
  private const val ARQUIVO = "captura-pendentes.json"
  private const val TAG = "ProOpsCaptura"
  // ponytail: teto da fila local; passou disso, as mais antigas saem (o app ficou semanas fechado)
  private const val MAX_PENDENTES = 200

  /** `take` pode partir um par substituto (emoji) ao meio, e o JSON inválido travaria a fila inteira. */
  private fun String.cortar(n: Int): String {
    val t = take(n)
    return if (t.isNotEmpty() && t.length == n && t.last().isHighSurrogate()) t.dropLast(1) else t
  }

  private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun ativa(ctx: Context): Boolean = prefs(ctx).getBoolean("ativa", false)
  fun pacotes(ctx: Context): Set<String> = prefs(ctx).getStringSet("pacotes", emptySet()) ?: emptySet()
  /** O usuário (id do Supabase) de quem é a captura ligada; null = configuração de uma versão sem dono. */
  fun dono(ctx: Context): String? = prefs(ctx).getString("dono", null)?.takeIf { it.isNotBlank() }

  /**
   * `dono` é quem está logado ao ligar. A fila é DELE: o que estava na fila de outro dono sai aqui sem
   * ser enviado, e o item sem dono (gravado por uma versão anterior) passa a ser do dono atual para
   * não se perder. Desligar (ou sair da conta) esvazia tudo.
   */
  @Synchronized
  fun configurar(ctx: Context, ativa: Boolean, pacotes: List<String>, dono: String?) {
    val novos = pacotes.toSet()
    val novoDono = dono?.takeIf { it.isNotBlank() }
    prefs(ctx).edit().putBoolean("ativa", ativa).putStringSet("pacotes", novos)
      .putString("dono", if (ativa) novoDono else null).commit()
    // Arquivo ilegível agora (E/S): a configuração vale, a fila em disco não é tocada (o JS também descarta
    // sem enviar o que tem dono diferente).
    val fila = ler(ctx) ?: return
    val restante = if (!ativa) emptyList() else fila
      .filter { it.optString("package") in novos }
      .filter { novoDono == null || it.optString("dono").isBlank() || it.optString("dono") == novoDono }
      .onEach { if (novoDono != null && it.optString("dono").isBlank()) it.put("dono", novoDono) }
    // desligou a captura: esvazia; desligou só um banco: tira da fila o que era dele
    guardar(ctx, restante)
  }

  @Synchronized
  fun registrar(ctx: Context, sbn: StatusBarNotification) {
    if (!ativa(ctx) || sbn.packageName !in pacotes(ctx)) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val ex = n.extras ?: return
    val titulo = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().cortar(200)
    val texto = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString().orEmpty().cortar(1000)
    if (texto.isBlank()) return
    // ponytail: a mesma notificação reposta em até 5 min é uma só; duas compras idênticas na mesma
    // janela também viram uma (raro; a pessoa lança a segunda à mão)
    val id = sha256("${sbn.packageName}|$titulo|$texto|${sbn.postTime / 300_000}")
    // Arquivo ilegível agora (E/S): perde ESTA notificação, nunca a fila que está em disco.
    val atuais = ler(ctx) ?: return
    if (atuais.any { it.optString("id") == id }) return
    val nova = JSONObject()
      .put("id", id).put("package", sbn.packageName).put("title", titulo)
      .put("text", texto).put("posted_at", sbn.postTime)
    dono(ctx)?.let { nova.put("dono", it) }
    guardar(ctx, (atuais + nova).takeLast(MAX_PENDENTES))
  }

  /** Vazio quando o arquivo não pôde ser lido: o JS tenta de novo na próxima abertura. */
  @Synchronized
  fun pendentes(ctx: Context): List<JSONObject> = ler(ctx) ?: emptyList()

  @Synchronized
  fun remover(ctx: Context, ids: Set<String>) {
    val atuais = ler(ctx) ?: return
    guardar(ctx, atuais.filter { it.optString("id") !in ids })
  }

  private fun arquivo(ctx: Context) = File(ctx.filesDir, ARQUIVO)

  /**
   * A fila em disco, ou null se não deu para ler (E/S): quem chama NÃO escreve nada por cima, porque o
   * arquivo continua bom. Arquivo corrompido (JSON inválido) é MOVIDO para `<arquivo>.corrompido` e a fila
   * recomeça vazia — nunca é sobrescrito em silêncio.
   */
  private fun ler(ctx: Context): List<JSONObject>? {
    val f = arquivo(ctx)
    if (!f.exists()) return emptyList()
    val texto = try {
      f.readText()
    } catch (e: IOException) {
      Log.w(TAG, "não consegui ler a fila", e)
      return null
    }
    return try {
      val arr = JSONArray(texto)
      (0 until arr.length()).map { arr.getJSONObject(it) }
    } catch (e: JSONException) {
      preservarCorrompido(ctx, f)
      emptyList()
    }
  }

  private fun preservarCorrompido(ctx: Context, f: File) {
    var destino = File(ctx.filesDir, "$ARQUIVO.corrompido")
    // um corrompido anterior continua guardado: o novo ganha o carimbo da hora
    if (destino.exists()) destino = File(ctx.filesDir, "$ARQUIVO.corrompido.${System.currentTimeMillis()}")
    if (!f.renameTo(destino)) Log.w(TAG, "não consegui preservar a fila corrompida")
    else Log.w(TAG, "fila corrompida preservada em ${destino.name}")
  }

  /** Escreve e dá fsync no temporário ANTES do rename: queda de energia não deixa arquivo vazio no lugar da fila. */
  private fun gravar(ctx: Context, itens: List<JSONObject>) {
    val tmp = File(ctx.filesDir, "$ARQUIVO.tmp")
    FileOutputStream(tmp).use { saida ->
      saida.write(JSONArray(itens).toString().toByteArray(Charsets.UTF_8))
      saida.flush()
      saida.fd.sync()
    }
    if (!tmp.renameTo(arquivo(ctx))) throw IOException("rename da fila falhou")
  }

  /** `gravar` sem derrubar o serviço: falhar aqui perde a escrita desta vez, a fila anterior segue em disco. */
  private fun guardar(ctx: Context, itens: List<JSONObject>) {
    try {
      gravar(ctx, itens)
    } catch (e: IOException) {
      Log.w(TAG, "não consegui gravar a fila", e)
    }
  }

  private fun sha256(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
