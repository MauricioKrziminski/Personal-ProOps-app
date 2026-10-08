import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { LinhaDoTempo, type ItemNoTempo } from '@/components/finance/linha-do-tempo';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { Screen } from '@/components/ui/screen';
import { TaskHeader } from '@/components/ui/task-header';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import {
  useAccounts,
  useAnticipationCandidates,
  useApplyAnticipation,
  useEditAnticipation,
  useTransaction,
} from '@/hooks/use-finance';
import { useRascunho } from '@/hooks/use-rascunho';
import {
  diaDoAplicar,
  parcelasDoGrupo,
  pedidoDasParcelas,
  tituloDoAdiantamento,
  type FonteAdiantavel,
} from '@/lib/anticipation';
import { brToISO, isoToBR, localISODate } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';

/** Uma parcela coberta, do jeito que a tela desenha (da hipótese ou do lançamento gravado). */
type Coberta = { chave: string; n: number | null; dia: string; cents: number };

/**
 * Aplicar o adiantamento do "E se…?" (08/10/2026, spec 2026-10-08-aplicar-adiantamento-design.md):
 * *"tudo que eu colocar ali na hipótese, eu devo conseguir aplicar"*. Vira UM lançamento — título,
 * valor pago, data e conta, como num "Paguei" — e a origem muda junto, no banco.
 *
 * `?grupo=` aplica o adiantamento do rascunho; `?id=` edita o lançamento já aplicado (a mesma
 * tela: o que se cria se edita). As parcelas cobertas são as que a hipótese mostrou: achadas na
 * lista do banco pelo dia em que cada uma sairia (`parcelasDoGrupo`), e o banco confere de novo.
 */
export default function AplicarAdiantamento() {
  const params = useLocalSearchParams<{ grupo?: string; id?: string }>();
  const editando = Boolean(params.id);
  const brl = useBRL();
  const toast = useToast();
  const hoje = localISODate();
  const accounts = useAccounts();
  const { rascunho, setAdiantamentos } = useRascunho();
  const aplicar = useApplyAnticipation();
  const editar = useEditAnticipation();

  // ── de onde vêm os dados: a hipótese do rascunho, ou o lançamento gravado ──
  const drafts = rascunho.adiantamentos.filter((d) => d.grupo === params.grupo);
  const pagamento = drafts.find((d) => d.adiantar);
  const candidatos = useAnticipationCandidates(pagamento?.start ?? hoje, Boolean(pagamento) && !editando, false);
  const item = candidatos.data?.find((i) => i.ref_id === pagamento?.adiantar?.ref_id) ?? null;
  const daHipotese = item
    ? parcelasDoGrupo(item, drafts.filter((d) => d.mode === 'cancel').map((d) => d.start))
    : null;
  const gravado = useTransaction(editando ? params.id : undefined);
  const registro = gravado.data?.adiantamento ?? null;

  const fonte: FonteAdiantavel | null = editando ? (registro?.source ?? null) : (item?.source ?? null);
  const cobertas: Coberta[] = editando
    ? (registro?.parcelas ?? []).map((p, i) => ({
        // O mesmo dia que a criação mostrou: o de sair do caixa (no cartão, o vencimento da fatura).
        chave: `${p.n ?? p.on ?? i}`, n: p.n ?? null, dia: p.day ?? p.linha?.due_at ?? p.on ?? '', cents: Number(p.cents ?? 0),
      }))
    : (daHipotese ?? []).map((p, i) => ({ chave: `${p.id ?? p.on ?? i}-${p.day}`, n: p.n, dia: p.day, cents: p.cents }));
  const soma = cobertas.reduce((s, p) => s + p.cents, 0);

  // ── os campos, que nascem do que a hipótese (ou o lançamento) já tem ──
  const inicial = () => {
    if (editando && gravado.data) {
      const t = gravado.data;
      return { titulo: t.description ?? '', valor: Number(t.amount_cents), dataBR: isoToBR(t.occurred_at), conta: t.account_id };
    }
    if (pagamento && item && daHipotese) {
      const daOrigem = accounts.data?.find((a) => a.name === item.account_name && !a.archived);
      const contaPadrao = item.source === 'debt' && daOrigem?.type === 'credit_card' ? null : daOrigem?.id ?? null;
      return {
        titulo: tituloDoAdiantamento(item.source, daHipotese.length, item.title),
        valor: pagamento.amount_cents,
        dataBR: isoToBR(diaDoAplicar(pagamento.start, hoje)),
        conta: contaPadrao,
      };
    }
    return null;
  };
  const [form, setForm] = useState<{ titulo: string; valor: number; dataBR: string; conta: string | null } | null>(null);
  const pronto = form ?? inicial();
  // Os campos assentam no primeiro render com tudo carregado (a conta da origem depende das contas).
  if (!form && pronto && (editando || accounts.data)) setForm(pronto);
  const valores = form ?? pronto;

  const contas = (accounts.data ?? []).filter((a) => !a.archived && (fonte !== 'debt' || a.type !== 'credit_card'));
  const conta = contas.find((a) => a.id === valores?.conta) ?? null;
  const dataISO = valores ? brToISO(valores.dataBR) : '';
  // A data do pagamento vem ANTES de toda parcela coberta: depois dela seria adiar, não adiantar.
  const primeiroDia = cobertas.map((p) => p.dia).filter(Boolean).sort()[0];
  const ultimoPermitido = !editando && primeiroDia ? isoDiaAntes(primeiroDia) : undefined;

  const carregando = editando ? gravado.isPending : (candidatos.isPending || accounts.isPending);
  const sumiu = editando ? (gravado.isSuccess && !registro) : (!pagamento || (candidatos.isSuccess && !daHipotese));

  const falta = !valores ? 'Carregando'
    : !valores.titulo.trim() ? 'Dê um título'
    : valores.valor <= 0 ? 'Informe quanto você pagou'
    : !dataISO ? 'Escolha a data'
    : !conta ? 'Escolha de onde saiu o dinheiro'
    : null;

  const salvar = () => {
    if (falta || !valores || !conta || !fonte) return;
    const aoErrar = (e: unknown) => toast({ message: financeErrorMessage(e, 'Não deu para salvar o adiantamento.'), tone: 'error' });
    if (editando && params.id) {
      editar.mutate(
        { id: params.id, description: valores.titulo.trim(), amount_cents: valores.valor, paid_on: dataISO, account_id: conta.id },
        { onSuccess: () => { toast({ message: 'Adiantamento salvo.', tone: 'success' }); router.back(); }, onError: aoErrar },
      );
      return;
    }
    if (!item || !daHipotese || !params.grupo) return;
    aplicar.mutate(
      {
        source: item.source, ref_id: item.ref_id, paid_on: dataISO, amount_cents: valores.valor,
        account_id: conta.id, description: valores.titulo.trim(), parcelas: pedidoDasParcelas(item.source, daHipotese),
      },
      {
        onSuccess: () => {
          // Pelo grupo: a hipótese certa sai mesmo que o rascunho tenha mudado com a tela aberta.
          setAdiantamentos((lista) => lista.filter((d) => d.grupo !== params.grupo));
          toast({ message: 'Adiantamento registrado.', tone: 'success' });
          router.back();
        },
        onError: aoErrar,
      },
    );
  };

  const itens: ItemNoTempo[] = cobertas.map((p) => {
    const titulo = fonte === 'recurring' || p.n === null ? `Mês de ${isoToBR(p.dia).slice(3)}` : `${p.n}ª parcela`;
    const apoio = p.dia ? `vencia em ${isoToBR(p.dia)}` : undefined;
    return { chave: p.chave, titulo, apoio, cents: p.cents, estado: 'futura',
      accessibilityLabel: `${titulo}${apoio ? `, ${apoio}` : ''}: ${brl(p.cents)}` };
  });
  const diferenca = valores ? soma - valores.valor : 0;
  const quais = editando ? (registro?.modo === 'proximas' ? 'proximas' : 'ultimas') : pagamento?.adiantar?.quais;
  const efeito = efeitoDoAdiantamento(fonte, quais, cobertas.length);
  const quando = !conta || !dataISO ? null
    : conta.type === 'credit_card' ? `Entra na fatura do ${conta.name}.`
    : dataISO <= hoje ? `Entra como pago em ${isoToBR(dataISO)}.`
    : `Fica para pagar em ${isoToBR(dataISO)}.`;
  const salvando = aplicar.isPending || editar.isPending;

  return (
    <Screen>
      <TaskHeader
        title={editando ? 'Editar adiantamento' : 'Aplicar adiantamento'}
        onClose={() => router.back()}
        action={<Button label="Salvar" size="sm" loading={salvando} disabled={Boolean(falta) || sumiu} onPress={salvar} />}
      />
      {sumiu ? (
        <EmptyState
          compacto
          icon="exclamationmark.circle"
          title={editando ? 'Este adiantamento não existe mais' : 'Esta hipótese mudou'}
          hint={editando ? undefined : 'Alguma parcela já foi paga ou mudou. Edite o adiantamento no E se…?'}
        />
      ) : carregando || !valores ? null : (
        <>
          <View style={{ gap: Space.md }}>
            <LinhaDoTempo grupos={[{ titulo: fonte === 'recurring' ? 'Meses adiantados' : 'Parcelas adiantadas', itens }]} />
            {efeito ? <Note icon="info.circle">{efeito}</Note> : null}
          </View>
          <Field label="Título" obrigatorio>
            <TextField
              value={valores.titulo}
              onChangeText={(titulo) => setForm({ ...valores, titulo })}
              accessibilityLabel="Título"
              invalid={!valores.titulo.trim()}
            />
          </Field>
          <Field
            label="Quanto você pagou"
            obrigatorio
            hint={diferenca > 0 ? `Desconto de ${brl(diferenca)} sobre ${brl(soma)}.`
              : diferenca < 0 ? `${brl(-diferenca)} a mais que as parcelas (${brl(soma)}).` : undefined}>
            <MoneyField valueCents={valores.valor} onChangeCents={(valor) => setForm({ ...valores, valor })} invalid={valores.valor <= 0} />
          </Field>
          <Field label="Data do pagamento" obrigatorio>
            <DatePickerField
              value={valores.dataBR}
              onChange={(dataBR) => setForm({ ...valores, dataBR })}
              accessibilityLabel="Data do pagamento"
              max={ultimoPermitido}
              invalid={!dataISO}
            />
          </Field>
          <Field label="De onde saiu o dinheiro" obrigatorio hint={quando ?? undefined}>
            <AccountPicker
              financialContext
              accounts={contas}
              value={valores.conta}
              onChange={(id) => setForm({ ...valores, conta: id })}
              placeholder="Escolher a conta"
            />
          </Field>
          {falta && falta !== 'Carregando' ? <Note tone="warning">{falta}</Note> : null}
        </>
      )}
      <ToastDoModal />
    </Screen>
  );
}

/** O dia anterior a uma data ISO. */
function isoDiaAntes(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d - 1));
  return dia.toISOString().slice(0, 10);
}

/** O que muda na origem, numa frase. */
function efeitoDoAdiantamento(fonte: FonteAdiantavel | null, quais: string | undefined, qtd: number): string | null {
  const parcelas = `${qtd} ${qtd === 1 ? 'parcela' : 'parcelas'}`;
  if (fonte === 'plan') return `${qtd === 1 ? 'Ela sai' : 'Elas saem'} da compra; as outras mantêm o número.`;
  if (fonte === 'recurring') return `${qtd === 1 ? 'Esse mês sai' : 'Esses meses saem'} da série.`;
  if (fonte === 'debt') {
    return quais === 'proximas' ? `O financiamento conta ${parcelas} como pagas.` : `O financiamento termina ${parcelas} antes.`;
  }
  return null;
}
