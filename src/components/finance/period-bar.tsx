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
 * ## A legenda não é enfeite
 *
 * "Ciclo" é tão opaco para um leigo quanto "Meio" era: a palavra não diz que setembro vai de
 * 11/08 a 10/09. Quem explica é a janela escrita, e por isso ela fica COLADA no controle que a
 * produz, em toda tela que tem a régua — não só na de Mês, onde ela nasceu.
 */
export function PeriodBar({ month, onChangeMonth, ruler }: Props) {
  const janela = useMonthRange(month, ruler.view);

  return (
    <View style={styles.wrap}>
      <MonthPicker month={month} onChange={onChangeMonth} />
      {/*
        ⚠️ **A régua fica ao lado da JANELA, não ao lado do seletor de mês** (medido no aparelho).

        A primeira tentativa pôs os dois na mesma linha — e eles não cabem: "Setembro de 2026"
        entre dois alvos de 44pt gasta ~240pt e a régua ~152, contra ~370 de calha no iPhone 17
        Pro. Com `flexWrap` a régua caía sozinha para a linha de baixo, encostada à esquerda, que
        é a mesma pilha de antes com um controle órfão no lugar de um largo.

        Ao lado da legenda ela cabe com folga (≈138 + 152) e ganha o sentido que faltava: o
        controle encosta no texto que ele MUDA. Trocar de régua e ver "11/08 a 10/09" virar
        "01/09 a 30/09" na mesma linha é a explicação que a palavra "Ciclo" nunca deu sozinha.
      */}
      <View style={styles.linhaJanela}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.janela}>
          {isoToBR(janela.from)} a {isoToBR(janela.to)}
        </ThemedText>
        <MonthRuler value={ruler.view} onChange={ruler.setView} visible={ruler.temCiclo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Space.xs,
  },
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
  janela: {
    fontVariant: ['tabular-nums'],
  },
});
