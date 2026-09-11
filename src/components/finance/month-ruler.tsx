import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Segmented } from '@/components/ui/segmented';
import { Space } from '@/design/tokens';
import { useCycle, type CycleView } from '@/hooks/use-finance';

/**
 * A régua do período — **mês civil ou o ciclo do usuário**, escolhida EM CADA TELA.
 *
 * ## Por que por tela, e não uma preferência
 *
 * A `20260911130000` fez global e estava errado. O pedido do dono do produto foi explícito:
 * *"eu pedi para dar a opção do usuário escolher não de forma global entre ciclo e mês, e sim
 * individualmente em cada tela. Ele define o ciclo de forma global, mas dentro de cada tela onde
 * fixa e visualiza por ciclo ou por mês, o usuário escolhe."* O que é global é o DIA (Perfil); o
 * que é da tela é como ela está olhando agora.
 *
 * A escolha vive em `useState` e morre com a tela, de propósito: "como estou olhando agora" é
 * estado de tela, não configuração. Gravar as sete viraria sete colunas, e quem trocasse a régua
 * da Projeção em março abriria o app em junho sem lembrar por que aquela tela discorda das
 * outras.
 *
 * ## Por que não existe uma terceira opção "Fatura"
 *
 * Pesquisado em 11/09/2026, e a conclusão foi do próprio artigo que DEFENDE alinhar o orçamento
 * ao ciclo do cartão: *"if you have several cards with different closing dates, you cannot align
 * to all of them, and picking one means the others are still misaligned"*. O fechamento é interno
 * do cartão — com três cartões há três fechamentos e nenhum período comum.
 *
 * O que o usuário queria da régua "fatura" (*"ver os lançamentos por fatura dentro do ciclo"*)
 * não vem de um período novo: vem de a **fatura virar uma linha, posicionada no VENCIMENTO**, que
 * é um evento de caixa como qualquer outro e cai sozinho no período certo — o modelo do Organizze
 * ("Saldo diário" conta o cartão como uma despesa única "Fatura Mês Ano", pelo vencimento).
 * Por isso são DUAS opções aqui, e o resto é a linha da fatura.
 */
export function useMonthRuler() {
  const [view, setView] = useState<CycleView>('cycle');
  const cycle = useCycle(view);
  /**
   * Sem dia de fechamento configurado as duas réguas descrevem o MESMO período
   * (`cycle_bounds(null, m)` É o `date_trunc('month')`), e um controle cujas duas opções fazem a
   * mesma coisa ensina a pessoa a não confiar nos controles da tela. Então ele não aparece.
   */
  const temCiclo = cycle.data?.closeDay != null;
  return { view, setView, temCiclo, cycle };
}

interface Props {
  value: CycleView;
  onChange: (v: CycleView) => void;
  /** `false` enquanto não houver dia de fechamento configurado — o controle some. */
  visible: boolean;
}

export function MonthRuler({ value, onChange, visible }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.wrap}>
      <Segmented
        value={value}
        onChange={(v) => {
          Haptics.selectionAsync();
          onChange(v);
        }}
        options={[
          { value: 'civil', label: 'Mês' },
          { value: 'cycle', label: 'Ciclo' },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    ⚠️ **Sem margem negativa.** A primeira versão puxava o controle para cima com
    `marginTop: -Space.md`, para ele ler como qualificador do seletor de mês em vez de um bloco
    separado — e o resultado foi ele SOBREPOR o seletor: as setas ‹ › e "Setembro de 2026"
    ficaram por baixo dos segmentos. O `gap` do `Screen` já dá o respiro certo; a ligação entre
    os dois se faz pela ORDEM (período, depois régua, depois o intervalo escrito), não por
    aproximação forçada.
  */
  wrap: {},
});
