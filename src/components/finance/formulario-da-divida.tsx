import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CorpoProps } from '@/components/finance/corpo-do-lancar';
import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { SheetScroll } from '@/components/ui/sheet';
import { SkeletonList } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space, tabular } from '@/design/tokens';
import {
  DEBT_KINDS,
  useAccounts,
  useDebtPayments,
  useDebtPaymentVersions,
  useDebts,
  useDebtSchedule,
  useSaveDebt,
  useSaveDebtContractScoped,
  type Debt,
} from '@/hooks/use-finance';
import { localISODate } from '@/hooks/use-items';
import { useRascunho } from '@/hooks/use-rascunho';
import { newClientMessageId } from '@/lib/agent-chat';
import { brToISO, formatNumberBR, isValidBRDate, isoToBR } from '@/lib/dates';
import { askEditScope } from '@/lib/edit-scope';
import { linhaDoFinanciamento } from '@/lib/escrita';
import {
  camposNoOutroModo,
  debtTerm,
  financeErrorMessage,
  parcelaDoTotalDoContrato,
  proximaNoCronograma,
  simpleDebtValues,
  vencimentoDaDividaEscolhido,
  type UnidadeDoValor,
} from '@/lib/finance-form';

/**
 * O formulário da dívida como CORPO (spec 2026-09-29, formulário único): estado, campos e salvar,
 * saídos da folha de Dívidas sem mudar a regra. Quem hospeda decide o que fechar quer dizer
 * (`onFechar`) e o que vem depois de criar (`onSalvo`). A folha de PAGAR continua em Dívidas.
 */

/** 0.0199 → "1,99% a.m." */
export function taxaLabel(fracao: number): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.`;
}

/** "1,99" → 0.0199. Aceita vírgula, que é como o brasileiro digita. */
function parseTaxa(texto: string): number {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n / 100 : 0;
}

export interface FormState {
  calculationMode: 'amortized' | 'fixed_installments';
  id?: string;
  original?: Debt;
  /** O `updated_at` de quando o formulário abriu: o salvar só grava se a dívida não mudou no meio. */
  versao?: string | null;
  name: string;
  kind: Debt['kind'];
  remainingCents: number;
  /** 0 = "nunca paguei nada": vira igual ao saldo devedor na hora de salvar. */
  principalCents: number;
  taxa: string;
  parcelas: string;
  diaVencimento: string;
  installmentsPaid: number;
  historyConfirmed: boolean;
  installmentCents: number;
  accountId: string | null;
  /** Parcela fixa: o valor DIGITADO, na unidade escolhida (cada parcela ou total a pagar). */
  unidade: UnidadeDoValor;
  valorCents: number;
  /**
   * A data da parcela nº 1 do contrato (`debts.first_due_date`). O campo mostra a PRÓXIMA
   * (`pagas + 1`), e escolher uma data refaz a âncora a partir dela — então mudar as pagas
   * anda pelo calendário do contrato, em vez de arrastar a data junto.
   */
  ancora: string | null;
  /** As pagas de quando o formulário abriu: é com elas que o cronograma do banco foi feito. */
  pagasOriginal: number;
}

/**
 * "Cada parcela | Total a pagar" (23/09/2026, decisão do dono do produto: o total é a SOMA DAS
 * PARCELAS, com os juros dentro — o "48× de R$ 1.470" do carnê).
 */
const UNIDADES_DA_DIVIDA = [
  { value: 'parcela', label: 'Cada parcela' },
  { value: 'total', label: 'Total a pagar' },
] as const satisfies readonly { value: UnidadeDoValor; label: string }[];

export const FORM_VAZIO: FormState = {
  calculationMode: 'fixed_installments',
  name: '',
  kind: 'loan',
  remainingCents: 0,
  principalCents: 0,
  taxa: '',
  parcelas: '',
  diaVencimento: '',
  installmentsPaid: 0,
  historyConfirmed: true,
  installmentCents: 0,
  accountId: null,
  unidade: 'parcela',
  valorCents: 0,
  ancora: null,
  pagasOriginal: 0,
};

/** Faixa de erro por seção. Seção que falha DIZ que falhou — nunca some. */
export function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={styles.band}>
      <Icon name="exclamationmark.triangle.fill" size="lg" color="danger" />
      <ThemedText type="small" style={styles.bandText}>
        {message}
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

/**
 * O financiamento a partir da hipótese do "E se…?" (`paramsDoAplicar`): parcela fixa, sem juros
 * digitados, a próxima parcela na data da hipótese. O nome é o que falta — a pessoa dá aqui.
 */
function formDoAplicar(p: { parcela?: string; parcelas?: string; conta?: string; data?: string }): FormState {
  const parcela = Math.max(0, Number(p.parcela) || 0);
  const data = p.data && isValidBRDate(p.data) ? p.data : null;
  return {
    ...FORM_VAZIO,
    kind: 'financing',
    unidade: 'parcela',
    valorCents: parcela,
    installmentCents: parcela,
    parcelas: p.parcelas ?? '',
    accountId: p.conta ?? null,
    diaVencimento: data ? String(Number(data.slice(0, 2))) : '',
    ancora: data ? brToISO(data) : null,
  };
}

/** A dívida aberta para editar. No editar, nome e conta já aparecem: quem abriu veio mudar alguma coisa. */
function formDaDivida(d: Debt): FormState {
  return {
    calculationMode: d.calculation_mode,
    unidade: 'parcela',
    valorCents: Number(d.installment_cents ?? 0),
    ancora: d.first_due_date ?? null,
    pagasOriginal: d.installments_paid,
    id: d.id,
    original: d,
    versao: d.updated_at,
    name: d.name,
    kind: d.kind,
    remainingCents: Number(d.remaining_cents),
    principalCents: Number(d.principal_cents),
    // sem o toFixed, 0.0199 * 100 vira 1.9900000000000002 no campo
    taxa: d.interest_rate_monthly
      ? formatNumberBR(Number((d.interest_rate_monthly * 100).toFixed(4)))
      : d.kind === 'financing' ? '0' : '',
    parcelas: d.installments ? String(d.calculation_mode === 'fixed_installments' ? d.installments : Math.max(d.installments - d.installments_paid, 0)) : '',
    installmentsPaid: d.installments_paid,
    historyConfirmed: true,
    installmentCents: Number(d.installment_cents ?? 0),
    accountId: d.account_id,
    diaVencimento: d.due_day ? String(d.due_day) : '',
  };
}

type Props = CorpoProps & {
  /** Aberta pelo "Aplicar" de uma hipótese: parcela, parcelas, conta e data dela. */
  dadosDoAplicar?: { parcela?: string; parcelas?: string; conta?: string; data?: string };
  /** Aberta DE DENTRO de outro formulário: o ✕ vira "Voltar". */
  voltar?: boolean;
};

export function FormularioDaDivida(props: Props) {
  const debts = useDebts();
  const alvo = props.editandoId ? (debts.data ?? []).find((d) => d.id === props.editandoId) : undefined;
  /*
    Editando sem a dívida carregada, o estado inicial cairia na CRIAÇÃO — e o `useState` não relê:
    "Salvar" gravaria uma dívida nova. Espera (ou diz que falhou); com a dívida, o formulário monta
    com ela, pela chave.
  */
  if (props.editandoId && !alvo && !props.estadoGuardado) {
    return (
      <>
        <TaskHeader title="Editar dívida" onClose={props.onFechar} voltar={props.voltar} />
        <SheetScroll contentContainerStyle={styles.sheetBody}>
          {debts.isError ? (
            <ErrorBand message="Não deu para carregar a dívida." onRetry={() => void debts.refetch()} />
          ) : (
            <SkeletonList linhas={4} />
          )}
        </SheetScroll>
      </>
    );
  }
  return <CorpoDaDivida key={alvo?.id ?? 'nova'} {...props} alvo={alvo} />;
}

function CorpoDaDivida(props: Props & { alvo?: Debt }) {
  const { comum, editandoId, converter, deHipotese, onSalvo, onFechar, registrarComum, registrarEstado, alvo, dadosDoAplicar } = props;
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const toast = useToast();
  const accounts = useAccounts();
  const save = useSaveDebt();
  const saveScoped = useSaveDebtContractScoped();
  const contractAttempt = useRef<{ key: string; id: string } | null>(null);
  /** `deHipotese`: aberta pelo "Aplicar" do "E se…?" — criar tira aquela hipótese do rascunho. */
  const { tirar } = useRascunho();
  /** O corpo ainda está aberto? O que é dele (toast, avisar o hospedeiro) só roda com ele montado. */
  const [montado] = useState(() => ({ current: true }));
  useEffect(() => () => {
    montado.current = false;
  }, [montado]);

  const [form, setForm] = useState<FormState>(() => {
    if (props.estadoGuardado) return props.estadoGuardado as FormState;
    if (alvo) return formDaDivida(alvo);
    if (dadosDoAplicar) return formDoAplicar(dadosDoAplicar);
    const data = comum.dataBR && isValidBRDate(comum.dataBR) ? comum.dataBR : null;
    return {
      ...FORM_VAZIO,
      kind: 'financing',
      name: comum.descricao,
      valorCents: comum.valorCents,
      installmentCents: comum.valorCents,
      accountId: comum.contaId,
      ancora: data ? brToISO(data) : null,
      diaVencimento: data ? String(Number(data.slice(0, 2))) : '',
    };
  });

  useEffect(() => {
    registrarComum(() => ({ kind: 'expense', descricao: form.name, valorCents: form.valorCents, contaId: form.accountId, dataBR: form.ancora ? isoToBR(form.ancora) : comum.dataBR, categoria: comum.categoria }));
    registrarEstado(() => form);
  });

  // O cronograma dá a próxima parcela de quem não tem âncora, e os pagamentos lançados são o piso
  // das "pagas".
  const schedule = useDebtSchedule(form.id);
  const payments = useDebtPayments(form.id);
  const paymentVersions = useDebtPaymentVersions(form.id);
  const pagadoras = (accounts.data ?? []).filter((a) => a.type !== 'credit_card');

  const fracao = parseTaxa(form.taxa);
  const totalDeParcelas = /^\d+$/.test(form.parcelas) ? Number(form.parcelas) : 0;
  /** A parcela do contrato fixo, venha o valor digitado como parcela ou como total a pagar. */
  const parcelaCents = form.unidade === 'total'
    ? parcelaDoTotalDoContrato(form.valorCents, totalDeParcelas)
    : form.valorCents;
  let simpleValues: ReturnType<typeof simpleDebtValues> | null = null;
  if (form.calculationMode === 'fixed_installments') {
    try { simpleValues = simpleDebtValues(parcelaCents, form.parcelas, form.installmentsPaid); } catch { /* Invalid input keeps Save disabled. */ }
  }
  /**
   * Pagamento lançado pelo app é fato: dizer menos pagas do que isso é contradição. O piso é a
   * MAIOR parcela já paga, não só a contagem — com um "Paguei" lançado como a 5ª, dizer 4 pagas
   * deixava a 5ª paga aparecendo como futura na linha do tempo e no cronograma.
   */
  const pagamentosLancados = form.id
    ? Math.max(
        (payments.data ?? []).length,
        ...(payments.data ?? []).map((p) => Number(p.debt_payment_no ?? 0)),
      )
    : 0;
  /**
   * ⚠️ **A âncora só existe quando veio do banco ou foi ESCOLHIDA** (revisão final, 23/09/2026).
   * Deduzir uma âncora da dívida antiga (`schedule[0]` − pagas) parecia inofensivo e não era: o
   * cronograma antigo desliza com o hoje, e corrigir as pagas de 5 para 9 levava a data quatro
   * meses para a frente — quatro parcelas sumindo da projeção, sem erro. Na dívida antiga o campo
   * MOSTRA a próxima do cronograma, e só grava âncora quando a pessoa toca na data.
   */
  const ancoraEfetiva = form.ancora ?? null;
  const diaDoContrato = form.diaVencimento ? Number(form.diaVencimento) : null;
  const proximaISO =
    ancoraEfetiva && diaDoContrato
      ? // A do CRONOGRAMA, não só a do contrato: diminuir as pagas não põe a data no passado.
        proximaNoCronograma(ancoraEfetiva, form.installmentsPaid, diaDoContrato, localISODate())
      : form.id
        ? (schedule.data?.[0]?.due_date ?? null)
        : null;
  /** Valor e prazo preenchidos e sem data: o único motivo de o Salvar estar travado — e a tela diz. */
  const faltaData = Boolean(form.parcelas) && !ancoraEfetiva && !(form.id && diaDoContrato) &&
    (form.calculationMode === 'fixed_installments' ? parcelaCents > 0 : form.remainingCents > 0);
  const rotuloDaData = form.installmentsPaid === 0 ? 'Primeira parcela' : `Próxima parcela (a ${form.installmentsPaid + 1}ª)`;
  const escolherData = (br: string, ultimo = false) => {
    const iso = brToISO(br);
    const escolhido = vencimentoDaDividaEscolhido(iso, form.installmentsPaid, ultimo);
    setForm({ ...form, ancora: escolhido.ancora, diaVencimento: String(escolhido.dia) });
  };
  const mudarPagas = (n: number) => {
    // Pagas além do total assentam no total: é o teto que existe.
    // O teto nunca fica ABAIXO das pagas: digitar "60" passa por "6", e o total não pode arrastar
    // as pagas junto no meio da digitação (o `onBlur` do total é que assenta, frontend.md).
    const teto = totalDeParcelas > 0 ? Math.max(totalDeParcelas, form.installmentsPaid) : Infinity;
    setForm({ ...form, installmentsPaid: Math.max(pagamentosLancados, Math.min(n, teto)), historyConfirmed: true });
  };
  const mudarUnidade = (unidade: UnidadeDoValor) => {
    if (unidade === form.unidade) return;
    // Trocar a unidade sem digitar não move dinheiro: o número muda de régua, o contrato fica.
    const valorCents =
      unidade === 'total' ? form.valorCents * totalDeParcelas : parcelaDoTotalDoContrato(form.valorCents, totalDeParcelas);
    setForm({ ...form, unidade, valorCents: totalDeParcelas > 0 ? valorCents : form.valorCents });
  };
  const nomeOk = form.name.trim().length >= 2;
  /**
   * O nome é obrigatório (23/09/2026: *"ser obrigatório o nome"*) — caía em "Financiamento 2". Com
   * o resto preenchido e o nome faltando, o campo diz por que o Salvar não liga.
   */
  const faltaNome = !nomeOk &&
    (form.calculationMode === 'fixed_installments' ? Boolean(simpleValues) : form.remainingCents > 0);
  /**
   * Contrato com parcelas TEM dia de vencimento — sem ele o cronograma ancora numa
   * data arbitrária e a projeção de caixa passa a mentir sobre quando o dinheiro sai.
   * Dívida sem parcelas ("devo 500 pro João") não tem cadência e continua sem exigir.
   */
  const validDueDay = form.parcelas
    ? Boolean(ancoraEfetiva) || Boolean(form.id && (diaDoContrato === -1 || (diaDoContrato !== null && diaDoContrato >= 1 && diaDoContrato <= 31)))
    : true;
  const advancedValid = nomeOk && (!form.parcelas || form.historyConfirmed) &&
    Number.isInteger(form.installmentsPaid) && form.installmentsPaid >= 0 && form.remainingCents > 0 &&
    (!form.parcelas || Number(form.parcelas) > 0) &&
    (form.kind !== 'financing' || (form.taxa.trim() !== '' && !!form.parcelas)) &&
    Number.isFinite(Number(form.taxa.replace(',', '.'))) && Number(form.taxa.replace(',', '.')) >= 0;
  const podeSalvar = Boolean(nomeOk && validDueDay && (!form.id || payments.isSuccess) && (form.calculationMode === 'fixed_installments' ? simpleValues : advancedValid));

  const salvar = (criarOutro: boolean) => {
    if (!podeSalvar) return;
    const target = {
        id: form.id,
        name: form.name.trim(),
        calculation_mode: form.calculationMode,
        kind: form.kind,
        // sem os dois campos separados a barra de progresso nasce sempre em 0%
        principal_cents: form.principalCents > 0 ? form.principalCents : form.remainingCents,
        remaining_cents: form.remainingCents,
        interest_rate_monthly: fracao,
        installments: debtTerm(form.parcelas, form.installmentsPaid),
        installments_paid: form.installmentsPaid,
        installment_cents: form.installmentCents || null,
        ...(form.calculationMode === 'fixed_installments' && simpleValues ? simpleValues : {}),
        account_id: form.accountId,
        due_day: diaDoContrato,
        // Só com âncora conhecida: sem ela o cronograma segue o jeito antigo, sem data inventada.
        ...(ancoraEfetiva ? { first_due_date: ancoraEfetiva } : {}),
        ...(form.id ? { versao: form.versao ?? null } : {}),
      };
    const aoFalhar = (error: Error) =>
      toast({
        message:
          (error as { code?: string }).code === 'VERSAO'
            ? 'A dívida mudou enquanto você editava (um pagamento pode ter chegado). Feche e abra de novo.'
            : financeErrorMessage(error, 'Não deu para salvar. Já existe uma dívida com esse nome?'),
        tone: 'error',
      });
    if (form.id && form.original) {
      const original = form.original;
      const patch: Record<string, string | number | null> = {};
      const fields = ['name','kind','principal_cents','remaining_cents','interest_rate_monthly',
        'installments','installments_paid','installment_cents','account_id','due_day','first_due_date'] as const;
      for (const field of fields) {
        const wanted = target[field as keyof typeof target];
        if (wanted !== undefined && wanted !== original[field as keyof Debt])
          patch[field] = wanted as string | number | null;
      }
      // Fixed-installment principal and balance are derived from the installment amount.
      if (patch.installment_cents !== undefined && form.calculationMode === 'fixed_installments') {
        delete patch.principal_cents;
        delete patch.remaining_cents;
      }
      if (form.calculationMode !== original.calculation_mode) {
        toast({ message: 'O modo de cálculo não pode ser alterado. Cadastre outro contrato.', tone: 'error' });
        return;
      }
      /*
        Na ficha a pessoa edita o CONTRATO, não uma parcela: "Das próximas parcelas em diante" ou
        "Todas" (28/09/2026). "Só esta" mexia na próxima parcela, que ninguém escolheu, e nome, conta
        e saldo só aceitavam "Todas". Sem pagamento feito, ou sem campo que reescreva o passado (valor,
        dia, conta, nome), as duas dariam o mesmo resultado: salva sem perguntar.
      */
      const salvarNo = (scope: 'future' | 'all') => {
        if (!Object.keys(patch).length) {
          onFechar();
          return;
        }
        if (!paymentVersions.data || paymentVersions.isError) {
          toast({ message: 'Não consegui conferir os pagamentos desta dívida. Tente novamente.', tone: 'error' });
          return;
        }
        const versions = Object.fromEntries(paymentVersions.data.map((p) => [p.id, p.edit_revision]));
        const key = JSON.stringify([form.id, original.installments_paid + 1, scope,
          patch, original.edit_revision, versions]);
        if (contractAttempt.current?.key !== key)
          contractAttempt.current = { key, id: newClientMessageId() };
        saveScoped.mutate({ debtId: form.id!, anchorNo: original.installments_paid + 1,
          scope, patch, debtRevision: original.edit_revision,
          paymentVersions: versions, requestId: contractAttempt.current.id }, {
          onSuccess: () => {
            contractAttempt.current = null;
            toast({ message: 'Dívida atualizada.', tone: 'success' });
            onFechar();
          },
          onError: aoFalhar,
        });
      };
      const mexeNoPassado = Number(original.installments_paid ?? 0) > 0 &&
        ['installment_cents', 'due_day', 'first_due_date', 'account_id', 'name'].some((k) => k in patch);
      if (!mexeNoPassado) {
        salvarNo('future');
        return;
      }
      askEditScope('installment', (scope) => salvarNo(scope === 'all' ? 'all' : 'future'),
        'Todas também corrige os pagamentos já feitos.', { contrato: true });
      return;
    }
    // Editando, o formulário SEMPRE tem o id: sem ele, nunca cai na criação (seria uma duplicata).
    if (editandoId || form.id) return;
    /*
      Convertendo outro registro neste financiamento: o hospedeiro pergunta o alcance e grava. As
      pagas são as do campo (0 ao converter): o banco adota a linha convertida como mais um
      pagamento, e o gatilho do contrato a conta — somá-la aqui contaria duas vezes.
    */
    if (converter) {
      converter({ tipo: 'financiamento', dados: linhaDoFinanciamento(target) });
      return;
    }
    // Pela PROMESSA: aberta pelo "Aplicar" de uma hipótese, ela sai do rascunho mesmo com o corpo já
    // fechado; o que é do corpo (toast, avisar o hospedeiro), só com ele montado.
    save.mutateAsync(target).then(
      () => {
        if (deHipotese) tirar(deHipotese);
        if (!montado.current) return;
        toast({ message: 'Dívida cadastrada.', tone: 'success' });
        onSalvo(criarOutro);
      },
      (error: Error) => {
        if (montado.current) aoFalhar(error);
      },
    );
  };

  const salvando = save.isPending || saveScoped.isPending;
  const dataDoContrato = (
    <Field label={rotuloDaData} error={faltaData ? 'Escolha a data' : undefined}>
      <DatePickerField
        value={proximaISO ? isoToBR(proximaISO) : null}
        onChange={(br) => escolherData(br)}
        onSelectLastDay={(br) => escolherData(br, true)}
        lastDaySelected={diaDoContrato === -1}
        accessibilityLabel={rotuloDaData}
        invalid={faltaData}
      />
      {diaDoContrato ? <ThemedText type="small" themeColor="textSecondary">
        {diaDoContrato === -1 ? 'Vence no último dia de cada mês.' : `Vence todo dia ${diaDoContrato}${diaDoContrato > 28 ? '; nos meses curtos, no último dia disponível.' : '.'}`}
      </ThemedText> : null}
    </Field>
  );

  return (
    <>
      <TaskHeader
        title={form.id ? 'Editar dívida' : 'Nova dívida'}
        onClose={onFechar}
        voltar={props.voltar}
        action={
          <Button
            label="Salvar"
            size="sm"
            loading={salvando}
            disabled={!podeSalvar}
            onPress={() => salvar(false)}
          />
        }
      />

      <SheetScroll contentContainerStyle={styles.sheetBody}>
        {props.topo}
        {/* Os pagamentos lançados são o piso das "pagas": sem eles o Salvar espera — e diz por quê. */}
        {form.id && payments.isError ? (
          <ErrorBand
            message="Não deu para carregar os pagamentos desta dívida."
            onRetry={payments.refetch}
          />
        ) : null}
        {/*
          Nome e conta NO TOPO (23/09/2026, pedido do dono do produto): eram uma linha
          recolhida no fim do "Parcela fixa", e o nome caía em "Financiamento 2". O nome
          abre o formulário e é obrigatório; a conta é opcional.
        */}
        <Field label="Nome" error={faltaNome ? 'Dê um nome' : undefined}>
          <TextField
            value={form.name}
            onChangeText={(name) => setForm({ ...form, name })}
            placeholder="Ex.: Carro"
            autoFocus={!form.id}
            invalid={faltaNome}
          />
        </Field>
        <Field label="Conta que paga">
          <AccountPicker accounts={pagadoras} value={form.accountId} onChange={(accountId: string | null) => setForm({ ...form, accountId })} emptyLabel="Não informar" />
        </Field>
        {/*
          `Chip` é filtro de lista — muitos, ligáveis, resposta imediata. Aqui são cinco
          opções mutuamente exclusivas GRAVADAS num campo, que é o papel do `SelectField`:
          colapsado ele mostra o valor, e a forma de cada tipo vem do glifo em `DEBT_KINDS`.
          Nos DOIS modos (26/09/2026): só existia no "com juros", e a dívida de parcela fixa
          não tinha como trocar de tipo depois de criada.
        */}
        <Field label="Tipo">
          <SelectField
            options={DEBT_KINDS.map((k) => ({ id: k.value, label: k.label, icon: k.icon }))}
            value={form.kind}
            onChange={(kind) => setForm({ ...form, kind: (kind ?? 'loan') as Debt['kind'] })}
            placeholder="Escolher"
          />
        </Field>
        {/* Também na edição (26/09/2026, *"o modo da dívida ele deve poder alterar também"*): a
            parcela, o que falta e as pagas atravessam, e "parcelas" troca de sentido. */}
        <Field label="Cobrança">
          <Segmented
            options={[{ value: 'fixed_installments', label: 'Parcela fixa' }, { value: 'amortized', label: 'Com juros ao mês' }]}
            value={form.calculationMode}
            onChange={(calculationMode) => setForm({ ...form, ...camposNoOutroModo(form, calculationMode) })}
          />
        </Field>
        {form.calculationMode === 'fixed_installments' ? <>
          <Field label="Valor">
            <Segmented options={UNIDADES_DA_DIVIDA} value={form.unidade} onChange={mudarUnidade} />
            <MoneyField
              valueCents={form.valorCents}
              onChangeCents={(valorCents) => setForm({ ...form, valorCents })}
              accessibilityLabel={form.unidade === 'total' ? 'Total a pagar, em reais' : 'Valor de cada parcela, em reais'}
            />
          </Field>
          <Field label="Total de parcelas">
            {/*
              Texto, não `QuantityField`: o prazo do contrato não tem valor padrão honesto, e
              o passo a passo nasceria num "1" que salva um contrato que ninguém disse. Menor
              que as já pagas não existe: ao sair do campo o total assenta nelas.
            */}
            <TextField
              value={form.parcelas}
              onChangeText={(value) => setForm({ ...form, parcelas: value.replace(/\D/g, '').slice(0, 3) })}
              onBlur={() => {
                if (/^\d+$/.test(form.parcelas) && Number(form.parcelas) < form.installmentsPaid) {
                  setForm({ ...form, parcelas: String(form.installmentsPaid) });
                }
              }}
              keyboardType="number-pad"
              placeholder="Ex.: 48"
            />
          </Field>
          <Field
            label="Parcelas já pagas"
            hint={pagamentosLancados > 0 ? `${pagamentosLancados} ${pagamentosLancados === 1 ? 'lançada' : 'lançadas'} pelo app.` : undefined}>
            <QuantityField
              value={form.installmentsPaid}
              min={pagamentosLancados}
              max={totalDeParcelas > 0 ? Math.max(totalDeParcelas, form.installmentsPaid) : 999}
              onChange={mudarPagas}
              accessibilityLabel="Parcelas já pagas"
            />
          </Field>
          {dataDoContrato}
          {/* O contrato que VAI ser gravado: com "Total a pagar" a parcela arredonda. */}
          {simpleValues && <Card style={styles.resumo}>
            <ThemedText type="small" style={tabular}>{`${simpleValues.installments}× de ${brl(parcelaCents)} = ${brl(simpleValues.principal_cents)}`}</ThemedText>
            {form.installmentsPaid > 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {`Falta pagar (${simpleValues.installments - form.installmentsPaid} parcelas) `}
                <Money cents={simpleValues.remaining_cents} variant="headline" />
              </ThemedText>
            ) : null}
          </Card>}
        </> : <>

        <Field label="Quanto você deve hoje">
          <MoneyField
            valueCents={form.remainingCents}
            onChangeCents={(remainingCents) => setForm({ ...form, remainingCents })}
          />
        </Field>

        <Field
          label="Valor original"
          hint="Em branco, vale o que você deve hoje">
          <MoneyField
            valueCents={form.principalCents}
            onChangeCents={(principalCents) => setForm({ ...form, principalCents })}
          />
        </Field>

        <Field label="Juros por mês">
          <View>
            <TextField
              value={form.taxa}
              onChangeText={(taxa) => setForm({ ...form, taxa })}
              placeholder="Ex.: 1,99"
              keyboardType="decimal-pad"
              accessibilityLabel="Juros por mês, em porcentagem"
              accessibilityHint={
                fracao > 0
                  ? `${taxaLabel(fracao)} dá ${brl(Math.round(form.remainingCents * fracao))} de juros no primeiro mês`
                  : undefined
              }
              style={styles.taxaInput}
            />
            <View style={styles.taxaSufixo} pointerEvents="none">
              <ThemedText type="default" themeColor="textSecondary">
                %
              </ThemedText>
            </View>
          </View>
        </Field>

        {/* Prévia ao vivo: errar por um fator de 100 aqui não dá erro nenhum, só um total
            de juros absurdo que ninguém confere. */}
        {fracao > 0 && form.remainingCents > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {taxaLabel(fracao)} dá{' '}
            <Money cents={Math.round(form.remainingCents * fracao)} variant="subhead" tone="danger" />{' '}
            de juros no primeiro mês sobre{' '}
            <Money cents={form.remainingCents} variant="subhead" tone="textSecondary" />
          </ThemedText>
        ) : null}

        {fracao > 0.2 ? (
          <View style={styles.aviso}>
            <Icon name="exclamationmark.triangle" size="sm" color="warning" />
            <ThemedText type="small" themeColor="textSecondary" style={styles.avisoTexto}>
              Taxa alta: confira se é ao mês
            </ThemedText>
          </View>
        ) : null}

        <Field label="Valor da parcela" hint="Em branco, sai dos juros e das parcelas">
          <MoneyField valueCents={form.installmentCents} onChangeCents={(installmentCents) => setForm({ ...form, installmentCents })} />
        </Field>
        <Field label="Parcelas que faltam">
          <TextField
            value={form.parcelas}
            onChangeText={(v) =>
              setForm({ ...form, parcelas: v.replace(/\D/g, '').slice(0, 3) })
            }
            placeholder="Ex.: 12"
            keyboardType="number-pad"
          />
        </Field>
        {form.parcelas !== '' ? dataDoContrato : null}
        {/*
          ⚠️ **Vem DEPOIS de "Parcelas que faltam", porque é esse campo que o cria.**
          Ele renderizava ACIMA, gated em `form.parcelas !== ''` — então digitar o número
          de parcelas fazia um campo novo NASCER acima do dedo e empurrar o formulário
          inteiro para baixo no meio da digitação. É a mesma frase da régua de
          `frontend.md` ("a tela se remonta debaixo do dedo"), só que para cima.
        */}
        {form.parcelas !== '' && (
          <Field label="Parcelas já pagas">
            {/*
              ⚠️ **Sem chip "Nenhuma", e o campo nasce em `0`** (15/09/2026, a mesma régua
              do formulário de lançamento). O chip escrevia exatamente o valor que o campo
              ao lado passaria a mostrar — dois controles para um dado só. O que ele
              existia para resolver era o campo nascer VAZIO precisando de confirmação;
              com default o problema não existe, e a frase logo abaixo diz a conta que saiu
              disso ("N pagas + M restantes").
            */}
            <QuantityField
              value={form.installmentsPaid}
              min={pagamentosLancados}
              max={999}
              onChange={(n) => setForm({ ...form, installmentsPaid: Math.max(pagamentosLancados, n), historyConfirmed: true })}
              accessibilityLabel="Parcelas do financiamento já pagas"
            />
          </Field>
        )}
        {form.parcelas !== '' && form.historyConfirmed && (
          <ThemedText type="small" themeColor="textSecondary">
            {`${Number(form.parcelas) + form.installmentsPaid} parcelas no total`}
          </ThemedText>
        )}
        </>}
        {!editandoId && !converter ? (
          <Button
            variant="secondary"
            block
            label="Salvar e criar outro"
            disabled={!podeSalvar || salvando}
            onPress={() => salvar(true)}
          />
        ) : null}
      </SheetScroll>
    </>
  );
}

const styles = StyleSheet.create({
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  resumo: {
    gap: Space.sm,
  },
  taxaInput: {
    paddingRight: Space.xxxl,
  },
  taxaSufixo: {
    position: 'absolute',
    right: Space.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  avisoTexto: {
    flex: 1,
  },
});
