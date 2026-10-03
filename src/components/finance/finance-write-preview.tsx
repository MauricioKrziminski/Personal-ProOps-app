import { createContext, useContext, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Presenca, TrocaSuave, usePresencaAtiva } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { concealText, useBRL, useConceal } from '@/components/ui/conceal';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Space, tabular } from '@/design/tokens';
import { useFinanceWritePreview } from '@/hooks/use-finance-write-preview';
import { isoToBR } from '@/lib/dates';
import type { FinanceWrite } from '@/lib/finance-write-input';
import { contasDoEfeito, type PreviewScheduleLine } from '@/lib/finance-write-preview';

type Account = { id: string; name: string; type: string };
type LivePreview = ReturnType<typeof useFinanceWritePreview> & { accounts: Account[] };
const Live = createContext<LivePreview | null>(null);

/** The retained outgoing layer always reads live identity and privacy, never its old money. */
export function FinanceWritePreview({ write, accounts }: { write: FinanceWrite | null; accounts: Account[] }) {
  const preview = useFinanceWritePreview(write);
  const value = { ...preview, accounts };
  return (
    <Live.Provider value={value}>
      <Presenca visivel={Boolean(write)}>
        <Section title="Ao salvar">
          <TrocaSuave estado={preview.state.kind}>
            <PreviewContents />
          </TrocaSuave>
        </Section>
      </Presenca>
    </Live.Provider>
  );
}

function PreviewContents() {
  const live = useContext(Live)!;
  const active = usePresencaAtiva();
  if (!active || live.state.kind === 'incomplete') return null;
  if (live.state.kind === 'loading') return <View style={styles.notice}><Note>Conferindo o efeito deste lançamento…</Note></View>;
  if (live.state.kind === 'unavailable') return (
    <View style={styles.notice}>
      <Note icon="exclamationmark.triangle">Não consegui conferir a prévia. Verifique a conexão e tente novamente.</Note>
      <Button label="Atualizar prévia" size="sm" variant="secondary" onPress={() => void live.retry()} />
    </View>
  );
  return <ReadyPreview key={live.identity} />;
}

function ReadyPreview() {
  const live = useContext(Live)!;
  const brl = useBRL();
  const { ready, concealed } = useConceal();
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(6);
  if (live.state.kind !== 'ready') return null;
  const preview = live.state.preview;
  const money = (cents: number) => !ready || concealed ? concealText() : brl(cents);
  const rows = contasDoEfeito(preview, live.accounts);
  const entries = preview.schedule.filter((l) => l.is_entry);
  const fees = preview.schedule.filter((l) => l.is_fee);
  const principal = preview.schedule.find((l) => !l.is_entry && !l.is_fee);
  const row = (key: string, title: string, text: string, warning = false) => (
    <Row key={key} title={title} subtitle={<ThemedText type="footnote" themeColor="textSecondary" style={tabular}>{text}</ThemedText>}
      destructive={ready && !concealed && warning} accessibilityLabel={`${title}. ${text}`} />
  );
  const pair = (before: number | null, after: number | null) =>
    after === null ? 'Indisponível' : before === null ? money(after) : before === after ? `${money(after)} · sem alteração` : `${money(before)} → ${money(after)}`;
  const lineText = (line: PreviewScheduleLine) => `${money(line.amount_cents)} · ${when(line, live.accounts.find((a) => a.id === line.account_id)?.type === 'credit_card')}${line.estimated ? ' · estimativa' : ''}`;
  const accountName = (id: string | null) => live.accounts.find((a) => a.id === id)?.name ?? 'Sem conta';
  const purchase = preview.write.operation === 'purchase';
  const installments = preview.schedule.filter((l) => !l.is_entry && !l.is_fee);
  // Aggregate the actual server schedule; do not reproduce rounding or financial formulas.
  const total = installments.reduce((sum, line) => sum + line.amount_cents, 0);

  return (
    <View>
      {purchase && installments.length > 1 && !preview.schedule_truncated && Number.isSafeInteger(total)
        ? row('commitment', `Compromisso em ${installments.length} parcelas`, `${money(total)}${entries.length ? ' · entrada separada abaixo' : ''}`)
        : null}
      {principal ? row('principal', principal.installment_no ? `Parcela ${principal.installment_no}${principal.installments_total ? ` de ${principal.installments_total}` : ''}`
        : principal.kind === 'income' ? 'Recebimento' : principal.kind === 'transfer' ? 'Transferência' : 'Pagamento', lineText(principal)) : null}
      {entries.map((line, i) => row(`entry-${i}`, `Entrada · ${accountName(line.account_id)}`, lineText(line)))}
      {fees.map((line, i) => row(`fee-${i}`, 'Juros do Pix no crédito', lineText(line)))}
      {rows.map((account) => {
        let text: string;
        if (account.type === 'credit_card') {
          text = account.limitStatus === 'not_set' ? 'Limite não cadastrado'
            : account.limitStatus === 'needs_review' ? 'Revise o histórico para conferir o limite disponível'
            : `Limite disponível: ${pair(account.limitBefore, account.limitAfter)}`;
        } else {
          text = `Saldo atual: ${pair(account.balanceBefore, account.balanceAfter)}`;
          if (account.forecastAfter !== null && (account.forecastBefore !== account.forecastAfter || account.forecastAfter !== account.balanceAfter))
            text += `\nPrevisto em ${isoToBR(preview.horizon_end)}: ${pair(account.forecastBefore, account.forecastAfter)}`;
        }
        return row(`account-${account.id}`, account.name, text, account.type === 'credit_card'
          ? account.limitAfter !== null && account.limitAfter < 0 : account.balanceAfter !== null && account.balanceAfter < 0);
      })}
      {!principal ? <View style={styles.notice}><Note>{preview.schedule_scope === 'horizon'
        ? `Sem ocorrência nos próximos ${preview.horizon_days} dias.` : 'Este cadastro ainda não tem um cronograma de pagamentos.'}</Note></View> : null}
      {preview.schedule.length > 1 ? (
        <View style={styles.notice}>
          <Button size="sm" variant="secondary" label={expanded ? 'Recolher cronograma' : `Ver cronograma · ${preview.schedule_total} registros`}
            onPress={() => setExpanded(!expanded)} />
        </View>
      ) : null}
      <Presenca visivel={expanded}>
        <ScheduleRows visible={visible} onMore={() => setVisible(visible + 6)} />
      </Presenca>
      <View style={styles.notice}>
        <Note>{preview.schedule_scope === 'horizon' ? `Prévia dos próximos ${preview.horizon_days} dias. Nada foi gravado.` : 'Prévia do registro. Nada foi gravado.'}</Note>
        {preview.schedule_truncated ? <Note>Exibindo os primeiros {preview.schedule.length} de {preview.schedule_total} registros.</Note> : null}
      </View>
    </View>
  );
}

function when(line: PreviewScheduleLine, card = false) {
    if (line.status === 'declared') return `Histórico informado · ${isoToBR(line.occurred_at)}`;
    if (card || line.invoice_id || line.invoice_due_date) {
      if (line.invoice_paid_at && !line.estimated) return `Fatura paga em ${isoToBR(line.invoice_paid_at)}`;
      const date = line.invoice_due_date ? `${line.estimated ? 'Previsto na fatura de' : 'Fatura vence'} ${isoToBR(line.invoice_due_date)}` : 'Vencimento da fatura indisponível';
      return line.invoice_closing_date ? `${date} · fecha ${isoToBR(line.invoice_closing_date)}` : date;
    }
    if (line.estimated && line.status === 'cleared') return `Confirmação automática prevista para ${isoToBR(line.due_at ?? line.occurred_at)}`;
    const label = line.status === 'pending' ? 'Previsto para' : line.kind === 'income' ? 'Recebido em' : line.kind === 'transfer' ? 'Transferido em' : 'Pago em';
    return `${label} ${isoToBR(line.paid_at ?? line.due_at ?? line.occurred_at)}`;
}

function ScheduleRows({ visible, onMore }: { visible: number; onMore: () => void }) {
  const live = useContext(Live)!;
  const brl = useBRL();
  const { ready, concealed } = useConceal();
  if (live.state.kind !== 'ready') return null;
  const money = (cents: number) => !ready || concealed ? concealText() : brl(cents);
  const preview = live.state.preview;
  return <View>
    {preview.schedule.slice(0, visible).map((line, index) => {
      const title = line.is_entry ? 'Entrada' : line.is_fee ? 'Juros do Pix' : line.installment_no ? `Parcela ${line.installment_no}` : line.description ?? 'Ocorrência';
      const account = live.accounts.find((a) => a.id === line.account_id)?.name ?? 'Sem conta';
      const text = `${money(line.amount_cents)} · ${when(line, live.accounts.find((a) => a.id === line.account_id)?.type === 'credit_card')}${line.estimated ? ' · estimativa' : ''}\n${account}`;
      return <Row key={`${line.id ?? line.ref_id}-${index}`} title={title}
        subtitle={<ThemedText type="footnote" themeColor="textSecondary" style={tabular}>{text}</ThemedText>}
        accessibilityLabel={`${title}. ${text}`} />;
    })}
    {visible < preview.schedule.length ? <View style={styles.notice}><Button label="Ver mais registros" variant="secondary" size="sm" onPress={onMore} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({ notice: { padding: Space.lg, gap: Space.md, alignItems: 'flex-start' } });
