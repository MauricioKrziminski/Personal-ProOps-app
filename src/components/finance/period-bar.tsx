import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MonthPicker } from '@/components/finance/month-picker';
import { MonthRuler, type MonthRulerState } from '@/components/finance/month-ruler';
import { Space } from '@/design/tokens';
import { useMonthRange } from '@/hooks/use-finance';
import { isoToBR } from '@/lib/dates';

interface Props {
  month: string;
  onChangeMonth: (month: string) => void;
  ruler: MonthRulerState;
}

/** `2026-08-11` → `11/08`. O ANO já está escrito no título do mês, logo acima, no mesmo card. */
function diaEMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * O cabeçalho de PERÍODO das telas de dinheiro: **qual mês, com que régua, cobrindo que dias.**
 *
 * ## Por que virou um primitivo
 *
 * Eram três controles empilhados e cada tela empilhava do seu jeito — o seletor de mês, o
 * `Mês | Ciclo` largura cheia e a legenda da janela, um debaixo do outro, ocupando três linhas
 * antes de qualquer número. A queixa do dono do produto (11/09/2026) foi literal: *"olha aonde
 * está o componente que eu passo o mês e vejo qual mês está, em um lugar horrível sem sentido,
 * grudado sem gap nenhum com o tab embaixo"*.
 *
 * Duas coisas estavam erradas ao mesmo tempo:
 *
 * 1. **Empilhamento.** Três linhas para responder UMA pergunta ("de que período esta tela está
 *    falando"). Viraram duas: o seletor de mês em cima, e embaixo a janela escrita com a régua
 *    que a produz na mesma linha.
 * 2. **Nenhum gap.** `escopo` era `{ marginBottom }` sem `gap`, e o comentário do `MonthRuler`
 *    afirmava que "o `gap` do `Screen` já dá o respiro" — o que é falso quando os dois estão
 *    dentro do mesmo `View`. O `Screen` espaça FILHOS dele; aqui eles eram irmãos aninhados.
 *
 * ## O card, e por que a legenda parou de flutuar (11/09/2026)
 *
 * A primeira correção pôs os três controles em duas linhas SOLTAS, e o dono do produto voltou na
 * mesma tela: *"dá para melhorar esse layout, texto embaixo desse componente de passar de mês
 * horrível"*. Ele estava certo — uma legenda pendurada embaixo de um controle, sem nada ligando
 * os dois, lê como sobra. Agora ela é o RODAPÉ do próprio seletor de mês, dentro da mesma
 * superfície e abaixo de um fio: o card inteiro responde "de que período esta tela fala", em vez
 * de três peças tentando responder juntas.
 *
 * ## A legenda não é enfeite
 *
 * "Ciclo" é tão opaco para um leigo quanto "Meio" era: a palavra não diz que setembro vai de
 * 11/08 a 10/09. Quem explica é a janela escrita, e por isso ela fica COLADA no controle que a
 * produz, em toda tela que tem a régua — não só na de Mês, onde ela nasceu.
 */
export function PeriodBar({ month, onChangeMonth, ruler }: Props) {
  const janela = useMonthRange(month, ruler.view);

  return (
    <MonthPicker month={month} onChange={onChangeMonth}>
      <View style={styles.linhaJanela}>
        <ThemedText
          type="code"
          themeColor="textSecondary"
          // Na tela, a data curta; para o leitor de tela, a frase inteira — "11/08 traço 10/09"
          // não é o que a pessoa precisa ouvir.
          accessibilityLabel={`De ${isoToBR(janela.from)} a ${isoToBR(janela.to)}`}>
          {diaEMes(janela.from)} – {diaEMes(janela.to)}
        </ThemedText>
        <MonthRuler value={ruler.view} onChange={ruler.setView} visible={ruler.temCiclo} />
      </View>
    </MonthPicker>
  );
}

const styles = StyleSheet.create({
  linhaJanela: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    /*
      `flexWrap` é a rede: a 384dp × fonte 1,3 a legenda cresce e, sem a quebra, quem seria
      espremido é a régua — o defeito de que esta tela acabou de sair.
    */
    flexWrap: 'wrap',
    gap: Space.sm,
  },
});
