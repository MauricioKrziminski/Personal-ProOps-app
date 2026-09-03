import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { categoryIcon } from '@/design/category-icons';
import { Radius, Space, tabular } from '@/design/tokens';
import { useAlertsSent, type AlertSent } from '@/hooks/use-finance';
import { formatDateBR } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import type { SymbolViewProps } from 'expo-symbols';

/**
 * Histórico de alertas — o que o ProOps te mandou sem você pedir.
 *
 * ## Por que ela existe
 *
 * A linha "Histórico de alertas" no Perfil respondia **"Em breve."** desde que foi criada. A
 * tabela `alerts_sent` já estava lá desde a `0024`, com a policy de leitura escrita e um
 * comentário dizendo "para uma futura tela de histórico" — faltava a tela.
 *
 * Ela é a contraparte da regra de `finance.md`: *"alerta que só informa é o que faz o usuário
 * desinstalar no segundo mês"*. Se o app te cutuca no WhatsApp, você tem que poder ver o que ele
 * cutucou e quando — senão o canal proativo é uma caixa preta.
 *
 * ## O que a linha NÃO tem
 *
 * `alerts_sent` guarda `kind` e `ref`, nunca o texto enviado: título e corpo são montados em SQL
 * na hora (`_alerts_to_send`) e descartados. Então esta tela **remonta** o rótulo a partir do
 * `kind`, e é por isso que o rótulo é genérico ("Fatura de cartão") em vez de citar o nome do
 * cartão.
 *
 * ⚠️ **`ref` só é legível em orçamento.** Ali ele é a própria categoria (`b.category`), e por
 * isso vira texto e até ícone. Em `invoice_due` e `bill_due` o `ref` é um UUID; resolvê-lo para
 * um nome exigiria um join por linha (N+1) ou uma RPC nova. A data responde a pergunta prática
 * ("foi esse alerta de terça?") sem inventar consulta — se um dia o nome fizer falta, o caminho
 * é uma RPC que devolva o histórico já resolvido, não um `select` por linha aqui.
 */

/** Os seis `kind` que `_alerts_to_send` produz. Fora do mapa, o alerta ainda aparece. */
const ALERTA: Record<string, { titulo: string; icone: SymbolViewProps['name']; tom: 'danger' | 'warning' | 'text' }> = {
  budget_80: { titulo: 'Orçamento no limite', icone: 'chart.pie', tom: 'warning' },
  budget_100: { titulo: 'Orçamento estourado', icone: 'chart.pie', tom: 'danger' },
  invoice_due: { titulo: 'Fatura de cartão vencendo', icone: 'creditcard', tom: 'warning' },
  bill_due: { titulo: 'Conta a vencer', icone: 'calendar', tom: 'warning' },
  negative_forecast: { titulo: 'Projeção no vermelho', icone: 'chart.line.downtrend.xyaxis', tom: 'danger' },
  trial_ending: { titulo: 'Teste acabando', icone: 'clock', tom: 'text' },
};

/** `whatsapp` / `push` — o canal por onde saiu. Nulo em linha antiga. */
const CANAL: Record<string, string> = { whatsapp: 'WhatsApp', push: 'notificação' };

/** Só o orçamento tem `ref` legível; nos outros o `ref` é um UUID e não vira legenda. */
function detalhe(a: AlertSent): string | undefined {
  const canal = a.channel ? CANAL[a.channel] ?? a.channel : null;
  const alvo = a.kind.startsWith('budget_') ? a.ref : null;
  return [alvo, canal ? `via ${canal}` : null].filter(Boolean).join(' · ') || undefined;
}

/** Agrupa por `sent_on` preservando a ordem — a query já vem ordenada por ele. */
function porDia(rows: AlertSent[]): [string, AlertSent[]][] {
  const dias = new Map<string, AlertSent[]>();
  for (const a of rows) {
    const dia = dias.get(a.sent_on);
    if (dia) dia.push(a);
    else dias.set(a.sent_on, [a]);
  }
  return [...dias.entries()];
}

export default function AlertsScreen() {
  const theme = useTheme();
  const alertas = useAlertsSent();
  const dias = useMemo(() => porDia(alertas.data ?? []), [alertas.data]);

  return (
    <Screen grouped>
      <Stack.Screen options={{ title: 'Histórico de alertas' }} />

      {alertas.isLoading ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : alertas.isError ? (
        <ErrorCard onRetry={() => alertas.refetch()} />
      ) : dias.length === 0 ? (
        <EmptyState
          title="Nenhum alerta ainda"
          hint="Quando um orçamento estourar, uma fatura vencer ou a projeção virar negativa, o aviso aparece aqui — e chega no seu WhatsApp."
        />
      ) : (
        dias.map(([dia, doDia]) => (
          <Section key={dia} title={formatDateBR(dia)}>
            {doDia.map((a) => {
              const meta = ALERTA[a.kind];
              return (
                <Row
                  key={a.id}
                  title={meta?.titulo ?? a.kind}
                  subtitle={detalhe(a)}
                  // Em orçamento o `ref` É a categoria, então o ícone dela diz mais que um sino.
                  icon={
                    a.kind.startsWith('budget_')
                      ? categoryIcon(a.ref)
                      : meta?.icone ?? 'bell'
                  }
                  chevron={false}
                  trailing={
                    <View style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText
                        type="code"
                        themeColor={meta?.tom ?? 'textSecondary'}
                        style={tabular}>
                        {hora(a.created_at)}
                      </ThemedText>
                    </View>
                  }
                />
              );
            })}
          </Section>
        ))
      )}

      {dias.length > 0 ? (
        <View style={styles.rodape}>
          <Icon name="bell" size="sm" color="textSecondary" />
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.shrink}>
            Um alerta por dia, por assunto — o ProOps não repete o mesmo aviso.
          </ThemedText>
        </View>
      ) : null}
    </Screen>
  );
}

/** `HH:MM` local. Vazio vira travessão, nunca "Invalid Date". */
function hora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  shrink: { flex: 1, minWidth: 0 },
});
