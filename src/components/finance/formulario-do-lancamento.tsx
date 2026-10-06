import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { CategoryPicker } from '@/components/finance/category-picker';
import { SubcategoryField } from '@/components/finance/subcategory-field';
import { subcategoryAfterParentChange } from '@/lib/subcategories';
import { ErrorCard } from '@/components/error-card';
import { ExpenseClassificationField } from '@/components/finance/expense-classification-field';
import { useExpenseClassificationDraft } from '@/hooks/use-expense-classification';
import { EXPENSE_PATTERNS, EXPENSE_NECESSITIES, CLASSIFICATION_SOURCES, expenseClassificationFromRecord, expenseClassificationPatch } from '@/lib/expense-classification';
import type { CorpoProps } from '@/components/finance/corpo-do-lancar';
import { Chip } from '@/components/finance/chip';
import { Forte } from '@/components/ui/forte';
import { Note } from '@/components/ui/note';
import { useNomeDoFavorito } from '@/components/finance/nome-do-favorito';
import { NOME_REPETIDO, useSalvarFavorito } from '@/hooks/use-favoritos';
import type { Modelo } from '@/lib/favoritos';
import { Row, Section } from '@/components/ui/row';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { CamposDaSerie } from '@/components/finance/serie-form';
import { CamposDaCompra } from '@/components/finance/compra-form';
import { DownPaymentFields } from '@/components/finance/down-payment-fields';
import { downPaymentError } from '@/lib/down-payment';
import { Button } from '@/components/ui/button';
import { ButtonRow } from '@/components/ui/button-row';
import { Card } from '@/components/ui/card';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { molduraEmTela } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { useRascunho } from '@/hooks/use-rascunho';
import { pendenciaDoAplicar } from '@/lib/hipotese';
import { argsDaParcelada, dadosDoLancamento, detalheDaEscrita, mudancaDoDetalhe } from '@/lib/escrita';
import { prepararLancamento, type LancamentoPreparado } from '@/lib/lancamento-write';
import { SwitchRow } from '@/components/ui/switch-row';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { Space, Type } from '@/design/tokens';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import {
  useAccounts,
  useConvertToInstallments,
  useCreateInstallmentPlan,
  useUpdateInstallmentPlan,
  useDebts,
  useDebtPaymentVersions,
  useDeleteTransaction,
  useSaveDebtPaymentScoped,
  useSaveTransaction,
  useSaveInstallmentOccurrence,
  useInstallmentPlan,
  useJurosDoPix,
  useRecurringTransactions,
  useSaveRecurringOccurrenceAndSeries,
  useTransaction,
  useSaveRecurringAll,
  useSaveRecurringOne,
  type InstallmentPlanSummary,
  type Transaction,
} from '@/hooks/use-finance';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { mudaInicioDaSerie, mudancasDaOcorrencia, serieDaOcorrencia, validaSerie, type SerieForm } from '@/lib/serie';
import { compraParaRevisaoDaParcela, edicaoEscopadaDaCompra, payloadDaCompra, validaCompra, type CompraForm } from '@/lib/compra';
import {
  faixaDeParcelas,
  financeErrorMessage,
  installmentHistory,
  podeParcelar,
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
import { OriginAccountPicker } from '@/components/finance/origin-creation-host';
import { FinanceWritePreview } from '@/components/finance/finance-write-preview';
import { escritaDaParcelada, escritaDoLancamento, type FinanceWrite } from '@/lib/finance-write-input';
import { PaymentMethodField } from '@/components/finance/payment-method-field';
import { PAYMENT_METHODS, normalizePaymentMethod, paymentMethodAccounts, paymentMethodError } from '@/lib/payment-method';
import { Presenca } from '@/components/motion/presenca';
import { debtPaymentPatch, selectedDebtPaymentVersions, type DebtPaymentScope } from '@/lib/debt-payment-scope';
import { newClientMessageId } from '@/lib/agent-chat';
import { askEditScope } from '@/lib/edit-scope';

/**
 * O formulário do lançamento como CORPO (spec 2026-09-29, formulário único): estado, campos e
 * salvar, saídos de `transaction-form.tsx` sem mudar a regra. Quem hospeda decide o que fechar quer
 * dizer (`onFechar`) e o que vem depois de criar (`onSalvo`).
 *
 * Editando, `editing` chega RESOLVIDO: quem hospeda espera a linha (e a compra, e o juro do Pix)
 * antes de montar — com cache frio o modal de EDIÇÃO virava modal de CRIAÇÃO em silêncio.
 */

const ABAS_DO_TIPO = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
] as const;

const schema = z
  .object({
    kind: z.enum(['expense', 'income', 'transfer']),
    amount_cents: z.number().int().positive('Informe o valor'),
    category: z.string().nullable(),
    subcategory_id: z.string().uuid().nullable().optional(),
    expenseClassification: z.object({
      expense_pattern: z.enum(EXPENSE_PATTERNS).nullable(),
      expense_pattern_source: z.enum(CLASSIFICATION_SOURCES).nullable(),
      expense_necessity: z.enum(EXPENSE_NECESSITIES).nullable(),
      expense_necessity_source: z.enum(CLASSIFICATION_SOURCES).nullable(),
    }).optional(),
    description: z.string().trim().min(1, 'Escreva um título para este lançamento'),
    merchant: z.string().nullable(),
    account_id: z.string().nullable(),
    payment_method: z.enum(PAYMENT_METHODS).nullable(),
    counterparty_account_id: z.string().nullable(),
    // 1 = à vista; >= 2 vira plano de parcelas (RPC create_installment_plan)
    installments: z.number().int().min(1).max(72),
    // Pix no crédito: o que o cartão cobra a MAIS do que o boleto pediu. 0 = compra normal.
    fee_cents: z.number().int().min(0),
    /** `transactions.auto_confirm` — entra sozinho na data em vez de esperar baixa. */
    auto_confirm: z.boolean(),
    paid_installments: z.string(),
    down_payment_enabled: z.boolean(),
    down_payment_cents: z.number().int().nonnegative(),
    down_payment_date: z.string(),
    down_payment_account: z.string().nullable(),
    down_payment_method: z.enum(PAYMENT_METHODS).nullable(),
    value_unit: z.enum(['total', 'parcela']),
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

type Props = CorpoProps & {
  editing?: Transaction;
  /** A compra desta parcela, quando `editing` é parcela e o plano carregou. */
  plano?: InstallmentPlanSummary;
  /** A linha de juros do Pix que nasceu com esta compra (`useJurosDoPix`). */
  jurosDoPix?: { id: string; amount_cents: number } | null;
  /**
   * Aberto pelo "Aplicar" de uma hipótese do "E se…?" (spec 2026-09-29): as parcelas dela. O tipo,
   * o valor (o total), a data e a conta chegam no `comum`; salvar tira a hipótese do rascunho PELO
   * ID (`deHipotese`) — a lista pode ter mudado com o formulário aberto.
   */
  parcelas?: number;
  /** Cópia/favorito de transferência: a conta de destino que o `comum` não carrega. */
  contraparte?: string | null;
  /** Editando um FAVORITO (F22): os mesmos campos, e salvar atualiza o modelo — nunca um lançamento. */
  favorito?: { id: string };
};

export function FormularioDoLancamento(props: Props) {
  const { comum, parcelas, deHipotese, favorito } = props;
  // The form and its CAS baseline start together. Realtime must not replace the version being edited.
  const [{ editing, plano, jurosDoPix }] = useState(() => ({ editing: props.editing, plano: props.plano, jurosDoPix: props.jurosDoPix }));
  const insets = useSafeAreaInsets();
  const { tirar } = useRascunho();
  /** A tela ainda está aberta? O que é dela (voltar, toast) só roda com ela montada. */
  const [montado] = useState(() => ({ current: true }));
  useEffect(() => () => {
    montado.current = false;
  }, [montado]);
  const tirarRapida = () => {
    if (deHipotese) tirar(deHipotese);
  };
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const salvarBloqueadoAtual = useRef(Boolean(props.salvarBloqueado));
  useLayoutEffect(() => { salvarBloqueadoAtual.current = Boolean(props.salvarBloqueado); }, [props.salvarBloqueado]);
  const contas = useAccounts(editing?.account_id);
  const accounts = contas.data;

  const save = useSaveTransaction();
  const salvarFavorito = useSalvarFavorito();
  const nomeDoFavorito = useNomeDoFavorito();
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

  // Aberto pelo "Aplicar": data futura fora do cartão nasce a pagar, como foi simulada.
  const doAplicar = !editing && deHipotese
    ? pendenciaDoAplicar(comum.dataBR, accounts?.find((a) => a.id === comum.contaId)?.type, localISODate())
    : null;
  const guardado = props.estadoGuardado as FormValues | undefined;
  const { control, handleSubmit, setValue, getValues, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // `editing` já chegou resolvido pelo gate — sem `useEffect`+`reset`, sem corrida. Criando, os
    // campos comuns vêm do `comum` (o tipo anterior do formulário único, ou os parâmetros); o que foi
    // digitado NESTE tipo antes de trocar para outro vence os dois, exceto a classificação:
    // a última intenção viaja entre formatos, inclusive NULL explícito e adotar um padrão.
    defaultValues: guardado ? {
      ...guardado,
      ...(Object.hasOwn(comum, 'subcategory_id') ? { category: comum.categoria, ...detalheDaEscrita(comum) } : {}),
      expenseClassification: comum.expenseClassification ?? guardado.expenseClassification,
    } : {
      kind: editing ? editing.kind : comum.kind,
      amount_cents: editing ? editing.amount_cents : comum.valorCents,
      category: editing ? editing.category : comum.categoria,
      ...(Object.hasOwn(editing ?? comum, 'subcategory_id') ? { subcategory_id: editing ? editing.subcategory_id : comum.subcategory_id } : {}),
      expenseClassification: editing ? expenseClassificationFromRecord(editing) : comum.expenseClassification,
      description: editing ? (editing.description ?? '') : comum.descricao,
      merchant: editing ? (editing.merchant ?? null) : (comum.estabelecimento || null),
      // Preserva a escolha enquanto as contas carregam; só grava depois de conferir a origem.
      account_id: editing
        ? editing.account_id
         : comum.contaId ?? null,
      payment_method: normalizePaymentMethod(editing ? editing.payment_method : comum.paymentMethod),
      counterparty_account_id: editing?.counterparty_account_id ?? props.contraparte ?? (comum.kind === 'transfer' ? comum.contraId ?? null : null),
      // Receita não parcela: a hipótese de entrada abre à vista, com o total.
      installments: (!editing && comum.kind === 'expense' ? parcelas : undefined) ?? 1,
      paid_installments: '0',
      down_payment_enabled: false,
      down_payment_cents: 0,
      down_payment_date: isoToBR(localISODate()),
      down_payment_account: comum.contaId ?? null,
      down_payment_method: null,
      value_unit: 'total',
      fee_cents: jurosDoPix?.amount_cents ?? 0,
      auto_confirm: editing?.auto_confirm ?? false,
      occurred_at: editing ? isoToBR(dataDaSerie ?? editing.occurred_at) : comum.dataBR,
      pending: editing ? editing.status === 'pending' : (doAplicar?.pending ?? false),
      installment_occurrence: Boolean(editing?.installment_plan_id),
      due_at: dataDaSerie ? isoToBR(dataDaSerie) : editing?.due_at ? isoToBR(editing.due_at) : (doAplicar?.due_at ?? null),
    },
  });

  // useWatch (e não watch()): watch() não é memoizável e o React Compiler pula a tela inteira
  const kind = useWatch({ control, name: 'kind' });
  const occurredAt = useWatch({ control, name: 'occurred_at' });
  const accountId = useWatch({ control, name: 'account_id' });
  const paymentMethod = useWatch({ control, name: 'payment_method' });
  const category = useWatch({ control, name: 'category' });
  const subcategoryId = useWatch({ control, name: 'subcategory_id' });
  const classificationDraft = useWatch({ control, name: 'expenseClassification' });
  const classification = useExpenseClassificationDraft(classificationDraft, category, kind, Boolean(editing), editing?.workspace_id);
  /** Os campos do formulário que um favorito guarda (só dados da pessoa, nunca data nem vínculo). */
  const modeloAtual = (): Modelo => {
    const v = getValues();
    return { kind: v.kind, description: v.description, merchant: v.merchant, amount_cents: v.amount_cents,
      category: v.category, subcategory_id: v.subcategory_id ?? null, account_id: v.account_id,
      counterparty_account_id: v.counterparty_account_id, payment_method: v.payment_method, ...classification.classification };
  };
  const erroDoFavorito = (e: any) => toast({ message: e?.code === NOME_REPETIDO ? 'Já existe um favorito com esse nome.' : 'Não deu para salvar o favorito. Tenta de novo.', tone: 'error' });
  const feeCents = useWatch({ control, name: 'fee_cents' });
  const amountCents = useWatch({ control, name: 'amount_cents' });
  const installmentCount = useWatch({ control, name: 'installments' });
  const pending = useWatch({ control, name: 'pending' });
  const errors = formState.errors;

  // O hospedeiro lê o que está no formulário na hora de trocar de tipo: os campos comuns (que o
  // outro tipo aproveita) e o estado inteiro (para voltar a este tipo sem perder nada).
  useEffect(() => {
    props.registrarComum(() => {
      const v = getValues();
      return { kind: v.kind, descricao: v.description, valorCents: v.amount_cents, contaId: v.account_id, contraId: v.counterparty_account_id, dataBR: v.occurred_at, categoria: v.category, ...detalheDaEscrita(v, v.kind), estabelecimento: v.merchant ?? undefined, paymentMethod: v.payment_method, expenseClassification: classification.classification };
    });
    props.registrarEstado(() => getValues());
  });

  // "ontem" congelado na abertura do modal: ler o relógio durante o render é impuro
  // (React Compiler) e o modal é efêmero. "hoje" saiu junto com o chip dele — quem põe a data de
  // hoje no campo é o `defaultValues`, uma vez só.
  const [{ yesterday }] = useState(() => ({
    yesterday: isoToBR(localISODate(new Date(Date.now() - 86_400_000))),
  }));

  /*
    Cópia, favorito ou rascunho que traz uma conta que deixou de existir ou foi arquivada: o campo
    fica VAZIO com o aviso (contrato do F22), em vez de guardar o id escondido — o seletor mostrava
    "Sem conta" e o Salvar seguia travado por uma conta que a pessoa nem via (05/10/2026). Editando
    um lançamento, a conta arquivada dele vem na lista e nada muda.
  */
  const [contaTrazida] = useState(() => getValues('account_id'));
  const contaSaiu = !editing && Boolean(contaTrazida) && !contas.isPending && !contas.isError
    && !(accounts ?? []).some((a) => a.id === contaTrazida);
  useEffect(() => {
    if (contaSaiu && getValues('account_id') === contaTrazida) setValue('account_id', null);
  }, [contaSaiu, contaTrazida, getValues, setValue]);
  const account = (accounts ?? []).find((a) => a.id === accountId);
  const isCard = account?.type === 'credit_card';
  const erroPagamento = paymentMethodError(paymentMethod, account ?? null)
    ?? (accountId && !contas.isPending && !contas.isError && !account ? 'Esta conta não está disponível. Escolha outra conta.' : null)
    ?? (jurosDoPix && feeCents > 0 && ((paymentMethod !== null && paymentMethod !== 'pix') || !isCard || kind === 'income')
      ? 'Zere os juros do Pix antes de mudar a forma de pagamento, a conta ou o tipo.' : null);
  /**
   * Onde o campo "Juros do Pix no crédito" EXISTE. É a mesma condição no campo e no payload: o
   * valor ficava no formulário quando o campo sumia (trocar a conta para a corrente, o tipo para
   * receita, ou parcelar), e o salvar gravava uma segunda linha de juros que a tela não mostrava
   * mais — virando receita de juros, ou transferência (22/09/2026).
   */
  // Editando também (26/09/2026): o juro esquecido se soma depois, e o que existe se corrige. Não
  // em parcela, série ou pagamento de dívida — esses têm o próprio contrato.
  // Transferência saindo do cartão é o Pix no crédito para conta PRÓPRIA (28/09/2026): o cartão
  // cobra o juro do mesmo jeito.
  const mostraJuros =
    Boolean(jurosDoPix) || isCard && paymentMethod === 'pix' && (kind === 'expense' || kind === 'transfer') && installmentCount === 1 &&
    !(editing?.installment_plan_id || editing?.recurring_id || editing?.debt_id) &&
    !editing?.pix_fee_for_transaction_id;
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
  const podeAdiar = kind !== 'transfer' && !isCard && installmentCount <= 1 &&
    !editing?.debt_id && !editing?.down_payment_debt_id && !editing?.down_payment_plan_id;
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
  const unidade = useWatch({ control, name: 'value_unit' });
  const setUnidade = (value: UnidadeDoValor) => setValue('value_unit', value);
  const entradaLigada = useWatch({ control, name: 'down_payment_enabled' });
  const entradaCents = useWatch({ control, name: 'down_payment_cents' });
  const entradaData = useWatch({ control, name: 'down_payment_date' });
  const entradaConta = useWatch({ control, name: 'down_payment_account' });
  const entradaMetodo = useWatch({ control, name: 'down_payment_method' });
  const [formCompra, setFormCompra] = useState<CompraForm | null>(null);
  const atualizarCompra = useUpdateInstallmentPlan();
  const compraOk = validaCompra(formCompra).podeSalvar && !paymentMethodError(formCompra?.paymentMethod,
    (accounts ?? []).find((a) => a.id === formCompra?.accountId) ?? null);

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
  const entradaVisivel = podeParcelarAqui && installmentCount > 1;
  const erroEntrada = entradaVisivel && entradaLigada
    ? downPaymentError({ amountCents: entradaCents, dateBR: entradaData, accountId: entradaConta, paymentMethod: entradaMetodo }, localISODate())
      ?? paymentMethodError(entradaMetodo, (accounts ?? []).find((a) => a.id === entradaConta) ?? null)
      ?? (unidade === 'total' && amountCents - entradaCents < installmentCount
        ? 'A entrada precisa ser menor que o total da compra' : undefined)
    : undefined;
  const restanteCents = unidade === 'total' ? amountCents - (entradaVisivel && entradaLigada ? entradaCents : 0) : amountCents * installmentCount;
  /** Achado B: esconde a escolha de tipo numa linha de série — ver o ⚠️ no Controller de `kind`. */
  const naSerieEditada = Boolean(editing?.installment_plan_id || editing?.recurring_id);
  /** Pagamento de dívida também: o trigger da dívida exige despesa PAGA, e recusaria a troca. */
  const tipoTravado = naSerieEditada || Boolean(editing?.debt_id || editing?.down_payment_debt_id || editing?.down_payment_plan_id);

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
  const loadedSeries = editing?.recurring_id ? series.data?.find((r) => r.id === editing.recurring_id) : undefined;
  const [seriesBaseline, setSeriesBaseline] = useState(loadedSeries);
  if (!seriesBaseline && loadedSeries) setSeriesBaseline(loadedSeries);
  // Form values, diff and CAS revision share the same baseline throughout an open editor.
  const serie = seriesBaseline ?? loadedSeries;
  const [formSerie, setFormSerie] = useState<SerieForm | null>(null);
  const seriesClassification = useExpenseClassificationDraft(formSerie?.expenseClassification, formSerie?.category ?? null, formSerie?.kind ?? 'expense', true, editing?.workspace_id);
  const purchaseClassification = useExpenseClassificationDraft(formCompra?.expenseClassification, formCompra?.category ?? null, 'expense', true, editing?.workspace_id);
  const [installmentRevisions] = useState(() => ({ plan: plano?.edit_revision, anchor: editing?.edit_revision }));
  const installmentAttempt = useRef<{ key: string; id: string } | null>(null);
  const installmentIntent = (scope: 'one' | 'future' | 'all', patch: Parameters<typeof salvarParcela.mutate>[0]['patch'], lastDay = false) => {
    const key = JSON.stringify([editing?.id, scope, patch, lastDay, installmentRevisions]);
    if (installmentAttempt.current?.key !== key) installmentAttempt.current = { key, id: newClientMessageId() };
    return { expectedPlanRevision: installmentRevisions.plan ?? Number.NaN,
      expectedAnchorRevision: installmentRevisions.anchor ?? Number.NaN, requestId: installmentAttempt.current.id };
  };
  const [intencaoDoDia, setIntencaoDoDia] = useState<'fixo' | 'ultimo' | null>(null);
  const editarSerie = useSaveRecurringOccurrenceAndSeries();
  const editarTodaSerie = useSaveRecurringAll();
  const editarUmaRecorrencia = useSaveRecurringOne();
  const tentativaTodaSerie = useRef<{ key: string; id: string } | null>(null);
  const tentativaUmaRecorrencia = useRef<{ key: string; id: string } | null>(null);
  const tentativaFuturoSerie = useRef<{ key: string; id: string } | null>(null);
  const serieOk = validaSerie(formSerie).podeSalvar && !paymentMethodError(formSerie?.paymentMethod,
    (accounts ?? []).find((a) => a.id === formSerie?.accountId) ?? null);
  const mudaData = (br: string, intencao: 'fixo' | 'ultimo' = 'fixo') => {
    setValue('occurred_at', br, { shouldValidate: true });
    if (umaData) setValue('due_at', br);
    setIntencaoDoDia(intencao);
  };

  /** Linhas e regra são uma transação no banco: nenhum resultado parcial. */
  const salvarAsProximas = (form = formSerie) => {
    if (salvarBloqueadoAtual.current) return;
    if (!form || !editing || !serie) return;
    if (!validaSerie(form).podeSalvar || paymentMethodError(form.paymentMethod, (accounts ?? []).find((a) => a.id === form.accountId) ?? null)) {
      toast({ message: 'Confira o vencimento e os dados da série antes de salvar.', tone: 'error' });
      return;
    }
    const { linhas, regra } = mudancasDaOcorrencia(form, editing, serie);
    const feito = (aviso?: string | null) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      props.onFechar();
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
      ...detalheDaEscrita(values),
      account_id: values.account_id,
      payment_method: values.payment_method,
      ...classification.classification,
    });
    const alterouData = values.occurred_at !== isoToBR(dataDaSerie ?? editing.occurred_at);
    return alterouData || intencaoDoDia
      ? mudaInicioDaSerie(base, values.occurred_at, intencaoDoDia === 'ultimo')
      : base;
  };

  const salvarTodaSerie = (form = formSerie ?? rascunhoDaSerie()) => {
    if (salvarBloqueadoAtual.current) return;
    if (!form || !editing || !serie) return;
    if (!validaSerie(form).podeSalvar || paymentMethodError(form.paymentMethod, (accounts ?? []).find((a) => a.id === form.accountId) ?? null)) {
      toast({ message: 'Confira o vencimento e os dados da série antes de salvar.', tone: 'error' });
      return;
    }
    const { linhas, regra } = mudancasDaOcorrencia(form, editing, serie);
    if (!Object.keys(linhas).length && !Object.keys(regra).length) {
      props.onFechar();
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
        props.onFechar();
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
    if (salvarBloqueadoAtual.current) return;
    if (!formCompra || !compraOk) return;
    const compra = formCompra;
    const gravarCompra = () => {
      if (salvarBloqueadoAtual.current) return;
      atualizarCompra.mutate(payloadDaCompra(compra, brToISO(compra.inicio)), {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          props.onFechar();
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
    };
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
  const tentativaPagamento = useRef<{ key: string; id: string; debtRevision: number; paymentVersions: Record<string, number> } | null>(null);
  const saving =
    props.salvando || save.isPending || createPlan.isPending || converter.isPending || atualizarCompra.isPending || salvarPagamentoDivida.isPending ||
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

  const draftValues = useWatch({ control });
  const draftParsed = schema.safeParse(draftValues);
  let previewWrite: FinanceWrite | null = null;
  // Scope-sensitive edits and conversions cannot be previewed as if they created a new record.
  if (!props.converter && !favorito && !props.salvarBloqueado && !saving && !erroPagamento && !erroEntrada
    && classification.ready && !contas.isPending && !contas.isError && draftParsed.success
    && !(editing?.installment_plan_id || editing?.recurring_id || editing?.debt_id
      || editing?.down_payment_debt_id || editing?.down_payment_plan_id || editing?.pix_fee_for_transaction_id)) {
    try {
      const draft = prepararLancamento({ ...draftParsed.data, expenseClassification: classification.classification }, {
        editing, podeAdiar, podeParcelarAqui, intencaoDoDia, isCard, mostraJuros, hoje: localISODate(),
      });
      if (draft.destino === 'criarPlano' && draft.entradaParcelada) previewWrite = escritaDaParcelada(draft.entradaParcelada);
      else if (draft.destino === 'salvar') previewWrite = escritaDoLancamento({ ...draft.entradaLancamento,
        ...(editing ? { id: editing.id, expectedRevision: editing.edit_revision } : {}),
      });
    } catch { /* Incomplete draft: validation stays with the existing fields. */ }
  }

  /** `criarOutro`: o "Salvar e criar outro" — o hospedeiro recebe no `onSalvo` e remonta limpo. */
  const onSubmit = (criarOutro = false) => handleSubmit((rawValues) => {
    const values = { ...rawValues, expenseClassification: classification.classification };
    if (salvarBloqueadoAtual.current) return;
    if (!classification.ready || contas.isPending || contas.isError || erroPagamento || erroEntrada) return;
    if (favorito) {
      salvarFavorito.mutate({ id: favorito.id, modelo: modeloAtual() }, {
        onSuccess: () => { toast({ message: 'Favorito atualizado.', tone: 'success' }); props.onSalvo(false); },
        onError: erroDoFavorito,
      });
      return;
    }
    if ((editing?.down_payment_debt_id || editing?.down_payment_plan_id) && brToISO(values.occurred_at) > localISODate()) {
      toast({ message: 'A entrada paga não pode ter data futura', tone: 'error' });
      return;
    }
    // A prévia e o salvar recebem a mesma preparação dos valores do formulário.
    let preparado: LancamentoPreparado;
    try {
      preparado = prepararLancamento(values, {
        editing, podeAdiar, podeParcelarAqui, intencaoDoDia, isCard, mostraJuros, hoje: localISODate(),
      });
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' });
      return;
    }
    const { destino, entradaParcelada, entradaLancamento } = preparado;

    /*
      Convertendo OUTRO registro neste lançamento: nada é gravado aqui. O destino sai pelos MESMOS
      construtores do salvar (e da hipótese, `registroDaHipotese`), e o hospedeiro pergunta o
      alcance e converte.
    */
    if (props.converter && !editing) {
      if (destino === 'criarPlano' && entradaParcelada) {
        const { rpc, args } = argsDaParcelada(entradaParcelada);
        props.converter({ tipo: 'parcelada', dados: { ...args, ultimo_dia: rpc === 'create_installment_plan_last_day',
          ...(entradaParcelada.downPayment ? { down_payment: entradaParcelada.downPayment } : {}) } });
      } else {
        props.converter({ tipo: 'lancamento', dados: dadosDoLancamento(entradaLancamento) });
      }
      return;
    }

    // parcelado NOVO: quem cria as N transações (e resolve a fatura de cada uma) é o banco, não
    // o app — mesma regra usada pelo WhatsApp.
    if (destino === 'criarPlano' && entradaParcelada) {
      // Pela PROMESSA: a rápida salva sai do rascunho mesmo com a tela já fechada; o que é da tela
      // (voltar, toast), só com ela montada — `props.onFechar()` depois de sair tiraria OUTRA tela.
      createPlan.mutateAsync(entradaParcelada).then(
          () => {
            tirarRapida();
            if (!montado.current) return;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            props.onSalvo(criarOutro);
            // O `hint` do campo encurtou para caber no teto de 90 caracteres (design.md §7b), e
            // explicação passou a morar na confirmação da ação. Sem esta linha, quem CRIA uma
            // compra parcelada deixa de saber que as futuras já entram nas próximas faturas —
            // a frase existia antes e sumiria sem substituto.
            toast({
              message: `Parcelei em ${values.installments}x. As futuras já entram nas próximas faturas.`,
              tone: 'success',
            });
          },
          (error) => {
            if (montado.current) toast({ message: financeErrorMessage(error, 'Não deu para parcelar. Tenta de novo.'), tone: 'error' });
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
    if (destino === 'converter' && editing && values.account_id && entradaParcelada) {
      const contaParaConverter = values.account_id;
      const parcelar = () =>
        converter.mutate(
          {
            transactionId: editing.id,
            totalCents: entradaParcelada.totalCents,
            installments: values.installments,
            firstOccurredAt: brToISO(values.occurred_at),
            description: values.description.trim(),
            category: values.category,
            ...detalheDaEscrita(values),
            merchant: values.merchant?.trim() || null,
            accountId: contaParaConverter,
            paymentMethod: values.payment_method,
            ...classification.classification,
            ...(entradaParcelada.downPayment ? { downPayment: entradaParcelada.downPayment } : {}),
            paidInstallments:
              entradaParcelada.paidInstallments || null,
          },
          {
            onSuccess: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              props.onFechar();
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
      props.onFechar();
    };
    if (naCompra && editing) {
      const patch = {
        ...expenseClassificationPatch(expenseClassificationFromRecord(editing), classification.classification),
        amount_cents: values.amount_cents,
        category: values.category,
        ...mudancaDoDetalhe(editing, values, editing.category, values.category),
        description: values.description.trim(),
        merchant: values.merchant?.trim() || null,
        occurred_at: brToISO(values.occurred_at),
        payment_method: values.payment_method,
        status: entradaLancamento.status,
        due_at: entradaLancamento.due_at,
        auto_confirm: entradaLancamento.auto_confirm,
      };
      salvarParcela.mutate({
        id: editing.id,
        ...installmentIntent('one', patch),
        patch,
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
      save.mutateAsync(
      {
        ...entradaLancamento,
        id: editing?.id,
        expectedRevision: editing?.edit_revision,
        juros: editing && (mostraJuros || jurosDoPix) ? { id: jurosDoPix?.id ?? null, cents: mostraJuros ? values.fee_cents : 0 } : undefined,
      }).then(
        () => {
          tirarRapida();
          if (!montado.current) return;
          if (editing) return fechar();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          props.onSalvo(criarOutro);
        },
        // Erro NUNCA fecha o modal: o que foi digitado continua na tela.
        (error) => {
          if (!montado.current) return;
          toast({
            message: financeErrorMessage(error, 'Nada foi salvo. Tenta de novo.'),
            tone: 'error',
          });
        },
      );

    if (correcaoDaDivida.erro) return;
    gravar();
  })();

  const salvarPagamento = (scope: DebtPaymentScope) => handleSubmit((values) => {
    if (salvarBloqueadoAtual.current) return;
    if (erroPagamento || contas.isError || contas.isPending) return;
    if (!editing || !divida || editing.debt_payment_no === null) return;
    if (!versoesPagamentos.data || versoesPagamentos.isError) {
      toast({ message: 'Não consegui carregar os pagamentos desta dívida. Tente novamente.', tone: 'error' });
      return;
    }
    const patch = { ...debtPaymentPatch(editing, {
      amount_cents: values.amount_cents,
      category: values.category,
      ...detalheDaEscrita(values),
      description: values.description.trim(),
      merchant: values.merchant?.trim() || null,
      account_id: values.account_id,
      payment_method: values.payment_method,
      occurred_at: brToISO(values.occurred_at),
    }), ...expenseClassificationPatch(expenseClassificationFromRecord(editing), classification.classification) };
    /*
      Com "Este e os próximos"/"Todos", mexer na data muda o VENCIMENTO do contrato (28/09/2026,
      decisão do dono do produto): o dia escolhido — ou "último dia de todo mês" — vale para as
      próximas parcelas, e a data deste pagamento muda junto. Os outros pagamentos ficam no dia
      em que o dinheiro saiu.
    */
    const novaData = brToISO(values.occurred_at);
    const dueDay = scope !== 'one' && (patch.occurred_at || intencaoDoDia)
      ? (intencaoDoDia === 'ultimo' ? -1 : Number(novaData.slice(8, 10)))
      : undefined;
    if (!Object.keys(patch).length && dueDay === undefined) {
      props.onFechar();
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
    const key = JSON.stringify([editing.id, scope, patch, dueDay, editing.edit_revision]);
    if (tentativaPagamento.current?.key !== key) tentativaPagamento.current = {
      key, id: newClientMessageId(), debtRevision: divida.edit_revision, paymentVersions,
    };
    salvarPagamentoDivida.mutate({
      anchorId: editing.id,
      scope,
      // com o dia do contrato, a data vai sempre (o banco só a grava se mudou)
      patch: dueDay === undefined ? patch : { ...patch, occurred_at: novaData },
      debtRevision: tentativaPagamento.current.debtRevision,
      anchorRevision: editing.edit_revision,
      paymentVersions: tentativaPagamento.current.paymentVersions,
      requestId: tentativaPagamento.current.id,
      dueDay,
    }, {
      onSuccess: () => {
        tentativaPagamento.current = null;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        props.onFechar();
      },
      onError: (error) => toast({ message: financeErrorMessage(error, 'Nada foi salvo. Confira a dívida e tente novamente.'), tone: 'error' }),
    });
  })();

  // Configurar a série/compra troca o formulário visível. O rascunho RHF da ocorrência
  // fica preservado, mas seus campos ocultos não validam nem impedem o contrato visível.
  const submeterFormularioVisivel = (submit: (values: FormValues) => void) => {
    if (salvarBloqueadoAtual.current) return;
    if (contas.isError || contas.isPending) return;
    if (formCompra || formSerie) {
      if (formCompra ? !compraOk : !serieOk) return;
      submit(getValues());
    } else {
      if (erroPagamento || erroEntrada) return;
      handleSubmit(submit)();
    }
  };

  const salvarParcelaEscopada = (scope: 'one' | 'future' | 'all') => submeterFormularioVisivel((values) => {
    if (!editing?.installment_plan_id || !plano) return;
    if (formCompra) {
      const decisao = edicaoEscopadaDaCompra(formCompra, plano, scope, editing.installment_no ?? 1);
      if (decisao.kind === 'no-op') return props.onFechar();
      if (decisao.kind === 'structural-rejection' || decisao.kind === 'protected-rejection') {
        toast({ message: decisao.reason, tone: 'error' });
        return;
      }
      if (decisao.kind === 'contract') return salvarCompraToda();
      salvarParcela.mutate({ id: editing.id, scope, patch: decisao.patch, lastDay: decisao.lastDay,
        ...installmentIntent(scope, decisao.patch, decisao.lastDay) }, {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          props.onFechar();
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
    Object.assign(patch, expenseClassificationPatch(expenseClassificationFromRecord(editing), classification.classification));
    Object.assign(patch, mudancaDoDetalhe(editing, values, editing.category, values.category));
    if (values.amount_cents !== editing.amount_cents) patch.amount_cents = values.amount_cents;
    if (values.category !== editing.category) patch.category = values.category;
    if (values.payment_method !== (editing.payment_method ?? null)) patch.payment_method = values.payment_method;
    if (values.description.trim() !== (editing.description ?? '')) patch.description = values.description.trim();
    const merchant = values.merchant?.trim() || null;
    if (merchant !== editing.merchant) patch.merchant = merchant;
    const date = brToISO(values.occurred_at);
    if (date !== editing.occurred_at) patch.occurred_at = date;
    if (status !== editing.status) patch.status = status;
    if (dueAt !== editing.due_at) patch.due_at = dueAt;
    if (values.auto_confirm !== editing.auto_confirm) patch.auto_confirm = values.auto_confirm;
    const lastDay = intencaoDoDia === 'ultimo' && scope !== 'one';
    if (!Object.keys(patch).length && !lastDay) return props.onFechar();
    salvarParcela.mutate({ id: editing.id, scope, patch, lastDay, ...installmentIntent(scope, patch, lastDay) }, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        props.onFechar();
      },
      onError: (error) => toast({
        message: financeErrorMessage(error, 'Nada foi salvo. Confira as parcelas e tente novamente.'),
        tone: 'error',
      }),
    });
  });

  const salvarComAlcance = () => {
    if (salvarBloqueadoAtual.current) return;
    if (editing?.recurring_id && serie) {
      askEditScope('occurrence', (scope) => {
        if (salvarBloqueadoAtual.current) return;
        if (scope === 'all') return salvarTodaSerie();
        if (scope === 'future') return salvarAsProximas(formSerie ?? rascunhoDaSerie());
        submeterFormularioVisivel((values) => {
          if (!editing) return;
          if (formSerie && (formSerie.fim ? brToISO(formSerie.fim) : null) !== serie.end_date) {
            toast({ message: 'O término pertence à série. Escolha o alcance para próximas ocorrências ou para todas.', tone: 'error' });
            return;
          }
          const patch: Record<string, string | number | boolean | null> = {};
          Object.assign(patch, expenseClassificationPatch(expenseClassificationFromRecord(editing),
            formSerie ? seriesClassification.classification : classification.classification));
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
          const method = formSerie ? formSerie.paymentMethod ?? null : values.payment_method;
          if (method !== (editing.payment_method ?? null)) patch.payment_method = method;
          if (kind !== editing.kind) patch.kind = kind;
          if (autoConfirm !== editing.auto_confirm) patch.auto_confirm = autoConfirm;
          if (date !== editing.occurred_at) patch.occurred_at = date;
          if (!formSerie && podeAdiar) {
            const status = values.pending ? 'pending' : 'cleared';
            if (status !== editing.status) patch.status = status;
            const dueAt = values.pending && values.due_at ? brToISO(values.due_at) : editing.due_at;
            if (dueAt !== editing.due_at) patch.due_at = dueAt;
          }
          if (!Object.keys(patch).length) return props.onFechar();
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
              props.onFechar();
            },
            onError: (error) => toast({ message: financeErrorMessage(error, 'Nada foi salvo. Confira a ocorrência e tente novamente.'), tone: 'error' }),
          });
        });
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
        getValues('occurred_at') !== isoToBR(editing.occurred_at) || intencaoDoDia
          ? 'Com a data nova, os pagamentos e as parcelas do alcance vão para esse dia.'
          : 'Todos também corrige pagamentos já registrados e recalcula estimativas antigas sem lançamento.');
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
            props.onFechar();
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
        title={favorito ? 'Editar favorito' : editing ? 'Editar lançamento' : 'Novo lançamento'}
        onClose={props.onFechar}
        action={
          <Button
            label={saving ? 'Salvando…' : 'Salvar'}
            size="sm"
             disabled={Boolean(props.salvarBloqueado) || saving || !classification.ready || contas.isError || contas.isPending ||
               (formCompra ? !compraOk : formSerie ? !serieOk : Boolean(erroPagamento || erroEntrada || correcaoDaDivida.erro))}
            loading={saving}
            onPress={editing?.recurring_id || editing?.installment_plan_id || editing?.debt_id ? salvarComAlcance : () => onSubmit()}
          />
        }
      />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={[styles.body, molduraEmTela(insets.bottom)]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {props.topo}
        <View style={styles.conteudo}>
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
              onPress={() => setFormSerie(formSerie ? null : rascunhoDaSerie())}
            />
          </Section>
        ) : editing?.installment_plan_id && plano ? (
          <Section>
            <Row
              icon="arrow.triangle.branch"
              title={formCompra ? 'Voltar à parcela' : 'Configurar a compra parcelada'}
              subtitle={formCompra ? 'Revise esta parcela separadamente' : 'Total, parcelas pagas e demais detalhes'}
              onPress={() => {
                if (formCompra) return setFormCompra(null);
                const values = getValues();
                setFormCompra(compraParaRevisaoDaParcela(plano, editing, {
                  occurred_at: brToISO(values.occurred_at), amount_cents: values.amount_cents,
                  description: values.description, merchant: values.merchant, category: values.category,
                  ...detalheDaEscrita(values),
                  payment_method: values.payment_method, expenseClassification: classification.classification,
                }));
              }}
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

        <View style={styles.conteudo}>
        {formSerie ? (
          <>
          {seriesClassification.isError ? <ErrorCard onRetry={() => seriesClassification.refetch()} /> : null}
          <CamposDaSerie form={formSerie} onChange={setFormSerie} contas={accounts ?? []} rotuloDaData="Vence em" workspaceId={editing?.workspace_id}
            classificationDefaults={seriesClassification.defaults}
            onUseCategoryDefaults={() => setFormSerie({ ...formSerie, expenseClassification: seriesClassification.adoptCategoryDefaults() })} />
          </>
        ) : formCompra ? (
          <>
          {purchaseClassification.isError ? <ErrorCard onRetry={() => purchaseClassification.refetch()} /> : null}
          <CamposDaCompra form={formCompra} onChange={setFormCompra} contas={accounts ?? []} workspaceId={editing?.workspace_id}
            classificationDefaults={purchaseClassification.defaults}
            onUseCategoryDefaults={() => setFormCompra({ ...formCompra, expenseClassification: purchaseClassification.adoptCategoryDefaults() })} />
          </>
        ) : (
        <>

        {/*
          Tipo primeiro porque ele decide QUAIS campos existem: transferência troca
          "Categoria" por "Para a conta". Controle que remonta o formulário não pode vir
          depois do que ele remonta.

          ⚠️ **Linha de série ou parcela não troca de tipo.** Com a escolha na tela, dava
          para virar uma parcela de cartão em receita, e a fatura ficava com uma linha que
          soma para o outro lado. O tipo gravado continua sendo `editing.kind`, que é o que
          o `defaultValues` já traz.
        */}
        {!tipoTravado && (
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Field label="Tipo">
                {/* Abas, não lista (06/10/2026): o lado do dinheiro tem que estar À VISTA o tempo
                    todo — numa lista fechada ele passava despercebido. O valor repete o sinal. */}
                <Segmented
                  options={ABAS_DO_TIPO}
                  value={field.value}
                  onChange={(next) => {
                    if (next === field.value) return;
                    if (next !== 'expense' && next !== 'income' && next !== 'transfer') return;
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
              </Field>
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
            <Field label="Título" obrigatorio error={errors.description?.message}>
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                placeholder="Ex.: Fone de ouvido"
                accessibilityLabel="Título"
                autoFocus={!editing && props.focarAoAbrir !== false}
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
                obrigatorio
                error={errors.amount_cents?.message ?? correcaoDaDivida.erro ?? undefined}
                // O valor muda mesmo com a parcela paga na fatura (28/09/2026): o banco mantém a
                // fatura honesta (`valor_corrigido_na_fatura`). Só a data fica presa a ela.
              >
                <MoneyField
                  valueCents={field.value}
                  onChangeCents={field.onChange}
                  invalid={!!errors.amount_cents || !!correcaoDaDivida.erro}
                  sinal={kind === 'income' ? 'entra' : kind === 'expense' ? 'sai' : undefined}
                />
              </Field>
            )}
          />


        <Presenca visivel={kind !== 'transfer'}>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Field label="Categoria">
                  <CategoryPicker value={field.value} onChange={next => {
                    const detail = getValues('subcategory_id');
                    if (detail !== undefined) setValue('subcategory_id', subcategoryAfterParentChange(detail, field.value, next), { shouldDirty: true });
                    field.onChange(next);
                  }} />
                </Field>
              )}
            />
            <SubcategoryField parent={category} value={subcategoryId ?? null} workspaceId={editing?.workspace_id}
              sessionKey={editing?.id ?? 'new'} enabled={kind !== 'transfer' && !editing?.pays_invoice_id}
              onChange={id => setValue('subcategory_id', id, { shouldDirty: true })} />
          </Presenca>

        <Presenca visivel={kind === 'expense' && !editing?.pays_invoice_id} imediata>
          {classification.isError ? <ErrorCard onRetry={() => void classification.refetch()} /> : null}
          <ExpenseClassificationField value={classification.classification}
            onChange={(value) => setValue('expenseClassification', value, { shouldDirty: true })}
            defaults={classification.defaults}
            onUseCategoryDefaults={() => setValue('expenseClassification', classification.adoptCategoryDefaults(), { shouldDirty: true })} />
        </Presenca>

        <Controller control={control} name="payment_method" render={({ field }) => (
          <PaymentMethodField value={field.value} onChange={field.onChange} error={erroPagamento ?? undefined} />
        )} />

        {/* Numa parcela a conta é da COMPRA: muda em "A compra toda" (uma parcela sozinha noutro
            cartão não existe). */}
        {naCompra ? null : (
        <Controller
          control={control}
          name="account_id"
          render={({ field }) => (
            <Field
              label={kind === 'transfer' ? 'Da conta' : 'Conta'}
              obrigatorio={kind === 'transfer' || paymentMethod === 'credit'}
              // Sem a fileira de parcelas (sem conta ou fora de gasto), o erro dela mora aqui:
              // senão o Salvar recusava sem dizer por quê.
              error={contas.isError ? 'Não deu para carregar as contas.' : !podeParcelarAqui ? errors.installments?.message : undefined}
              hint={erroPagamento && account ? `Conta escolhida: ${account.name}. Escolha uma conta compatível ou mude a forma de pagamento.`
                : contaSaiu && !accountId ? 'A conta original não está mais ativa: escolha outra.' : undefined}>
              {/* Afirmar "não tem conta" exige a consulta respondida: carregando, era o
                  "Cadastrar uma conta" que aparecia para quem tem contas. */}
              {contas.isPending ? (
                <Skeleton height={56} />
              ) : contas.isError ? (
                <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => contas.refetch()} />
              ) : (
                <OriginAccountPicker
                  paymentMethod={paymentMethod}
                  excludeCredit={Boolean(editing?.debt_id)}
                  // Pagamento de dívida sai de conta, nunca de cartão: o trigger da dívida recusa.
                  accounts={paymentMethodAccounts(paymentMethod, (accounts ?? []).filter((a) => !editing?.debt_id || a.type !== 'credit_card'))}
                  value={field.value ?? null}
                  selectedAccount={account}
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

        {/* O destino pode ser cadastrado sem abandonar a transferência. */}
        <Presenca visivel={kind === 'transfer'}>
            <Controller
              control={control}
              name="counterparty_account_id"
              render={({ field }) => (
                <Field label="Para a conta" obrigatorio error={errors.counterparty_account_id?.message}>
                  <OriginAccountPicker
                    accounts={accounts ?? []}
                    value={field.value ?? null}
                    onChange={field.onChange}
                    placeholder="Escolher a conta de destino"
                  />
                </Field>
              )}
            />
          </Presenca>

        <Presenca visivel={podeParcelarAqui}>
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
          </Presenca>

        {/*
          O que o número do Valor É. Mora DEPOIS das parcelas porque só existe com 2× ou mais:
          acima delas, aparecer empurraria o "+" para baixo do dedo no meio do toque.
        */}
        <Presenca visivel={podeParcelarAqui && installmentCount > 1}>
            <Field
              label="O valor acima é"
              hint={
                amountCents > 0
                  ? unidade === 'parcela'
                    ? `${installmentCount}x de ${formatBRL(amountCents)} · total ${formatBRL(restanteCents + (entradaLigada ? entradaCents : 0))}`
                    : `${installmentCount}x de ${formatBRL(Math.max(0, Math.floor(restanteCents / installmentCount)))}`
                  : undefined
              }>
              <Segmented options={UNIDADES_DO_VALOR} value={unidade} onChange={setUnidade} />
            </Field>
          </Presenca>

        <Presenca visivel={podeInformarHistorico && installmentCount > 1}>
          <DownPaymentFields enabled={entradaLigada} onEnabled={(value) => setValue('down_payment_enabled', value)}
            value={{ amountCents: entradaCents, dateBR: entradaData, accountId: entradaConta, paymentMethod: entradaMetodo }}
            onChange={(value) => {
              setValue('down_payment_cents', value.amountCents);
              setValue('down_payment_date', value.dateBR);
              setValue('down_payment_account', value.accountId);
              setValue('down_payment_method', value.paymentMethod ?? null);
            }} accounts={accounts ?? []}
            error={entradaLigada && unidade === 'total' && amountCents - entradaCents < installmentCount
              ? 'A entrada precisa ser menor que o total da compra' : undefined} />
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
        </Presenca>

        {/*
          **Pix no crédito** (Nubank e afins): o boleto pede um valor, o cartão cobra outro.
          Na fatura são duas coisas diferentes — a compra e o custo de ter usado o crédito —
          e é assim que ficam aqui: duas linhas, mesma fatura, os juros em `juros`.

          Vazio = compra normal. Não é um modo: é um campo a mais que só aparece onde a
          pergunta faz sentido (gasto em cartão, à vista). Editando, ele abre com o juro que nasceu
          junto (`useJurosDoPix`), e mudar, zerar ou somar depois vale.
        */}
        <Presenca visivel={mostraJuros}>
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
                  <MoneyField valueCents={field.value} onChangeCents={field.onChange} accessibilityLabel="Juros do Pix no crédito em reais" />
                </Field>
              )}
            />
          </Presenca>


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
              error={errors.occurred_at?.message ?? (umaData ? errors.due_at?.message : undefined)
                ?? ((editing?.down_payment_debt_id || editing?.down_payment_plan_id) && isValidBRDate(occurredAt) && brToISO(occurredAt) > localISODate()
                  ? 'A entrada paga não pode ter data futura' : undefined)}>
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
                    max={editing?.down_payment_debt_id || editing?.down_payment_plan_id ? localISODate() : undefined}
                    // Tudo que se repete por mês tem o último dia (28/09/2026): série mensal,
                    // pagamento de dívida e parcela fora do cartão (criando ou editando).
                    onSelectLastDay={serie?.rrule.includes('FREQ=MONTHLY') || divida?.installments ||
                      (!isCard && (editing ? Boolean(editing.installment_plan_id) : podeParcelarAqui && installmentCount > 1))
                      ? (br) => mudaData(br, 'ultimo')
                      : undefined}
                    lastDaySelected={
                      intencaoDoDia === 'ultimo' ||
                      (intencaoDoDia === null && (
                        (Boolean(serie?.rrule.includes('FREQ=MONTHLY')) && /BYMONTHDAY=-1(;|$)/.test(serie?.rrule ?? '')) ||
                        divida?.due_day === -1
                      ))
                    }
                    accessibilityLabel="Data do lançamento"
                    invalid={!!errors.occurred_at}
                  />
                )}
              </View>
            </Field>
          )}
        />

        {/* Conta a pagar: o gasto entra na projeção pelo vencimento, não pela data de hoje. */}
        <Presenca visivel={podeAdiar}>
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
                <Presenca visivel={pending} style={styles.pendingCard}>
                    {umaData ? null : (
                    <Controller
                      control={control}
                      name="due_at"
                      render={({ field }) => (
                        <Field
                          label={dueFieldLabel(kind)}
                          obrigatorio={!naCompra}
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
                  </Presenca>
              </View>
            </Card>
          </Presenca>



        <FinanceWritePreview write={previewWrite} accounts={accounts ?? []} />
        {!editing && !props.converter && !favorito ? (
          <ButtonRow>
          <Button
            variant="secondary"
            block
            label="Salvar como favorito"
            onPress={() => nomeDoFavorito.pedir(getValues('description') || getValues('merchant') || getValues('category') || '', (name) =>
              salvarFavorito.mutate({ name, modelo: modeloAtual() }, {
                onSuccess: () => toast({ message: <><Forte>{name}</Forte> virou favorito.</>, tone: 'success' }),
                onError: erroDoFavorito,
              }))}
          />
          <Button
            variant="secondary"
            block
            label="Salvar e criar outro"
            disabled={Boolean(props.salvarBloqueado) || saving || !classification.ready || contas.isPending || contas.isError || Boolean(erroPagamento) || Boolean(erroEntrada)}
            onPress={() => onSubmit(true)}
          />
          </ButtonRow>
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
        </View>
        </View>
      </KeyboardAwareScrollView>
      {nomeDoFavorito.folha}
      <ToastDoModal />
    </Screen>
  );
}


/**
 * Editando um lançamento: o registro vem de `useTransaction(id)`, nunca do cache da lista — com
 * cache frio o formulário de EDIÇÃO virava de CRIAÇÃO em silêncio e duplicava o lançamento. Por
 * isso "é edição ou criação?" se decide ANTES de montar o corpo (os portões abaixo): enquanto a
 * consulta não responde, não existe formulário para submeter. O corpo monta com o registro
 * carregado (`editing`), não com o id.
 */
export function LancamentoEditando({ editandoId, ...props }: CorpoProps & { editandoId: string }) {
  const query = useTransaction(editandoId);
  // A parcela edita o valor da COMPRA: sem o plano (travadas, total) o campo não sabe o que
  // "cada parcela" alcança. Espera junto com a linha, na mesma tela de esqueleto.
  const planoId = query.data?.installment_plan_id;
  const plano = useInstallmentPlan(planoId);
  const esperandoPlano = Boolean(planoId) && plano.isPending;
  // O juro do Pix desta compra, se houver: o campo abre com ele (26/09/2026, "tudo que se cria se
  // edita"). Mesmo esqueleto — `useForm` só lê os valores na montagem.
  const juros = useJurosDoPix(query.data);
  const esperandoJuros = juros.fetchStatus === 'fetching' && juros.isPending;

  if (query.isLoading || esperandoPlano || esperandoJuros) {
    return (
      <Screen scroll={false}>
        <TaskHeader title="Editar lançamento" onClose={props.onFechar} />
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
  if (query.isError || !query.data || (planoId && plano.isError) || juros.isError) {
    const semLinha = query.isError || !query.data;
    return (
      <Screen scroll={false}>
        <TaskHeader title="Lançamento" onClose={props.onFechar} />
        <View style={styles.body}>
          <Card>
            <View style={styles.errorCard}>
              <Icon name="exclamationmark.triangle" size="xl" color="danger" />
              <ThemedText type="smallBold">
                {semLinha ? 'Não encontrei esse lançamento' : juros.isError ? 'Não deu para conferir os juros deste Pix' : 'Não deu para carregar a compra desta parcela'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                {semLinha ? 'Ele pode ter sido apagado em outro aparelho.' : 'Pode ter sido a conexão.'}
              </ThemedText>
              <View style={styles.errorActions}>
                <Button
                  label="Tentar de novo"
                  variant="secondary"
                  size="sm"
                  onPress={() => (semLinha ? query.refetch() : juros.isError ? juros.refetch() : plano.refetch())}
                />
                <Button label="Voltar" size="sm" onPress={props.onFechar} />
              </View>
            </View>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <FormularioDoLancamento
      {...props}
      editing={query.data}
      plano={plano.data ?? undefined}
      jurosDoPix={juros.data ?? null}
    />
  );
}

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
  conteudo: { gap: Space.xl },
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
