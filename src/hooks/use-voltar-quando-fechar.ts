import { useState } from 'react';
import { router } from 'expo-router';

/**
 * Formulário que OUTRA TELA abriu tem que devolver para aquela tela quando fecha.
 *
 * ⚠️ **Três telas do app têm formulário dentro de um `Sheet`, e chegar neles de fora é um
 * `push` na tela da LISTA com um parâmetro** (`/finance/recurring?edit=`,
 * `/finance/installments?edit=`, `/finance/debts?create=financing`). Fechando o sheet, a lista
 * fica — e a pessoa é largada numa tela que ela nunca pediu. A queixa foi literal (15/09/2026):
 * *"cliquei em editar a compra inteira e quando eu clico em voltar, ao invés de voltar para a
 * tela onde eu estava, ele me leva para a tela de Parceladas"*.
 *
 * O `push` está certo (é como a pilha sabe voltar); o que faltava era **fechar o formulário
 * fechar também a tela que só existia para hospedá-lo**. Quem abriu a tela pela lista continua
 * na lista: só volta quem veio de fora.
 *
 * Não confundir com o `?edit=` já consumido (`edicaoAberta`), que existe para o sheet não
 * reabrir no render seguinte — são duas perguntas diferentes sobre o mesmo parâmetro.
 *
 * ```tsx
 * const volta = useVoltarQuandoFechar(params.create === '1');   // criação vem sempre de fora
 * if (params.edit && …) { volta.marcar(); setForm(…); }         // edição, quando o alvo chega
 * <Sheet onClose={() => volta.aoFechar(() => setForm(null))}>   // e no sucesso do salvar
 * ```
 */
export function useVoltarQuandoFechar(inicial = false) {
  const [veioDeFora, setVeioDeFora] = useState(inicial);
  return {
    /** Chame ao CONSUMIR o parâmetro que abriu o formulário. */
    marcar: () => setVeioDeFora(true),
    /** Use no lugar do `setForm(null)`: fecha e, se outra tela abriu, volta para ela. */
    aoFechar: (fechar: () => void) => {
      fechar();
      if (veioDeFora) {
        setVeioDeFora(false);
        router.back();
      }
    },
  };
}
