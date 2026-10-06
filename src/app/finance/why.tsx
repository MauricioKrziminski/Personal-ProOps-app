import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Explica } from '@/components/ui/explica';
import { EmptyState } from '@/components/ui/empty-state';
import { useBRL, useConceal } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Field } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { Space, tabular } from '@/design/tokens';
import { useSpendingChange } from '@/hooks/use-spending-change';
import { explicaMudanca } from '@/lib/explicacoes';
import { showItemActions } from '@/lib/item-actions';
import {
  barFraction, percentText, rowLinkParams, visibleRows,
  type SpendingChangeRow, type SpendingDimension, type SpendingPeriods,
} from '@/lib/spending-change';

type Grupo = 'category' | 'subcategory' | 'payment_method' | 'type';
type Tipo = 'pattern' | 'necessity';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Por que mudou?" — quanto cada categoria (ou detalhe, pagamento, tipo) contribuiu para a diferença
 * de gasto entre dois períodos que a tela de origem JÁ resolveu. Lente única, dita no rodapé:
 * gastos lançados por data. Sem frase causal: contribuiu, não "você gastou mais porque".
 */
export default function WhyScreen() {
  const brl = useBRL();
  const { concealed } = useConceal();
  const p = useLocalSearchParams<{
    curFrom?: string; curTo?: string; prevFrom?: string; prevTo?: string; curLabel?: string; prevLabel?: string;
  }>();
  const valido = [p.curFrom, p.curTo, p.prevFrom, p.prevTo].every((v) => typeof v === 'string' && ISO.test(v));
  const periods: SpendingPeriods | null = valido
    ? { curFrom: p.curFrom!, curTo: p.curTo!, prevFrom: p.prevFrom!, prevTo: p.prevTo! }
    : null;
  const curLabel = p.curLabel || 'este período';
  const prevLabel = p.prevLabel || 'o período anterior';

  const [grupo, setGrupo] = useState<Grupo>('category');
  const [tipo, setTipo] = useState<Tipo>('pattern');
  const [todas, setTodas] = useState(false);
  const dimension: SpendingDimension = grupo === 'type' ? tipo : grupo;
  const q = useSpendingChange(periods, dimension);
  const data = q.data;
  const rows = data ? visibleRows(data.rows, todas) : [];
  const zeradas = data ? data.rows.filter((r) => r.delta === 0).length : 0;
  const pct = data ? percentText(data.percentBp) : null;

  const abrir = (row: SpendingChangeRow) => {
    if (!periods) return;
    const ir = (which: 'current' | 'previous') => () =>
      router.push({ pathname: '/finance/transactions', params: rowLinkParams(dimension, row, periods, which) });
    showItemActions(row.label, [
      { label: `Ver em ${prevLabel}`, icon: 'list.bullet', onPress: ir('previous') },
      { label: `Ver em ${curLabel}`, icon: 'list.bullet', onPress: ir('current') },
    ]);
  };

  return (
    <Screen grouped onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: 'Por que mudou?' }} />

      {!periods ? (
        <EmptyState icon="calendar" compacto title="Escolha os períodos"
          hint="Abra esta tela pelo bloco de categorias do Financeiro." />
      ) : (
        <>
          <Card style={styles.topo}>
            <View style={styles.topoLinha}>
              <View style={styles.metade}>
                <ThemedText type="small" themeColor="textSecondary">{`Gasto em ${curLabel}`}</ThemedText>
                {data ? <Money cents={data.current} variant="headline" /> : <Skeleton width={96} height={22} />}
              </View>
              <View style={styles.metade}>
                <ThemedText type="small" themeColor="textSecondary">{`Gasto em ${prevLabel}`}</ThemedText>
                {data ? <Money cents={data.previous} variant="headline" /> : <Skeleton width={96} height={22} />}
              </View>
            </View>
            {data ? (
              <View style={styles.deltaLinha}>
                <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                  {data.delta === 0 ? 'Sem diferença.' : 'Diferença '}
                  {data.delta !== 0 ? <Money cents={data.delta} variant="subhead" signed /> : null}
                  {/* o percentual entrega o tamanho da mudança: some com os valores ocultos */}
                  {data.delta === 0 ? '' : data.previous === 0 ? ` · sem gasto em ${prevLabel}` : pct && !concealed ? ` · ${pct}` : ''}
                </ThemedText>
                <Explica indicador="Por que mudou" explicacao={explicaMudanca(periods)} />
              </View>
            ) : null}
          </Card>

          <Segmented<Grupo>
            options={[
              { value: 'category', label: 'Categoria' }, { value: 'subcategory', label: 'Detalhe' },
              { value: 'payment_method', label: 'Pagamento' }, { value: 'type', label: 'Tipo' },
            ]}
            value={grupo}
            onChange={(v) => { setGrupo(v); setTodas(false); }}
          />
          {/* Lista, não um segundo seletor de abas colado no primeiro (06/10/2026). */}
          {grupo === 'type' ? (
            <Field label="Classificar por">
              <SelectField
                options={[{ id: 'pattern', label: 'Fixo ou variável' }, { id: 'necessity', label: 'Essencial ou não' }]}
                value={tipo}
                placeholder="Escolher"
                onChange={(v) => { if (v === 'pattern' || v === 'necessity') { setTipo(v); setTodas(false); } }}
              />
            </Field>
          ) : null}

          {q.isError ? <ErrorCard onRetry={() => q.refetch()} /> : null}
          {q.isPending && !q.isError ? <><SkeletonRow /><SkeletonRow /><SkeletonRow /></> : null}

          {data && data.rows.length === 0 ? (
            <EmptyState icon="chart.bar" compacto title="Nenhum gasto nos dois períodos" />
          ) : null}

          {data && data.rows.length > 0 ? (
            <Section title="O que contribuiu para a diferença">
              {rows.map((r) => (
                <View key={r.key ?? 'sem'} style={styles.linha}>
                  <Row
                    title={r.label}
                    subtitle={`${brl(r.previous)} → ${brl(r.current)}`}
                    onPress={() => abrir(r)}
                    accessibilityLabel={`${r.label}, de ${brl(r.previous)} para ${brl(r.current)}. Toque para ver os lançamentos.`}
                    trailing={<Money cents={r.delta} variant="headline" signed tone={r.delta > 0 ? 'warning' : r.delta < 0 ? 'success' : 'plain'} />}
                  />
                  <View style={styles.barra}>
                    <ProgressBar value={barFraction(r.delta, data.rows)} max={1} tone="data" />
                  </View>
                </View>
              ))}
            </Section>
          ) : null}

          {data && !todas && zeradas > 0 ? (
            <Button label={`Ver todas (${zeradas} sem mudança)`} variant="secondary" size="sm" onPress={() => setTodas(true)} />
          ) : null}

          {data ? (
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
              Gastos lançados por data, previstos incluídos. Créditos e estornos aparecem em Entradas e não descontam daqui.
              Cada item conta pela categoria que tem hoje, nos dois períodos.
            </ThemedText>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topo: { gap: Space.sm, padding: Space.lg },
  topoLinha: { flexDirection: 'row', gap: Space.xl },
  deltaLinha: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  metade: { flex: 1, gap: 2 },
  linha: { gap: Space.xs },
  barra: { paddingHorizontal: Space.lg, paddingBottom: Space.md },
  rodape: { paddingHorizontal: Space.lg },
});
