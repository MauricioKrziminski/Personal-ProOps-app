import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useBRL, useConceal } from '@/components/ui/conceal';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Caixa, LinhaDeCaixa } from '@/lib/account-cash';
import { ACCOUNT_TYPES } from '@/lib/accounts';
import type { OrcamentoApertado } from '@/lib/budget-tight';
import type { PainelDoDia } from '@/lib/today-spend';

function glifo(tipo: string): IconName {
  return (ACCOUNT_TYPES.find((t) => t.value === tipo)?.icon as IconName) ?? 'questionmark.circle';
}

export interface DinheiroDoDiaProps {
  painel: PainelDoDia;
  /** Tocar no número: o menu de sempre (ciclo, projeção, patrimônio, metas). */
  onAbrirMenu: () => void;
  /** O caixa das contas; `null` quando os saldos falharam (a tela desenha o erro). */
  caixa: Caixa | null;
  contasAbertas: boolean;
  onAlternarContas: () => void;
  onAbrirConta: (l: LinhaDeCaixa) => void;
  apertados: readonly OrcamentoApertado[];
  onAbrirOrcamentos: () => void;
}

/**
 * O dinheiro da Hoje — na escala do DIA, num card claro (28/09/2026, spec
 * `2026-09-28-hoje-o-dia-design.md`).
 *
 * Substitui quatro blocos: o herói de tinta (que mostrava o MESMO número do herói do Financeiro),
 * "Nas contas" e os anéis "No limite" (o mesmo bloco das duas telas). Aqui: quanto cabe por dia,
 * quanto existe em conta agora e o orçamento no limite. O que saiu em cada dia é a semana, no topo
 * da Hoje (`SemanaDoDia`), onde o "por dia" deste card é a régua tracejada.
 *
 * ⚠️ **As contas abrem NO LUGAR** e cada uma leva ao extrato dela; o total é a soma exata das
 * linhas (`caixaDasContas`, com teste). Cartão fica de fora: tem fatura, não saldo.
 */
export function DinheiroDoDia({
  painel,
  onAbrirMenu,
  caixa,
  contasAbertas,
  onAlternarContas,
  onAbrirConta,
  apertados,
  onAbrirOrcamentos,
}: DinheiroDoDiaProps) {
  const theme = useTheme();
  const { concealed, toggle } = useConceal();
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const estourou = apertados.some((o) => o.estourou);
  const temContas = caixa !== null && caixa.linhas.length > 0;

  return (
    <Section>
      {/*
        O olho é IRMÃO da área tocável, nunca filho: dentro de um `Pressable` acessível o iOS agrupa
        os filhos e o VoiceOver não alcança o botão de esconder saldo.
      */}
      <View>
        <Pressable
          accessibilityRole="button"
          // O número é um `TextInput` animado, escondido do leitor: sem isto ele lia rótulo e legenda e pulava o VALOR.
          accessibilityLabel={[`${painel.rotulo}: ${brl(painel.cents)}`, painel.legenda].filter(Boolean).join('. ')}
          accessibilityHint="Abre o ciclo, a projeção, o patrimônio e as metas"
          onPress={onAbrirMenu}>
          {({ pressed }) => (
            <View style={[styles.topo, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <View style={styles.rotulo}>
                <ThemedText type="small" themeColor="textSecondary">
                  {painel.rotulo}
                </ThemedText>
              </View>
              <CountUpMoney cents={painel.cents} variant="money" tone={painel.negativo ? 'danger' : 'text'} />
              {painel.legenda ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {painel.legenda}
                </ThemedText>
              ) : null}
            </View>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={concealed ? 'Mostrar valor' : 'Ocultar valor'}
          onPress={toggle}
          hitSlop={Space.sm}
          style={[styles.olho, { backgroundColor: theme.backgroundElement }]}>
          <Icon name={concealed ? 'eye.slash' : 'eye'} size="sm" color="text" />
        </Pressable>
      </View>

      {temContas ? (
        <Row
          inlineValue
          icon="building.columns"
          title="Em conta"
          subtitle={caixa.aReceber > 0 ? `mais ${brl(caixa.aReceber)} que ainda vão cair` : undefined}
          accessibilityState={{ expanded: contasAbertas }}
          accessibilityLabel={`Em conta: ${brl(caixa.total)}. ${contasAbertas ? 'Recolher' : 'Ver cada conta'}`}
          trailing={
            <View style={styles.comSeta}>
              <Money cents={caixa.total} variant="ticker" tone={caixa.total < 0 ? 'danger' : 'plain'} />
              <Icon name={contasAbertas ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
            </View>
          }
          chevron={false}
          onPress={() => {
            Haptics.selectionAsync();
            onAlternarContas();
          }}
        />
      ) : null}
      {temContas && contasAbertas
        ? caixa.linhas.map((l) => (
            <Row
              key={l.id ?? 'sem-conta'}
              inlineValue
              indent={1}
              icon={glifo(l.tipo)}
              title={l.nome}
              subtitle={l.aReceber > 0 ? `${brl(l.aReceber)} a receber` : undefined}
              accessibilityLabel={`${l.nome}: ${brl(l.cents)}. Abre o extrato`}
              trailing={<Money cents={l.cents} variant="ticker" tone={l.cents < 0 ? 'danger' : 'plain'} />}
              onPress={() => onAbrirConta(l)}
            />
          ))
        : null}

      {apertados.length > 0 ? (
        <Row
          icon="chart.pie"
          title="No limite"
          badge={{ label: estourou ? 'passou' : 'perto', tone: estourou ? 'danger' : 'warning' }}
          subtitle={apertados.map((o) => o.categoria).join(', ')}
          accessibilityLabel={`No limite, ${estourou ? 'passou do limite' : 'perto do limite'}: ${apertados.map((o) => o.categoria).join(', ')}`}
          onPress={onAbrirOrcamentos}
        />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  topo: { gap: Space.xs, padding: Space.lg },
  /** O rótulo divide a primeira linha com o olho, que mora por cima (irmão da área tocável). */
  rotulo: { minHeight: 32, justifyContent: 'center', paddingRight: 32 + Space.sm },
  olho: {
    position: 'absolute',
    top: Space.lg,
    right: Space.lg,
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  comSeta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: HitTarget - Space.md },
});
