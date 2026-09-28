import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { CategoryPicker } from '@/components/finance/category-picker';
import { Chip } from '@/components/finance/chip';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { CamposDaSerie } from '@/components/finance/serie-form';
import { CamposDaCompra } from '@/components/finance/compra-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { TaskHeader } from '@/components/ui/task-header';
import { SwitchRow } from '@/components/ui/switch-row';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { Motion, Space, Type } from '@/design/tokens';
import {
  useAccounts,
  useConvertToInstallments,
  useCreateInstallmentPlan,
  useUpdateInstallmentPlan,
  useInstallmentPlan,
  useDebts,
  useDebtPaymentVersions,
  useDeleteTransaction,
  useSaveDebtPaymentScoped,
  useSaveTransaction,
  useSaveInstallmentOccurrence,
  useRecurringTransactions,
  useSaveRecurringOccurrenceAndSeries,
  useSaveRecurringAll,
  useSaveRecurringOne,
  useTransaction,
  useJurosDoPix,
  DESCRICAO_JUROS_DO_PIX,
  type InstallmentPlanSummary,
  type Transaction,
  type TransactionKind,
} from '@/hooks/use-finance';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { mudaInicioDaSerie, mudancasDaOcorrencia, serieDaOcorrencia, validaSerie, type SerieForm } from '@/lib/serie';
import { compraDoRegistro, edicaoEscopadaDaCompra, payloadDaCompra, validaCompra, type CompraForm } from '@/lib/compra';
import {
  destinoDoSalvar,
  faixaDeParcelas,
  financeErrorMessage,
  installmentHistory,
  podeParcelar,
  totalDigitado,
  UNIDADES_DO_VALOR,
  vencimentoPendenteValido,
  type UnidadeDoValor,
} from '@/lib/finance-form';
import { QuantityField } from '@/components/ui/quantity-field';
import {
  autoConfirmLabel,
  caixaLabels,
  dueFieldLabel,
} from '@/lib/settle-labels';
import { confirmDestructive } from '@/lib/item-actions';
import { correcaoDoPagamento } from '@/lib/confirmar-baixa';
import { AccountPicker } from '@/components/finance/account-picker';
import { transicaoDeLayout } from '@/components/motion/transicao';
import { debtPaymentPatch, selectedDebtPaymentVersions, type DebtPaymentScope } from '@/lib/debt-payment-scope';
import { newClientMessageId } from '@/lib/agent-chat';
import { askEditScope } from '@/lib/edit-scope';

/**
 * Novo/editar lançamento — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * O item em edição vem de `useTransaction(id)`, nunca do cache da lista: com cache frio o modal
 * de EDIÇÃO virava modal de CRIAÇÃO em silêncio e duplicava o lançamento. Por isso a decisão
 * "é edição ou criação?" acontece ANTES de montar o form (o gate abaixo) — enquanto a query não
 * responde, não existe formulário para submeter.
 */

const KINDS = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
] as const satisfies readonly { value: TransactionKind; label: string }[];

const schema = z
  .object({
    kind: z.enum(['expense', 'income', 'transfer']),
    amount_cents: z.number().int().positive('Informe o valor'),
    category: z.string().nullable(),
    description: z.string().trim().min(1, 'Escreva um título para este lançamento'),
    merchant: z.string().nullable(),
    account_id: z.string().nullable(),
    counterparty_account_id: z.string().nullable(),
    // 1 = à vista; >= 2 vira plano de parcelas (RPC create_installment_plan)
    installments: z.number().int().min(1).max(72),
    // Pix no crédito: o que o cartão cobra a MAIS do que o boleto pediu. 0 = compra normal.
    fee_cents: z.number().int().min(0),
    /** `transactions.auto_confirm` — entra sozinho na data em vez de esperar baixa. */
    auto_confirm: z.boolean(),
    paid_installments: z.string(),
    occurred_at: z.string().refine(isValidBRDate, 'Data em dd/mm/aaaa'),
    /** "Isso ainda vai acontecer" — vira `status='pending'`, a base da projeção de caixa. */
    pending: z.boolean(),
    /** Uma parcela já tem sua data no cronograma; o vencimento extra pode ficar vazio. */
    installment_occurrence: z.boolean(),
    due_at: z.string().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.installments <= 1 || !isValidBRDate(data.occurred_at)) return;
    try { installmentHistory(data.paid_installments, data.installments, brToISO(data.occurred_at), localISODate()); }
    catch (error) { ctx.addIssue({ code: 'custom', path: ['paid_installments'], message: (error as Error).message }); }
  })
  .refine((data) => data.installments === 1 || (data.kind === 'expense' && !!data.account_id), {
    message: 'Parcelamento precisa de uma conta/cartão e só vale para gastos',
    path: ['installments'],
  })
  .refine((data) => data.kind !== 'transfer' || !!data.counterparty_account_id, {
    message: 'Escolha a conta de destino',
    path: ['counterparty_account_id'],
  })
  .refine(
    (data) =>
      data.kind !== 'transfer' ||
      !data.counterparty_account_id ||
      data.account_id !== data.counterparty_account_id,
    { message: 'Origem e destino precisam ser diferentes', path: ['counterparty_account_id'] },
  )
  .refine((data) => vencimentoPendenteValido(data.pending, data.installment_occurrence, data.due_at), {
    message: 'Informe o vencimento em dd/mm/aaaa',
    path: ['due_at'],
  })
  // ISO compara lexicograficamente, então `>=` já é comparação de data.
  .refine(
    (data) =>
      !data.pending ||
      !data.due_at ||
      !isValidBRDate(data.due_at) ||
      !isValidBRDate(data.occurred_at) ||
      brToISO(data.due_at) >= brToISO(data.occurred_at),
    { message: 'O vencimento não pode ser antes da data do lançamento', path: ['due_at'] },
  );

type FormValues = z.infer<typeof schema>;

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<{ id?: string; conta?: string }>();
  const query = useTransaction(params.id);
  // A parcela edita o valor da COMPRA: sem o plano (travadas, total) o campo não sabe o que
  // "cada parcela" alcança. Espera junto com a linha, na mesma tela de esqueleto.
  const planoId = query.data?.installment_plan_id;
  const plano = useInstallmentPlan(planoId);
  const esperandoPlano = Boolean(planoId) && plano.isPending;
  // O juro do Pix desta compra, se houver: o campo abre com ele (26/09/2026, "tudo que se cria se
  // edita"). Mesmo esqueleto — `useForm` só lê os valores na montagem.
  const juros = useJurosDoPix(query.data);
  const esperandoJuros = juros.fetchStatus === 'fetching' && juros.isPending;

  if (params.id && (query.isLoading || esperandoPlano || esperandoJuros)) {
    return (
      <Screen scroll={false}>
        <TaskHeader title="Editar lançamento" onClose={() => router.back()} />
        <View style={[styles.body, styles.loading]}>
          <Skeleton height={56} />
          <Skeleton height={36} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
        </View>
      </Screen>
    );
  }

  // Nunca cair em modo criação por omissão: um id que não resolve é erro, não formulário vazio.
  // A compra da parcela também: sem ela o campo Valor não sabe o que "cada parcela" alcança.
  if (params.id && (query.isError || !query.data || (planoId && plano.isError))) {
    const semLinha = query.isError || !query.data;
    return (
      <Screen scroll={false}>
        <TaskHeader title="Lançamento" onClose={() => router.back()} />
        <View style={styles.body}>
          <Card>
            <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">
              {semLinha ? 'Não encontrei esse lançamento' : 'Não deu para carregar a compra desta parcela'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {semLinha ? 'Ele pode ter sido apagado em outro aparelho.' : 'Pode ter sido a conexão.'}
            </ThemedText>
            <View style={styles.errorActions}>
              <Button
                label="Tentar de novo"
                variant="secondary"
                size="sm"
                onPress={() => (semLinha ? query.refetch() : plano.refetch())}
              />
              <Button label="Voltar" size="sm" onPress={() => router.back()} />
            </View>
            </View>
          </Card>
        </View>
      </Screen>
    );
  }

  // `?? undefined`: `useTransaction` devolve null quando a linha não existe mais
  // (maybeSingle), e "não achei" e "não estou editando" são o mesmo caso aqui —
  // o form abre em branco, que é o comportamento de criar.
  const editing = query.data ?? undefined;
  return (
    // Outro id é outro formulário: aberto por link sobre um já aberto, a tela era reaproveitada
    // e o `useForm` (que só lê os valores na montagem) seguia com o lançamento anterior.
    <TransactionForm
      key={params.id ?? `novo:${params.conta ?? ''}`}
      editing={editing}
      plano={plano.data ?? undefined}
      jurosDoPix={juros.data ?? null}
      conta={editing ? undefined : params.conta}
    />
  );
}

function TransactionForm({
  editing,
  plano,
  jurosDoPix,
  conta,
}: {
  editing?: Transaction;
  /** A compra desta parcela, quando `editing` é parcela e o plano carregou. */
  plano?: InstallmentPlanSummary;
  /** A linha de juros do Pix que nasceu com esta compra (`useJurosDoPix`). */
  jurosDoPix?: { id: string; amount_cents: number } | null;
  /**
   * `?conta=` — "Nova compra neste cartão" na fatura, "Lançar" nos lançamentos de uma conta: o
   * lançamento novo nasce nela. Só vale se ela está entre as contas da pessoa.
   */
  conta?: string;
}) {
  const insets = useSafeAreaInsets();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const contas = useAccounts();
  const accounts = contas.data;

  const save = useSaveTransaction();
  const salvarParcela = useSaveInstallmentOccurrence();
  const createPlan = useCreateInstallmentPlan();
  const converter = useConvertToInstallments();
  const remove = useDeleteTransaction();

  /*
    ⚠️ **Na ocorrência de uma SÉRIE a data É o vencimento** (26/09/2026). O agendador grava
    `occurred_at = due_at`, e a tela mostrava as duas — "Data" e "Vence em" — para o mesmo dia; o
    Fundacred ficou com 04/09 e 30/09 e a pergunta foi *"tem duas datas… a outra que eu não sei o
    que é"*. Aqui há um campo só, e o vencimento escondido anda junto com ele.
  */
  // Fora do cartão: lá `due_at` é o vencimento da FATURA, e a data da compra é outra coisa.
  const umaData = Boolean(editing?.recurring_id && !editing.invoice_id);
  const dataDaSerie = umaData && editing?.status === 'pending' ? (editing.due_at ?? editing.occurred_at) : null;

  const { control, handleSubmit, setValue, getValues, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // `editing` já chegou resolvido pelo gate — sem `useEffect`+`reset`, sem corrida.
    defaultValues: {
      kind: editing?.kind ?? 'expense',
      amount_cents: editing?.amount_cents ?? 0,
      category: editing?.category ?? null,
      description: editing?.description ?? '',
      merchant: editing?.merchant ?? null,
      account_id: editing?.account_id ?? (conta && accounts?.some((a) => a.id === conta) ? conta : null),
      counterparty_account_id: editing?.counterparty_account_id ?? null,
      installments: 1,
      paid_installments: '0',
      fee_cents: jurosDoPix?.amount_cents ?? 0,
      auto_confirm: editing?.auto_confirm ?? false,
      occurred_at: isoToBR(dataDaSerie ?? editing?.occurred_at ?? localISODate()),
      pending: editing?.status === 'pending',
      installment_occurrence: Boolean(editing?.installment_plan_id),
      due_at: dataDaSerie ? isoToBR(dataDaSerie) : editing?.due_at ? isoToBR(editing.due_at) : null,
    },
  });

  // useWatch (e não watch()): watch() não é memoizável e o React Compiler pula a tela inteira
  const kind = useWatch({ control, name: 'kind' });
  const occurredAt = useWatch({ control, name: 'occurred_at' });
  const accountId = useWatch({ control, name: 'account_id' });
  const amountCents = useWatch({ control, name: 'amount_cents' });
  const installmentCount = useWatch({ control, name: 'installments' });
  const pending = useWatch({ control, name: 'pending' });
  const errors = formState.errors;

  // "ontem" congelado na abertura do modal: ler o relógio durante o render é impuro
  // (React Compiler) e o modal é efêmero. "hoje" saiu junto com o chip dele — quem põe a data de
  // hoje no campo é o `defaultValues`, uma vez só.
  const [{ yesterday }] = useState(() => ({
    yesterday: isoToBR(localISODate(new Date(Date.now() - 86_400_000))),
  }));

  const account = (accounts ?? []).find((a) => a.id === accountId);
  const isCard = account?.type === 'credit_card';
  /**
   * Onde o campo "Juros do Pix no crédito" EXISTE. É a mesma condição no campo e no payload: o
   * valor ficava no formulário quando o campo sumia (trocar a conta para a corrente, o tipo para
   * receita, ou parcelar), e o salvar gravava uma segunda linha de juros que a tela não mostrava
   * mais — virando receita de juros, ou transferência (22/09/2026).
   */
  // Editando também (26/09/2026): o juro esquecido se soma depois, e o que existe se corrige. Não
  // em parcela, série ou pagamento de dívida — esses têm o próprio contrato.
  const mostraJuros =
    isCard && kind === 'expense' && installmentCount === 1 &&
    !(editing?.installment_plan_id || editing?.recurring_id || editing?.debt_id) &&
    editing?.description !== DESCRICAO_JUROS_DO_PIX;
  /**
   * Conta a pagar não existe em cartão: a compra já entra na fatura e o caixa sai quando a
   * fatura vence. Marcar `pending` aqui contaria o MESMO gasto duas vezes na projeção.
   *
   * ⚠️ **"Vou pagar depois" e "parcelar" não convivem no mesmo salvamento.** A conversão é uma
   * RPC própria e não carrega `status`, `due_at` nem `auto_confirm`: oferecer os dois faria a
   * pessoa preencher um vencimento que seria descartado em silêncio — o mesmo defeito do achado
   * A, com outra cara. Parcelar já diz quando cada parcela acontece.
   */
  // Pagamento de dívida é sempre PAGO (trigger da dívida): adiar seria recusado pelo banco.
  const podeAdiar = kind !== 'transfer' && !isCard && installmentCount <= 1 && !editing?.debt_id;
  // O campo "Data" É o vencimento: rótulo "Vence em" e sem o atalho "Ontem" (vencimento não é compra).
  const dataEVencimento = umaData && podeAdiar && pending;
  /* Ao salvar uma parcela, a pessoa escolhe entre a linha e a compra inteira. A compra inteira
     abre `CamposDaCompra` para revisar total, conta, número, data inicial e parcelas já pagas. */
  const naCompra = Boolean(editing?.installment_plan_id);
  /**
   * Esta parcela está numa FATURA de cartão paga, adiada ou paga em parte: o valor e a data dela
   * não mudam — mudar a tiraria da fatura em que foi paga. Fora do cartão, a paga se corrige à
   * mão (é o registro da pessoa).
   */
  const parcelaNaFatura = Boolean(naCompra && editing?.invoice_id && plano?.locked_ids.includes(editing.id));
  /** Criando/convertendo em N×: a unidade REINTERPRETA o número digitado ("250 é cada parcela"). */
  const [unidade, setUnidade] = useState<UnidadeDoValor>('total');
  const [formCompra, setFormCompra] = useState<CompraForm | null>(null);
  const atualizarCompra = useUpdateInstallmentPlan();
  const compraOk = validaCompra(formCompra).podeSalvar;

  /**
   * ⚠️ **Parcelar também vale EDITANDO.** A régua mora em `finance-form.ts`, com teste — aqui
   * era `kind === 'expense' && !!accountId && !editing`, e o `!editing` é o que fez a mesma
   * compra aparecer duas vezes na fatura (19/09/2026).
   */
  const podeParcelarAqui = podeParcelar(kind, accountId, editing);
  /**
   * Histórico ("3 das 12 já foram pagas"): na criação E ao parcelar um lançamento que já existe
   * (26/09/2026, `convert_transaction_to_installments` com as já pagas) — o mesmo campo.
   */
  const podeInformarHistorico = podeParcelarAqui;
  /** Achado B: esconde o Segmented de tipo numa linha de série — ver o ⚠️ no Controller de `kind`. */
  const naSerieEditada = Boolean(editing?.installment_plan_id || editing?.recurring_id);
  /** Pagamento de dívida também: o trigger da dívida exige despesa PAGA, e recusaria a troca. */
  const tipoTravado = naSerieEditada || Boolean(editing?.debt_id);

  /**
   * ⚠️ **A fileira de parcelas sumir não pode deixar `installments` inválido para trás.**
   * `podeParcelarAqui` cai para `false` ao trocar o tipo para algo que não é gasto, ou ao
   * limpar a conta — e sem este reset o zod reprova um `installments > 1` que não está mais na
   * tela, deixando o "Salvar" desabilitado sem dizer por quê (o defeito espelho do §7b).
   */
  const resetParcelasSeEscondeu = () => {
    if (installmentCount > 1) {
      setValue('installments', 1);
      setValue('paid_installments', '0');
    }
  };

  /* A ocorrência começa com os campos da linha. Em Salvar, a pessoa escolhe o alcance; os
     campos da série, quando abertos, usam o mesmo grupo de Recorrentes. */
  const series = useRecurringTransactions();
  const serie = editing?.recurring_id ? series.data?.find((r) => r.id === editing.recurring_id) : undefined;
  const [formSerie, setFormSerie] = useState<SerieForm | null>(null);
  const [intencaoDoDia, setIntencaoDoDia] = useState<'fixo' | 'ultimo' | null>(null);
  const editarSerie = useSaveRecurringOccurrenceAndSeries();
  const editarTodaSerie = useSaveRecurringAll();
  const editarUmaRecorrencia = useSaveRecurringOne();
  const tentativaTodaSerie = useRef<{ key: string; id: string } | null>(null);
  const tentativaUmaRecorrencia = useRef<{ key: string; id: string } | null>(null);
  const tentativaFuturoSerie = useRef<{ key: string; id: string } | null>(null);
  const serieOk = validaSerie(formSerie).podeSalvar;
  const mudaData = (br: string, intencao: 'fixo' | 'ultimo' = 'fixo') => {
    setValue('occurred_at', br, { shouldValidate: true });
    if (umaData) setValue('due_at', br);
    if (editing?.recurring_id) setIntencaoDoDia(intencao);
  };

  /** Linhas e regra são uma transação no banco: nenhum resultado parcial. */
  const salvarAsProximas = (form = formSerie) => {
    if (!form || !editing || !serie) return;
    if (!validaSerie(form).podeSalvar) {
      toast({ message: 'Confira o vencimento e os dados da série antes de salvar.', tone: 'error' });
      return;
    }
    const { linhas, regra } = mudancasDaOcorrencia(form, editing, serie);
    const feito = (aviso?: string | null) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      toast({ message: aviso ?? 'Alterei esta e as próximas.', tone: 'success' });
    };
    if (Object.keys(linhas).length === 0 && Object.keys(regra).length === 0) return feito();
    const key = JSON.stringify([editing.id, linhas, regra, serie.edit_revision]);
    if (tentativaFuturoSerie.current?.key !== key) {
      tentativaFuturoSerie.current = { key, id: newClientMessageId() };
    }
    editarSerie.mutate(
      {
        id: editing.id, recurringId: serie.id, linePatch: linhas, seriesPatch: regra,
        expectedRevision: serie.edit_revision, requestId: tentativaFuturoSerie.current.id,
      },
      {
        onSuccess: ({ aviso }) => {
          tentativaFuturoSerie.current = null;
          feito(aviso);
        },
        onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para salvar. Tenta de novo.'), tone: 'error' }),
      },
    );
  };

  const rascunhoDaSerie = () => {
    if (!editing || !serie) return null;
    const values = getValues();
    const base = serieDaOcorrencia(serie, {
      ...editing,
      amount_cents: values.amount_cents,
      description: values.description,
      merchant: values.merchant,
      category: values.category,
      account_id: values.account_id,
    });
    const alterouData = values.occurred_at !== isoToBR(dataDaSerie ?? editing.occurred_at);
    return alterouData || intencaoDoDia
      ? mudaInicioDaSerie(base, values.occurred_at, intencaoDoDia === 'ultimo')
      : base;
  };

  const salvarTodaSerie = (form = formSerie ?? rascunhoDaSerie()) => {
    if (!form || !editing || !serie) return;
    if (!validaSerie(form).podeSalvar) {
      toast({ message: 'Confira o vencimento e os dados da série antes de salvar.', tone: 'error' });
      return;
    }
    const { linhas, regra } = mudancasDaOcorrencia(form, editing, serie);
    if (!Object.keys(linhas).length && !Object.keys(regra).length) {
      router.back();
      return;
    }
    const key = JSON.stringify([serie.id, linhas, regra, serie.edit_revision]);
    if (tentativaTodaSerie.current?.key !== key) {
      tentativaTodaSerie.current = { key, id: newClientMessageId() };
    }
    editarTodaSerie.mutate({
      recurringId: serie.id,
      linePatch: linhas,
      seriesPatch: regra,
      expectedRevision: serie.edit_revision,
      requestId: tentativaTodaSerie.current.id,
    }, {
      onSuccess: () => {
        tentativaTodaSerie.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      },
      onError: (error) => toast({
        message: financeErrorMessage(error, 'Nada foi salvo. Confira a recorrência e tente novamente.'),
        tone: 'error',
      }),
    });
  };

  /**
   * "A compra toda": os campos de Parceladas, a mesma RPC. "À vista" apaga as outras parcelas —
   * confirmação destrutiva que NOMEIA o estrago (`design.md §6`), como em Parceladas.
   */
  const salvarCompraToda = () => {
    if (!formCompra || !compraOk) return;
    const compra = formCompra;
    const gravarCompra = () =>
      atualizarCompra.mutate(payloadDaCompra(compra, brToISO(compra.inicio)), {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
          toast({
            message:
              compra.installments === 1
                ? `Desfiz o parcelamento: sobrou um lançamento de ${formatBRL(compra.totalCents)}.`
                : 'Compra atualizada.',
            tone: 'success',
          });
        },
        onError: (error) =>
          toast({ message: financeErrorMessage(error, 'Não deu para editar a compra. Tenta de novo.'), tone: 'error' }),
      });
    if (compra.installments === 1) {
      const somem = Math.max(compra.original.installments - 1, 0);
      confirmDestructive(
        'Desfazer o parcelamento?',
        'Desfazer',
        gravarCompra,
        somem === 1
          ? `A outra parcela some e sobra um lançamento de ${formatBRL(compra.totalCents)}. Isso não volta.`
          : `As outras ${somem} parcelas somem e sobra um lançamento de ${formatBRL(compra.totalCents)}. Isso não volta.`,
      );
      return;
    }
    gravarCompra();
  };
  const salvarPagamentoDivida = useSaveDebtPaymentScoped();
  const versoesPagamentos = useDebtPaymentVersions(editing?.debt_id ?? undefined);
  const tentativaPagamento = useRef<{ key: string; id: string } | null>(null);
  const saving =
    save.isPending || createPlan.isPending || converter.isPending || atualizarCompra.isPending || salvarPagamentoDivida.isPending ||
    salvarParcela.isPending || editarSerie.isPending || editarTodaSerie.isPending || editarUmaRecorrencia.isPending;

  /**
   * Pagamento de dívida (25/09/2026): o banco decide o que o valor novo pode ser, e a tela diz
   * ANTES do Salvar — o erro chegava depois, atrás do teclado, e parecia que o Salvar não fazia
   * nada. Na parcela fixa o valor novo ainda pergunta se vale para as próximas parcelas.
   */
  const dividas = useDebts();
  const divida = editing?.debt_id ? dividas.data?.find((d) => d.id === editing.debt_id) ?? null : null;
  const correcaoDaDivida =
    divida && editing ? correcaoDoPagamento(divida, editing, amountCents) : { erro: null, perguntaAsProximas: false };

  const onSubmit = handleSubmit((values) => {
    /**
     * UMA escrita, e qual delas é decisão pura (`destinoDoSalvar`, com teste). As três são
     * exclusivas de propósito: duas escritas para uma intenção é a compra duplicada na fatura.
     */
    const destino = destinoDoSalvar(editing, {
      installments: values.installments,
      account_id: values.account_id,
    });
    // O que o número digitado vale como TOTAL — criando e convertendo, a unidade o reinterpreta.
    const totalDaCompraNova = totalDigitado(values.amount_cents, unidade, values.installments);
    // Reforço do `podeAdiar`: trocar para cartão depois de marcar "vou pagar depois" não
    // pode vazar um `pending` que a UI já escondeu.
    const adiado = podeAdiar && values.pending;
    /**
     * ⚠️ Em cartão o campo "vou pagar depois" NÃO existe (`podeAdiar` é false), então
     * `adiado` é sempre false ali — e escrever `'cleared'` a partir disso DAVA BAIXA numa
     * parcela futura só porque alguém corrigiu o nome dela. A projeção de caixa e o total
     * da fatura mudavam sozinhos, sem nada na tela dizendo isso.
     *
     * Onde o campo não aparece, o status não é do formulário: ele é o que já era.
     */
    const status = podeAdiar ? (adiado ? 'pending' : 'cleared') : (editing?.status ?? 'cleared');
    const dueAt = adiado && values.due_at ? brToISO(values.due_at) : editing?.due_at ?? null;
    /**
     * ⚠️ **Mesma regra do `status` logo acima, e pelo mesmo motivo.** Em cartão e em
     * transferência o campo "vou pagar depois" não existe (`podeAdiar` é false), então
     * `adiado` é sempre false ali — e escrever `false` a partir disso DESLIGAVA o automático
     * de um lançamento só porque alguém corrigiu o nome dele. **Onde o campo não aparece, o
     * valor é o que já era.**
     */
    const autoConfirm = podeAdiar
      ? (adiado ? values.auto_confirm : false)
      : (editing?.auto_confirm ?? false);

    // parcelado NOVO: quem cria as N transações (e resolve a fatura de cada uma) é o banco, não
    // o app — mesma regra usada pelo WhatsApp.
    if (destino === 'criarPlano' && values.account_id) {
      createPlan.mutate(
        {
          accountId: values.account_id,
          totalCents: totalDaCompraNova,
          installments: values.installments,
          paidInstallments: installmentHistory(values.paid_installments, values.installments, brToISO(values.occurred_at), localISODate()),
          occurredAt: brToISO(values.occurred_at),
          description: values.description.trim(),
          category: values.category,
          // Sem esta linha o campo "Estabelecimento" era preenchido e descartado: a compra
          // parcelada nascia como "Compra parcelada (1/N)" e o nome não existia em lugar
          // nenhum. Ver o ⚠️ em `useCreateInstallmentPlan`.
          merchant: values.merchant?.trim() || null,
        },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
            // O `hint` do campo encurtou para caber no teto de 90 caracteres (design.md §7b), e
            // explicação passou a morar na confirmação da ação. Sem esta linha, quem CRIA uma
            // compra parcelada deixa de saber que as futuras já entram nas próximas faturas —
            // a frase existia antes e sumiria sem substituto.
            toast({
              message: `Parcelei em ${values.installments}x. As futuras já entram nas próximas faturas.`,
              tone: 'success',
            });
          },
          onError: (error) =>
            toast({ message: financeErrorMessage(error, 'Não deu para parcelar. Tenta de novo.'), tone: 'error' }),
        },
      );
      return;
    }

    /**
     * Um lançamento que já existe virando compra parcelada.
     *
     * ⚠️ **A RPC ADOTA a linha existente como parcela 1** — não há "apaga e cria de novo", o
     * `id` não muda, e chamar duas vezes é recusa. É o que impede a duplicação de existir.
     *
     * `values.amount_cents` é o TOTAL da compra aqui, como na criação; o `hint` do campo escreve
     * isso na tela.
     */
    if (destino === 'converter' && editing && values.account_id) {
      const contaParaConverter = values.account_id;
      const parcelar = () =>
        converter.mutate(
          {
            transactionId: editing.id,
            totalCents: totalDaCompraNova,
            installments: values.installments,
            firstOccurredAt: brToISO(values.occurred_at),
            description: values.description.trim(),
            category: values.category,
            merchant: values.merchant?.trim() || null,
            accountId: contaParaConverter,
            paidInstallments:
              installmentHistory(values.paid_installments, values.installments, brToISO(values.occurred_at), localISODate()) || null,
          },
          {
            onSuccess: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
              toast({
                message: `Parcelei em ${values.installments}x. As futuras já entram nas próximas faturas.`,
                tone: 'success',
              });
            },
            onError: (error) =>
              toast({
                message: financeErrorMessage(error, 'Não deu para parcelar. Tenta de novo.'),
                tone: 'error',
              }),
          },
        );

      /**
       * ⚠️ **Converter um lançamento JÁ BAIXADO é de mão única.** A parcela 1 continua paga, e
       * com parcela paga o banco RECUSA desparcelar (`1 <> installments` cai no mesmo guarda que
       * protege o número de parcelas). Desfazer só apagando a compra inteira e lançando de novo.
       * Decisão do dono do produto em 20/09/2026, com o custo aceito na mesma frase — e é por
       * isso que ele aparece aqui, como confirmação destrutiva e não como `hint`.
       *
       * Lançamento em aberto não pergunta nada: ali o desparcelar continua valendo.
       */
      if (editing.status === 'cleared') {
        confirmDestructive(
          'Parcelar um lançamento já baixado?',
          'Parcelar',
          parcelar,
          values.installments === 2
            ? 'A 1ª parcela continua paga e a 2ª fica pendente. Isso não dá para desfazer depois.'
            : `A 1ª parcela continua paga e as outras ${values.installments - 1} ficam pendentes. Isso não dá para desfazer depois.`,
        );
        return;
      }
      parcelar();
      return;
    }

    // A decisão de escopo já aconteceu no Salvar; este caminho grava só a linha.
    const fechar = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    };
    if (naCompra && editing) {
      salvarParcela.mutate({
        id: editing.id,
        patch: {
          amount_cents: values.amount_cents,
          category: values.category,
          description: values.description.trim(),
          merchant: values.merchant?.trim() || null,
          occurred_at: brToISO(values.occurred_at),
          status,
          due_at: dueAt,
          auto_confirm: autoConfirm,
        },
      }, {
        onSuccess: fechar,
        onError: (error) => toast({
          message: financeErrorMessage(error, 'Nada foi salvo. Confira a parcela e tente novamente.'),
          tone: 'error',
        }),
      });
      return;
    }
    const gravar = () =>
      save.mutate(
      {
        id: editing?.id,
        kind: values.kind,
        amount_cents: values.amount_cents,
        category: values.kind === 'transfer' ? null : values.category,
        description: values.description.trim(),
        merchant: values.merchant?.trim() || null,
        account_id: values.account_id,
        counterparty_account_id: values.kind === 'transfer' ? values.counterparty_account_id : null,
        occurred_at: brToISO(values.occurred_at),
        status,
        due_at: dueAt,
        // Campo que não aparece não escreve (finance.md): juro só onde a pergunta existe
        fee_cents: mostraJuros ? values.fee_cents : 0,
        juros: editing && mostraJuros ? { id: jurosDoPix?.id ?? null, cents: values.fee_cents } : undefined,
        auto_confirm: autoConfirm,
      },
      {
        onSuccess: () => {
          fechar();
        },
        // Erro NUNCA fecha o modal: o que foi digitado continua na tela.
        onError: (error) =>
          toast({
            message:
              error && typeof error === 'object' && 'compraSalva' in error
                ? 'Salvei a compra, mas não o juro do Pix. Tenta de novo.'
                : financeErrorMessage(error, 'Não deu para salvar. Tenta de novo.'),
            tone: 'error',
          }),
      },
    );

    if (correcaoDaDivida.erro) return;
    gravar();
  });

  const salvarPagamento = (scope: DebtPaymentScope) => handleSubmit((values) => {
    if (!editing || !divida || editing.debt_payment_no === null) return;
    if (!versoesPagamentos.data || versoesPagamentos.isError) {
      toast({ message: 'Não consegui carregar os pagamentos desta dívida. Tente novamente.', tone: 'error' });
      return;
    }
    const patch = debtPaymentPatch(editing, {
      amount_cents: values.amount_cents,
      category: values.category,
      description: values.description.trim(),
      merchant: values.merchant?.trim() || null,
      account_id: values.account_id,
      occurred_at: brToISO(values.occurred_at),
    });
    if (!Object.keys(patch).length) {
      router.back();
      return;
    }
    if (scope !== 'one' && patch.occurred_at) {
      toast({
        message: 'A data é a baixa deste pagamento. Salve só este ou altere o vencimento das próximas na dívida.',
        tone: 'error',
      });
      return;
    }
    let paymentVersions: Record<string, number>;
    try {
      paymentVersions = selectedDebtPaymentVersions(
        versoesPagamentos.data, editing.id, editing.debt_payment_no, scope);
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : 'Atualize os pagamentos e tente novamente.', tone: 'error' });
      return;
    }
    const key = JSON.stringify([editing.id, scope, patch, divida.edit_revision, editing.edit_revision, paymentVersions]);
    if (tentativaPagamento.current?.key !== key) tentativaPagamento.current = { key, id: newClientMessageId() };
    salvarPagamentoDivida.mutate({
      anchorId: editing.id,
      scope,
      patch,
      debtRevision: divida.edit_revision,
      anchorRevision: editing.edit_revision,
      paymentVersions,
      requestId: tentativaPagamento.current.id,
    }, {
      onSuccess: () => {
        tentativaPagamento.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      },
      onError: (error) => toast({ message: financeErrorMessage(error, 'Nada foi salvo. Confira a dívida e tente novamente.'), tone: 'error' }),
    });
  })();

  const salvarParcelaEscopada = (scope: 'one' | 'future' | 'all') => handleSubmit((values) => {
    if (!editing?.installment_plan_id || !plano) return;
    if (formCompra) {
      const decisao = edicaoEscopadaDaCompra(formCompra, plano, scope);
      if (decisao.kind === 'no-op') return router.back();
      if (decisao.kind === 'structural-rejection' || decisao.kind === 'protected-rejection') {
        toast({ message: decisao.reason, tone: 'error' });
        return;
      }
      if (decisao.kind === 'contract') return salvarCompraToda();
      salvarParcela.mutate({ id: editing.id, scope, patch: decisao.patch }, {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        onError: (error) => toast({
          message: financeErrorMessage(error, 'Nada foi salvo. Confira as parcelas e tente novamente.'),
          tone: 'error',
        }),
      });
      return;
    }
    const adiado = podeAdiar && values.pending;
    const status = podeAdiar ? (adiado ? 'pending' : 'cleared') : editing.status;
    const dueAt = adiado && values.due_at ? brToISO(values.due_at) : editing.due_at;
    const patch: Parameters<typeof salvarParcela.mutate>[0]['patch'] = {};
    if (values.amount_cents !== editing.amount_cents) patch.amount_cents = values.amount_cents;
    if (values.category !== editing.category) patch.category = values.category;
    if (values.description.trim() !== (editing.description ?? '')) patch.description = values.description.trim();
    const merchant = values.merchant?.trim() || null;
    if (merchant !== editing.merchant) patch.merchant = merchant;
    const date = brToISO(values.occurred_at);
    if (date !== editing.occurred_at) patch.occurred_at = date;
    if (status !== editing.status) patch.status = status;
    if (dueAt !== editing.due_at) patch.due_at = dueAt;
    if (values.auto_confirm !== editing.auto_confirm) patch.auto_confirm = values.auto_confirm;
    if (!Object.keys(patch).length) return router.back();
    salvarParcela.mutate({ id: editing.id, scope, patch }, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      },
      onError: (error) => toast({
        message: financeErrorMessage(error, 'Nada foi salvo. Confira as parcelas e tente novamente.'),
        tone: 'error',
      }),
    });
  })();

  const salvarComAlcance = () => {
    if (editing?.recurring_id && serie) {
      askEditScope('occurrence', (scope) => {
        if (scope === 'all') return salvarTodaSerie();
        if (scope === 'future') return salvarAsProximas(formSerie ?? rascunhoDaSerie());
        handleSubmit((values) => {
          if (!editing) return;
          if (formSerie && (formSerie.fim ? brToISO(formSerie.fim) : null) !== serie.end_date) {
            toast({ message: 'O término pertence à série. Escolha o alcance para próximas ocorrências ou para todas.', tone: 'error' });
            return;
          }
          const patch: Record<string, string | number | boolean | null> = {};
          const amount = formSerie?.amountCents ?? values.amount_cents;
          const category = formSerie ? formSerie.category : values.category;
          const description = (formSerie?.description ?? values.description).trim();
          const merchant = (formSerie?.merchant ?? values.merchant ?? '').trim() || null;
          const accountId = formSerie ? formSerie.accountId : values.account_id;
          const kind = formSerie?.kind ?? values.kind;
          const autoConfirm = formSerie?.autoConfirm ?? values.auto_confirm;
          const date = formSerie?.agendaMudou ? brToISO(formSerie.inicio) : brToISO(values.occurred_at);
          if (amount !== editing.amount_cents) patch.amount_cents = amount;
          if (category !== editing.category) patch.category = category;
          if (description !== (editing.description ?? '')) patch.description = description;
          if (merchant !== editing.merchant) patch.merchant = merchant;
          if (accountId !== editing.account_id) patch.account_id = accountId;
          if (kind !== editing.kind) patch.kind = kind;
          if (autoConfirm !== editing.auto_confirm) patch.auto_confirm = autoConfirm;
          if (date !== editing.occurred_at) patch.occurred_at = date;
          if (!formSerie && podeAdiar) {
            const status = values.pending ? 'pending' : 'cleared';
            if (status !== editing.status) patch.status = status;
            const dueAt = values.pending && values.due_at ? brToISO(values.due_at) : editing.due_at;
            if (dueAt !== editing.due_at) patch.due_at = dueAt;
          }
          if (!Object.keys(patch).length) return router.back();
          const key = JSON.stringify([editing.id, patch, editing.edit_revision]);
          if (tentativaUmaRecorrencia.current?.key !== key) {
            tentativaUmaRecorrencia.current = { key, id: newClientMessageId() };
          }
          editarUmaRecorrencia.mutate({
            id: editing.id,
            patch,
            expectedRevision: editing.edit_revision,
            requestId: tentativaUmaRecorrencia.current.id,
          }, {
            onSuccess: () => {
              tentativaUmaRecorrencia.current = null;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
            },
            onError: (error) => toast({ message: financeErrorMessage(error, 'Nada foi salvo. Confira a ocorrência e tente novamente.'), tone: 'error' }),
          });
        })();
      }, 'Todos corrige também as ocorrências passadas. Uma fatura paga protege valor, conta e data.');
      return;
    }
    if (editing?.recurring_id && !serie) {
      toast({ message: 'A série ainda está carregando. Tente salvar novamente.', tone: 'error' });
      return;
    }
    if (editing?.installment_plan_id && plano) {
      askEditScope('installment', salvarParcelaEscopada,
        `A parcela de referência é a ${editing.installment_no}/${plano.installments}. Uma fatura paga protege valor e data.`);
      return;
    }
    if (editing?.installment_plan_id && !plano) {
      toast({ message: 'A compra ainda está carregando. Tente salvar novamente.', tone: 'error' });
      return;
    }
    if (editing?.debt_id && divida?.installments) {
      askEditScope('payment', (scope) => salvarPagamento(scope === 'future' ? 'from_here' : scope),
        'Todos também corrige pagamentos já registrados e recalcula estimativas antigas sem lançamento.');
      return;
    }
    if (editing?.debt_id) {
      toast({ message: 'A dívida ainda está carregando. Tente salvar novamente.', tone: 'error' });
      return;
    }
    onSubmit();
  };

  const onDelete = () => {
    if (!editing) return;
    const what = `${formatBRL(editing.amount_cents)}${editing.category ? ` em ${editing.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(editing.id, {
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei ${what}.`, tone: 'success' });
          },
          onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para apagar. Tenta de novo.'), tone: 'error' }),
        }),
      `${what}. Isso não volta.`,
    );
  };

  return (
    <Screen scroll={false} wide={tablet}>
      <TaskHeader
        title={editing ? 'Editar lançamento' : 'Novo lançamento'}
        onClose={() => router.back()}
        action={
          <Button
            label={saving ? 'Salvando…' : 'Salvar'}
            size="sm"
            disabled={saving || !!correcaoDaDivida.erro || (formSerie !== null && !serieOk) || (formCompra !== null && !compraOk)}
            loading={saving}
            onPress={editing?.recurring_id || editing?.installment_plan_id || editing?.debt_id ? salvarComAlcance : onSubmit}
          />
        }
      />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Space.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {/*
          Uma linha só, e ela É o caminho: abre a dívida DESTE pagamento, não a lista. Era um texto
          solto com um botão colado embaixo (24/09/2026).
        */}
        {editing?.debt_id ? (
          <Section>
            <Row
              icon="doc.text"
              title="Pagamento de uma dívida"
              onPress={() => router.push({ pathname: '/finance/debts', params: { id: editing.debt_id! } })}
            />
          </Section>
        ) : null}
        {/*
          ⚠️ **Um lançamento que JÁ é de uma série precisa dizer isso na tela** — a queixa foi
          literal (13/09/2026), *"ele não mostra como recorrente para eu colocar aqui"*. Na
          ocorrência recorrente e na parcela, a pergunta de escopo aparece ao Salvar.
        */}
        {editing?.recurring_id && serie ? (
          <Section>
            <Row
              icon="arrow.triangle.branch"
              title={formSerie ? 'Voltar ao lançamento' : 'Configurar a repetição'}
              subtitle={formSerie ? 'Revise esta ocorrência separadamente' : 'Frequência, término e demais detalhes'}
              onPress={() => setFormSerie(formSerie ? null : serieDaOcorrencia(serie, editing))}
            />
          </Section>
        ) : editing?.installment_plan_id && plano ? (
          <Section>
            <Row
              icon="arrow.triangle.branch"
              title={formCompra ? 'Voltar à parcela' : 'Configurar a compra parcelada'}
              subtitle={formCompra ? 'Revise esta parcela separadamente' : 'Total, parcelas pagas e demais detalhes'}
              onPress={() => setFormCompra(formCompra ? null : compraDoRegistro(plano))}
            />
          </Section>
        ) : editing && (editing.recurring_id || editing.installment_plan_id) ? (
          // Sem a série (ou a compra) carregada, a nota diz o que é.
          <Note icon="arrow.triangle.branch">
            {editing.recurring_id
              ? 'Faz parte de uma série.'
              : 'É parcela de uma compra.'}
          </Note>
        ) : null}

        {formSerie ? (
          <CamposDaSerie form={formSerie} onChange={setFormSerie} contas={accounts ?? []} rotuloDaData="Vence em" />
        ) : formCompra ? (
          <CamposDaCompra form={formCompra} onChange={setFormCompra} contas={accounts ?? []} />
        ) : (
        <>

        {/*
          Tipo primeiro porque ele decide QUAIS campos existem: transferência troca
          "Categoria" por "Para a conta". Controle que remonta o formulário não pode vir
          depois do que ele remonta.

          ⚠️ **Linha de série ou parcela não troca de tipo.** Com o Segmented na tela, dava
          para virar uma parcela de cartão em receita, e a fatura ficava com uma linha que
          soma para o outro lado. O tipo gravado continua sendo `editing.kind`, que é o que
          o `defaultValues` já traz.
        */}
        {!tipoTravado && (
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Segmented
                options={KINDS}
                value={field.value}
                onChange={(next) => {
                  field.onChange(next);
                  // A fileira de parcelas só existe em gasto (`podeParcelarAqui`).
                  if (next !== 'expense') resetParcelasSeEscondeu();
                  // Transferência não tem "vou pagar depois" (`podeAdiar`): mesma reação da troca
                  // para cartão. Sem ela o zod seguia exigindo o vencimento de um campo que sumiu,
                  // e o "Salvar" não fazia nada, com o erro escondido (22/09/2026).
                  if (next === 'transfer') {
                    setValue('pending', false);
                    setValue('due_at', null);
                  }
                }}
              />
            )}
          />
        )}

        {/*
          ⚠️ O NOME vem antes do VALOR, e isso é a régua de ENTIDADE generalizada (15/09/2026).
          Conta, meta, bem e dívida já abriam pelo "Nome", com o foco nele; só os dois
          formulários de EVENTO abriam pelo valor — duas decisões do mesmo repo se
          contradizendo. Hoje é uma só: **o campo que nomeia o registro vem primeiro e leva o
          `autoFocus`.** O que muda QUAIS campos existem (o tipo) continua antes de tudo.
        */}
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <Field label="Título" error={errors.description?.message}>
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                placeholder="Ex.: Fone de ouvido"
                accessibilityLabel="Título"
                autoFocus={!editing}
                invalid={!!errors.description}
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="merchant"
          render={({ field }) => (
            <Field label="Estabelecimento">
              <TextField
                value={field.value ?? ''}
                onChangeText={(text) => field.onChange(text || null)}
                placeholder="Ex.: Padaria do Zé"
                accessibilityLabel="Estabelecimento"
              />
            </Field>
          )}
        />

          <Controller
            control={control}
            name="amount_cents"
            render={({ field }) => (
              <Field
                label="Valor"
                error={errors.amount_cents?.message ?? correcaoDaDivida.erro ?? undefined}
                hint={parcelaNaFatura ? 'Paga na fatura do cartão: o valor desta parcela não muda' : undefined}>
                <MoneyField
                  valueCents={field.value}
                  onChangeCents={field.onChange}
                  readOnly={parcelaNaFatura}
                  invalid={!!errors.amount_cents || !!correcaoDaDivida.erro}
                />
              </Field>
            )}
          />


        {kind !== 'transfer' && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Field label="Categoria">
                  <CategoryPicker value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
          </Animated.View>
        )}

        {/* Numa parcela a conta é da COMPRA: muda em "A compra toda" (uma parcela sozinha noutro
            cartão não existe). */}
        {naCompra ? null : (
        <Controller
          control={control}
          name="account_id"
          render={({ field }) => (
            <Field
              label={kind === 'transfer' ? 'Da conta' : 'Conta'}
              error={contas.isError ? 'Não deu para carregar as contas.' : undefined}>
              {/* Afirmar "não tem conta" exige a consulta respondida: carregando, era o
                  "Cadastrar uma conta" que aparecia para quem tem contas. */}
              {contas.isPending ? (
                <Skeleton height={56} />
              ) : contas.isError ? (
                <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => contas.refetch()} />
              ) : (accounts ?? []).length === 0 ? (
                <Button
                  label="Cadastrar uma conta"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push('/finance/accounts?create=1')}
                />
              ) : (
                <AccountPicker
                  // Pagamento de dívida sai de conta, nunca de cartão: o trigger da dívida recusa.
                  accounts={(accounts ?? []).filter((a) => !editing?.debt_id || a.type !== 'credit_card')}
                  value={field.value ?? null}
                  onChange={(next: string | null) => {
                    field.onChange(next);
                    // Trocar para cartão desliga "vou pagar depois" em vez de só escondê-lo.
                    const escolhida = (accounts ?? []).find((a) => a.id === next);
                    if (escolhida?.type === 'credit_card') {
                      setValue('pending', false);
                      setValue('due_at', null);
                    }
                    // Limpar a conta esconde a fileira de parcelas (`podeParcelarAqui`);
                    // escolher OUTRA conta (inclusive cartão) mantém `installments`.
                    if (!next) resetParcelasSeEscondeu();
                  }}
                  emptyLabel="Sem conta"
                />
              )}
            </Field>
          )}
        />
        )}

        {/* Sem conta nenhuma, o "Cadastrar uma conta" de cima responde pelas duas: o destino seria
            uma lista vazia. */}
        {kind === 'transfer' && !(contas.isSuccess && (accounts ?? []).length === 0) && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="counterparty_account_id"
              render={({ field }) => (
                <Field label="Para a conta" error={errors.counterparty_account_id?.message}>
                  <AccountPicker
                    accounts={accounts ?? []}
                    value={field.value ?? null}
                    onChange={field.onChange}
                    placeholder="Escolher a conta de destino"
                  />
                </Field>
              )}
            />
          </Animated.View>
        )}

        {podeParcelarAqui && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="installments"
              render={({ field }) => (
                <Field
                  label="Parcelas"
                  error={errors.installments?.message}>
                  <QuantityField
                    value={field.value}
                    min={faixaDeParcelas(0).min}
                    max={faixaDeParcelas(0).max}
                    accessibilityLabel="Número de parcelas"
                    onChange={(n) => {
                      field.onChange(n);
                      // Mesma reação da troca para cartão no `AccountPicker` acima: "vou
                      // pagar depois" e "parcelar" não convivem (ver `podeAdiar`), senão o
                      // zod continua exigindo `due_at` de um campo que sumiu da tela.
                      if (n > 1) {
                        setValue('pending', false);
                        setValue('due_at', null);
                      }
                    }}
                  />
                </Field>
              )}
            />
          </Animated.View>
        )}

        {/*
          O que o número do Valor É. Mora DEPOIS das parcelas porque só existe com 2× ou mais:
          acima delas, aparecer empurraria o "+" para baixo do dedo no meio do toque.
        */}
        {podeParcelarAqui && installmentCount > 1 && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field
              label="O valor acima é"
              hint={
                amountCents > 0
                  ? unidade === 'parcela'
                    ? `${installmentCount}x de ${formatBRL(amountCents)} · total ${formatBRL(totalDigitado(amountCents, 'parcela', installmentCount))}`
                    : `${installmentCount}x de ${formatBRL(Math.floor(amountCents / installmentCount))}`
                  : undefined
              }>
              <Segmented options={UNIDADES_DO_VALOR} value={unidade} onChange={setUnidade} />
            </Field>
          </Animated.View>
        )}

        {podeInformarHistorico && installmentCount > 1 && (
          <Controller control={control} name="paid_installments" render={({ field }) => (
            <Field label="Parcelas já pagas" error={errors.paid_installments?.message}>
              {/*
                ⚠️ **Sem chip "Nenhuma" ao lado.** O campo nasce em `0`, então o chip só podia
                escrever o valor que já estava na tela — dois controles para o mesmo dado, e o
                chip aparecendo aceso de saída. Default sensato no campo mata a necessidade dele.
              */}
              <TextField value={field.value} onChangeText={field.onChange} keyboardType="number-pad" maxLength={2}
                placeholder="0" accessibilityLabel="Parcelas iniciais já pagas" />
            </Field>
          )} />
        )}

        {/*
          **Pix no crédito** (Nubank e afins): o boleto pede um valor, o cartão cobra outro.
          Na fatura são duas coisas diferentes — a compra e o custo de ter usado o crédito —
          e é assim que ficam aqui: duas linhas, mesma fatura, os juros em `juros`.

          Vazio = compra normal. Não é um modo: é um campo a mais que só aparece onde a
          pergunta faz sentido (gasto em cartão, à vista). Editando, ele abre com o juro que nasceu
          junto (`useJurosDoPix`), e mudar, zerar ou somar depois vale.
        */}
        {mostraJuros && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="fee_cents"
              render={({ field }) => (
                <Field
                  label="Juros do Pix no crédito"
                  hint={
                    field.value > 0
                      ? `Total na fatura: ${formatBRL(amountCents + field.value)}`
                      : 'Só para Pix pago no cartão'
                  }>
                  <MoneyField valueCents={field.value} onChangeCents={field.onChange} />
                </Field>
              )}
            />
          </Animated.View>
        )}


        <Controller
          control={control}
          name="occurred_at"
          render={({ field }) => (
            <Field
              label={
                podeParcelarAqui && installmentCount > 1
                  ? 'Data da primeira parcela'
                  : dataEVencimento
                    ? dueFieldLabel(kind)
                    // Ao lado do "Vence em", "Data" sozinha não dizia de quê (26/09/2026)
                    : podeAdiar && pending && kind === 'expense' ? 'Data da compra' : 'Data'
              }
              hint={parcelaNaFatura ? 'Paga na fatura do cartão: a data desta parcela não muda' : undefined}
              error={errors.occurred_at?.message ?? (umaData ? errors.due_at?.message : undefined)}>
              {/*
                ⚠️ **O campo tem a linha inteira; o atalho fica ACIMA dele.** Espremido na mesma
                fileira, o valor quebrava no meio do ano ("13/09/2 026") — o seletor tem ícone e
                chevron, e não é um `TextField` compacto.

                ⚠️ **E o chip "Hoje" SAIU** (15/09/2026). O campo já nasce em hoje, então ele
                nascia aceso mostrando o mesmo que o campo logo abaixo: dois controles para um
                dado só. "Ontem" fica porque leva a um valor que o campo NÃO tem — é atalho de
                verdade, não eco do estado.
              */}
              <View style={styles.dateBlock}>
                {dataEVencimento || parcelaNaFatura ? null : (
                  <View style={styles.chipRow}>
                    <Chip
                      label="Ontem"
                      selected={occurredAt === yesterday}
                      onPress={() => mudaData(yesterday)}
                    />
                  </View>
                )}
                {parcelaNaFatura ? (
                  <TextField editable={false} value={field.value} accessibilityLabel="Data do lançamento" />
                ) : (
                  <DatePickerField
                    value={field.value}
                    onChange={mudaData}
                    onSelectLastDay={serie?.rrule.includes('FREQ=MONTHLY') ? (br) => mudaData(br, 'ultimo') : undefined}
                    lastDaySelected={Boolean(
                      serie?.rrule.includes('FREQ=MONTHLY') &&
                      (intencaoDoDia === 'ultimo' || (intencaoDoDia === null && /BYMONTHDAY=-1(;|$)/.test(serie.rrule))),
                    )}
                    accessibilityLabel="Data do lançamento"
                    invalid={!!errors.occurred_at}
                  />
                )}
              </View>
            </Field>
          )}
        />

        {/* Conta a pagar: o gasto entra na projeção pelo vencimento, não pela data de hoje. */}
        {podeAdiar && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Card>
              <View style={styles.pendingCard}>
                <Controller
                  control={control}
                  name="pending"
                  render={({ field }) => (
                    <Segmented
                      /*
                        ⚠️ **Fala de CAIXA, não de tempo.** Era "Já aconteceu | Ainda vai
                        acontecer", e o tempo é a coisa errada para descrever esta coluna: a
                        compra de cartão de ontem aconteceu E está `pending`. Quem responde
                        "aconteceu?" agora é a pílula da lista, pela data.
                      */
                      options={[
                        { value: 'no', label: caixaLabels(kind).feito },
                        { value: 'yes', label: caixaLabels(kind).aFazer },
                      ]}
                      value={field.value ? 'yes' : 'no'}
                      onChange={(v) => {
                        field.onChange(v === 'yes');
                        if (umaData && v === 'yes') setValue('due_at', getValues('occurred_at'));
                      }}
                    />
                  )}
                />
                {pending ? (
                  <Animated.View entering={FadeIn.duration(Motion.duration.base)} style={styles.pendingCard}>
                    {umaData ? null : (
                    <Controller
                      control={control}
                      name="due_at"
                      render={({ field }) => (
                        <Field
                          label={dueFieldLabel(kind)}
                          hint={naCompra ? 'Opcional: a data da parcela já está no cronograma.' : undefined}
                          error={errors.due_at?.message}>
                          <DatePickerField
                            value={field.value}
                            onChange={(br) => field.onChange(br)}
                            placeholder="Escolher vencimento"
                            accessibilityLabel="Data de vencimento"
                            invalid={!!errors.due_at}
                          />
                        </Field>
                      )}
                    />
                    )}

                    {/*
                      O interruptor de "entra sozinho na data". Só existe em PREVISTO porque é
                      só ali que ele muda algo — `_promote_due_transactions` só olha `pending`.

                      O padrão inverte entre os dois lados: despesa
                      recorrente é boleto que sai; receita de terceiro é Pix que pode não
                      chegar. Foi o pedido literal do dono do produto em 09/09/2026.
                    */}
                    <Controller
                      control={control}
                      name="auto_confirm"
                      render={({ field }) => (
                        <SwitchRow label={autoConfirmLabel(kind)} value={field.value} onValueChange={field.onChange} />
                      )}
                    />
                  </Animated.View>
                ) : null}
              </View>
            </Card>
          </Animated.View>
        )}



        {/*
          ⚠️ **Estes botões ficam no RODAPÉ, não no topo.** Eles não são campos — são ações
          SOBRE o registro, como "Apagar lançamento" logo abaixo. No topo, o modo edição abria com
          três blocos não-campo antes do primeiro campo, e o formulário começava por uma coisa que
          leva para OUTRA tela. A régua de `frontend.md` é sobre campos; o que ela implica aqui é
          que ação de ciclo de vida mora no fim, junto das outras.

          ⚠️ **"Repetir lançamento" também no MODO EDIÇÃO**, quando o lançamento ainda não é de
          série. Era só na criação, e por isso não havia caminho para transformar um gasto que já
          existe em recorrente — foi a queixa *"queria colocar o Cabelo Marcelao como recorrente
          mas quando vou em editar o lançamento, eu não consigo"*. Quem já tem série não vê o
          botão: ali o caminho é editar a série, não criar uma segunda. Nem o PAGAMENTO DE DÍVIDA:
          a parcela já vem do cronograma da dívida, e uma recorrente ao lado contaria duas vezes.
        */}
        {!editing || !(editing.recurring_id || editing.installment_plan_id || editing.debt_id) ? (
          <View style={styles.errorActions}>
            <Button label="Repetir lançamento" variant="secondary" size="sm" onPress={() => {
              const values = getValues();
              const destino = { pathname: '/finance/recurring' as const, params: {
                create: '1', kind: values.kind === 'income' ? 'income' : 'expense',
                amount: String(values.amount_cents), description: values.description,
                merchant: values.merchant?.trim() ?? '',
                category: values.category ?? '', account: values.account_id ?? '', start: values.occurred_at,
              } };
              // Criando, o formulário é descartável e `replace` evita voltar para um rascunho
              // pela metade. Editando, o lançamento continua existindo — `push` devolve para ele.
              if (editing) router.push(destino);
              else router.replace(destino);
            }} />
            {!editing ? (
              <Button label="Financiamento" variant="secondary" size="sm" onPress={() => router.push({ pathname: '/finance/debts', params: { create: 'financing' } })} />
            ) : null}
          </View>
        ) : null}

        {editing ? (
          <Button
            label="Apagar lançamento"
            variant="secondary"
            tone="danger"
            onPress={onDelete}
            loading={remove.isPending}
            block
          />
        ) : null}
        </>
        )}
      </KeyboardAwareScrollView>
      <ToastDoModal />
    </Screen>
  );
}

const linear = transicaoDeLayout;

const styles = StyleSheet.create({
  // Replica o padding do `Screen`, que está com `scroll={false}` para o teclado ser
  // responsabilidade do `KeyboardAwareScrollView`.
  body: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  dateBlock: { gap: Space.sm },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    alignItems: 'center',
  },
  pendingCard: {
    gap: Space.lg,
  },
  loading: {
    gap: Space.lg,
  },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
});
