import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { type CycleView, useCycleBreakdown } from '@/hooks/use-finance';
import { isoToBR } from '@/lib/dates';
import { rotulosDoDetalhe, saidasPorBalde } from '@/lib/detalhe-do-ciclo';

/**
 * "Como chego nesse valor" (07/10/2026): a folha que abre ao tocar no número do ciclo.
 *
 * Partida (conta por conta no ciclo aberto) + o que entra − o que sai = o número tocado. Tudo vem
 * de `cycle_breakdown`, das mesmas fontes do número. `rascunho` é para a tela que soma hipóteses
 * (que o banco não conhece): ela passa o número que MOSTRA, e a diferença vira a linha
 * "Hipóteses do rascunho" — a conta continua fechando no número tocado.
 */
export function DetalheDoCicloSheet({
  visible,
  onClose,
  month,
  view,
  rascunho,
  onVerCiclo,
}: {
  visible: boolean;
  onClose: () => void;
  /** `YYYY-MM` ou a data do rótulo do ciclo. */
  month: string;
  view?: CycleView;
  /** O número que a tela mostra COM as hipóteses do rascunho; ausente = a tela é o real. */
  rascunho?: number | null;
  onVerCiclo?: () => void;
}) {
  const detalhe = useCycleBreakdown(month, view, visible);
  const d = detalhe.data;
  const r = d ? rotulosDoDetalhe(d.estado) : null;
  const base = d ? (d.estado === 'fechado' ? (d.caixaNoFim ?? d.resultado) : d.resultado) : 0;
  const hipoteses = d && rascunho != null ? rascunho - base : 0;
  const fim = base + hipoteses;
  const faltou = d?.estado === 'fechado' ? Number(d.faltouPagar ?? 0) : 0;
  const theme = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <TaskHeader
        title="Como chego nesse valor"
        subtitle={d ? `${isoToBR(d.ini)} a ${isoToBR(d.fim)} · ciclo ${d.estado}` : undefined}
        onClose={onClose}
      />
      <SheetScroll contentContainerStyle={styles.corpo}>
        {detalhe.isError ? (
          <ErrorCard onRetry={() => void detalhe.refetch()} />
        ) : !d || !r ? (
          <Skeleton height={180} radius={Radius.md} />
        ) : (
          <>
            <View style={styles.bloco}>
              <Linha rotulo={r.partida} cents={d.partida.cents} forte />
              {d.partida.contas.map((c) => (
                <Linha key={c.account_id ?? 'sem-conta'} rotulo={c.nome} cents={c.cents} recuo />
              ))}
            </View>
            <View style={styles.bloco}>
              <Linha rotulo={`+ ${r.entra}`} cents={d.entra} tone="success" />
              <Linha rotulo={`− ${r.sai}`} cents={-d.sai} tone="danger" />
              {saidasPorBalde(d).map((b) => (
                <Linha key={b.titulo} rotulo={b.titulo} cents={-b.cents} recuo />
              ))}
              {hipoteses !== 0 ? <Linha rotulo="Hipóteses do rascunho" cents={hipoteses} tone="warning" /> : null}
            </View>
            <View style={[styles.bloco, styles.total, { borderColor: theme.cardBorder }]}>
              <Linha rotulo={`= ${r.fim}`} cents={fim} forte />
              {faltou > 0 ? <Linha rotulo="Faltou pagar" cents={-faltou} tone="danger" forte /> : null}
            </View>
            {onVerCiclo ? (
              <Button label="Ver o que fecha o ciclo" variant="secondary" onPress={onVerCiclo} />
            ) : null}
          </>
        )}
      </SheetScroll>
    </Sheet>
  );
}

function Linha({
  rotulo,
  cents,
  tone = 'text',
  forte = false,
  recuo = false,
}: {
  rotulo: string;
  cents: number;
  tone?: 'text' | 'success' | 'danger' | 'warning';
  forte?: boolean;
  recuo?: boolean;
}) {
  const brl = useBRL();
  return (
    // Rótulo e valor lado a lado quando cabem; com fonte grande o valor desce inteiro (como o
    // `Fechamento` do ciclo), sem partir o rótulo no meio da palavra.
    <View style={[styles.linha, recuo && styles.recuo]} accessible accessibilityLabel={`${rotulo.replace(/^[+−=] /, '')}, ${brl(cents)}`}>
      <ThemedText
        type={forte ? 'smallBold' : 'small'}
        themeColor={forte ? 'text' : 'textSecondary'}
        style={styles.rotulo}>
        {rotulo}
      </ThemedText>
      <View style={styles.valor}>
        <Money cents={cents} variant={forte ? 'ticker' : 'footnote'} tone={recuo ? 'text' : tone} signed={!forte && !recuo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  bloco: { gap: Space.sm },
  // 1dp, como o fio do `Card`: `hairlineWidth` é um pixel físico e some em escala.
  total: { paddingTop: Space.md, borderTopWidth: 1 },
  linha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: Space.sm,
  },
  recuo: { paddingLeft: Space.lg },
  rotulo: { flexShrink: 0, maxWidth: '100%' },
  valor: { marginLeft: 'auto' },
});
