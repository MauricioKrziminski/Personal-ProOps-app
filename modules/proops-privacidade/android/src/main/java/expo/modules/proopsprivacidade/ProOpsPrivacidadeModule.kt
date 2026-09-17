package expo.modules.proopsprivacidade

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Tira o app da foto dos recentes (que o Android também mostra na volta) enquanto a trava estiver
 * ligada. Ver `index.ts`.
 */
class ProOpsPrivacidadeModule : Module() {
  private var ativa = false

  override fun definition() = ModuleDefinition {
    Name("ProOpsPrivacidade")

    Function("definirProtecao") { ativa: Boolean ->
      this@ProOpsPrivacidadeModule.ativa = ativa
      aplicar()
    }

    // A atividade pode ser recriada (troca de tema, rotação): a chave é dela, não do app.
    OnActivityEntersForeground {
      aplicar()
    }
  }

  private fun aplicar() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val atividade = appContext.currentActivity ?: return
    val permitir = !ativa
    atividade.runOnUiThread { atividade.setRecentsScreenshotEnabled(permitir) }
  }
}
