import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
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
  useEditarCompraPelaParcela,
  useInstallmentPlan,
  useDebts,
  useDeleteTransaction,
  useSaveDebt,
  useSaveTransaction,
  useRecurringTransactions,
  useSaveRecurringSeries,
  useSaveTransactionScoped,
  useTransaction,
  type InstallmentPlanSummary,
  type Transaction,
  type TransactionKind,
} from '@/hooks/use-finance';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { mudancasDaOcorrencia, serieDaOcorrencia, validaSerie, type SerieForm } from '@/lib/serie';
import {
  destinoDoSalvar,
  digitarValor,
  faixaDeParcelas,
  financeErrorMessage,
  installmentHistory,
  nomeDaCompra,
  parcelasAbertas,
  recusaDoValor,
  podeParcelar,
  simpleDebtValues,
  totalDigitado,
  UNIDADES_DO_VALOR,
  valorExibido,
  type Contrato,
  type UnidadeDoValor,
  type ValorDaCompra,
} from '@/lib/finance-form';
import { QuantityField } from '@/components/ui/quantity-field';
import {
  autoConfirmLabel,
  caixaLabels,
  dueFieldLabel,
} from '@/lib/settle-labels';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { correcaoDoPagamento } from '@/lib/confirmar-baixa';
import { AccountPicker } from '@/components/finance/account-picker';
import { transicaoDeLayout } from '@/components/motion/transicao';

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
  .refine((data) => !data.pending || (!!data.due_at && isValidBRDate(data.due_at)), {
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

  if (params.id && (query.isLoading || esperandoPlano)) {
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
      conta={editing ? undefined : params.conta}
    />
  );
}

function TransactionForm({
  editing,
  plano,
  conta,
}: {
  editing?: Transaction;
  /** A compra desta parcela, quando `editing` é parcela e o plano carregou. */
  plano?: InstallmentPlanSummary;
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
  const salvarSerie = useSaveTransactionScoped();
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
      fee_cents: 0,
      auto_confirm: editing?.auto_confirm ?? false,
      occurred_at: isoToBR(dataDaSerie ?? editing?.occurred_at ?? localISODate()),
      pending: editing?.status === 'pending',
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
  const mudaData = (br: string) => {
    setValue('occurred_at', br, { shouldValidate: true });
    if (umaData) setValue('due_at', br);
  };

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
  const mostraJuros = isCard && kind === 'expense' && !editing && installmentCount === 1;
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
  /*
    ⚠️ **O valor de uma PARCELA edita a COMPRA, com a unidade dita** (23/09/2026).

    Até aqui o campo ficava `readOnly` numa parcela: ele mostrava a PARCELA e a pessoa sabia o
    TOTAL, e 104,99 digitado numa parcela de 52,49 com "esta e as futuras" recalculava a compra
    para R$ 209,98 — uma compra que nunca existiu. A trava protegia disso escondendo o campo, e
    a queixa foi *"eu tento clicar e o campo parece ser desabilitado… tinha que ter a opção de
    colocar o valor de cada parcela"*.

    O defeito era a AMBIGUIDADE, não a edição: agora a pessoa diz o que o número é (**Cada
    parcela | Total da compra**) e o salvar vai para `update_installment_plan` — a mesma RPC do
    agente e de Parceladas, que só redistribui o que está em aberto (parcela paga ou em fatura
    fechada não muda). O total é a verdade (`ValorDaCompra`): trocar a unidade sem digitar não
    muda a compra.
  */
  const naCompra = Boolean(editing?.installment_plan_id);
  const contrato: Contrato | null = plano
    ? { parcelas: plano.installments, travadas: plano.locked, travadoCents: plano.locked_cents }
    : null;
  const abertas = contrato ? parcelasAbertas(contrato) : 0;
  /** Parcela sem o plano carregado, ou com tudo pago: aí o valor não tem o que mudar. */
  const valorTravado = naCompra && (!contrato || abertas === 0);
  /**
   * Criando/convertendo: a unidade REINTERPRETA o número digitado ("250 é cada parcela").
   * Editando uma parcela: ela só muda a RÉGUA do campo — o valor da compra não se mexe.
   */
  const [unidade, setUnidade] = useState<UnidadeDoValor>(naCompra ? 'parcela' : 'total');
  const [compra, setCompra] = useState<ValorDaCompra | null>(() =>
    plano ? { totalCents: plano.total_cents, parcelaCents: null } : null,
  );
  /**
   * O total de quando o formulário abriu. Comparar com o `plano` VIVO faria um refetch (outra
   * tela, o agente) parecer edição desta — e o salvar gravaria o total velho por cima.
   */
  const [totalOriginal] = useState(() => plano?.total_cents ?? 0);
  /** O que "cada parcela" mostra antes de qualquer edição: esta, se ainda muda; senão a próxima. */
  const parcelaAtual =
    plano && editing && !plano.locked_ids.includes(editing.id)
      ? editing.amount_cents
      : (plano?.installment_cents ?? 0);
  const valorDaCompraMudou = Boolean(plano && compra && compra.totalCents !== totalOriginal);
  /** Cada parcela em aberto precisa de pelo menos um centavo — a mesma recusa da RPC, antes dela. */
  const erroDoValorDaCompra =
    compra && contrato && abertas > 0 && compra.totalCents - contrato.travadoCents < abertas
      ? recusaDoValor(contrato.travadas)
      : undefined;
  const dicaDoValorDaCompra = ((): string | undefined => {
    if (!naCompra) return undefined;
    if (!plano || !contrato || !compra) return 'Não deu para carregar a compra desta parcela.';
    if (abertas === 0) return 'Tudo pago: valor travado';
    if (!valorDaCompraMudou) {
      return unidade === 'parcela'
        ? `Parcela ${editing?.installment_no ?? '?'} de ${plano.installments} · compra de ${formatBRL(totalOriginal)}`
        : `Compra em ${plano.installments}x · parcela de ${formatBRL(parcelaAtual)}`;
    }
    const cada = valorExibido(compra, 'parcela', contrato, parcelaAtual, totalOriginal);
    return abertas === plano.installments
      ? `${plano.installments}x de ${formatBRL(cada)} · total ${formatBRL(compra.totalCents)}`
      : `As ${abertas} em aberto ficam com ${formatBRL(cada)} · total ${formatBRL(compra.totalCents)}`;
  })();

  /**
   * ⚠️ **Parcelar também vale EDITANDO.** A régua mora em `finance-form.ts`, com teste — aqui
   * era `kind === 'expense' && !!accountId && !editing`, e o `!editing` é o que fez a mesma
   * compra aparecer duas vezes na fatura (19/09/2026).
   */
  const podeParcelarAqui = podeParcelar(kind, accountId, editing);
  /** Histórico ("3 das 12 já foram pagas") é da CRIAÇÃO. Ver o ⚠️ da migration. */
  const podeInformarHistorico = podeParcelarAqui && !editing;
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

  /*
    ⚠️ **Numa ocorrência de série, "Só esta | Esta e as próximas" é escolhido no TOPO** (26/09/2026,
    *"uma tela só de editar componentizada, tendo a possibilidade nessa tela de alterar uma ou
    todas e ter todos os campos de quando eu crio"*). Era uma pergunta no Salvar, sobre os campos
    da linha só — sem repetição, sem vencimento da série, sem tipo —, e a série se editava em outra
    tela. "Esta e as próximas" troca o corpo pelos MESMOS campos da folha de Recorrentes.
    `formSerie` nulo é "Só esta".
  */
  const series = useRecurringTransactions();
  const serie = editing?.recurring_id ? series.data?.find((r) => r.id === editing.recurring_id) : undefined;
  const [formSerie, setFormSerie] = useState<SerieForm | null>(null);
  const editarSerie = useSaveRecurringSeries();
  const serieOk = validaSerie(formSerie).podeSalvar;

  /**
   * Duas escritas, nesta ordem (`mudancasDaOcorrencia`, com teste): as LINHAS desta em diante
   * (a mesma RPC do escopo "future", ancorada nesta ocorrência, que também atualiza a regra) e só
   * depois a REGRA — o calendário novo muda esta linha de data, com o mesmo id.
   */
  const salvarAsProximas = () => {
    if (!formSerie || !editing || !serie || !serieOk) return;
    const { linhas, regra } = mudancasDaOcorrencia(formSerie, editing, serie);
    const feito = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      toast({ message: 'Alterei esta e as próximas.', tone: 'success' });
    };
    const gravarRegra = (linhasJaGravadas: boolean) => {
      if (Object.keys(regra).length === 0) return feito();
      editarSerie.mutate(
        { id: serie.id, patch: regra },
        {
          onSuccess: feito,
          // As linhas JÁ mudaram: a frase diz as duas coisas, com o motivo do banco (a de setembro
          // já paga, a repetição que o app não monta).
          onError: (error) => {
            const motivo = financeErrorMessage(error, 'Não deu para mudar a repetição. Tenta de novo.');
            toast({ message: linhasJaGravadas ? `Salvei os valores, mas não a repetição: ${motivo}` : motivo, tone: 'error' });
          },
        },
      );
    };
    if (Object.keys(linhas).length === 0) return gravarRegra(false);
    salvarSerie.mutate(
      { id: editing.id, scope: 'future', patch: linhas },
      {
        onSuccess: () => gravarRegra(true),
        onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para salvar. Tenta de novo.'), tone: 'error' }),
      },
    );
  };

  const editarCompra = useEditarCompraPelaParcela();
  const salvarDivida = useSaveDebt();
  const saving =
    save.isPending || createPlan.isPending || converter.isPending || editarCompra.isPending || salvarDivida.isPending ||
    salvarSerie.isPending || editarSerie.isPending;

  /**
   * Pagamento de dívida (25/09/2026): o banco decide o que o valor novo pode ser, e a tela diz
   * ANTES do Salvar — o erro chegava depois, atrás do teclado, e parecia que o Salvar não fazia
   * nada. Na parcela fixa o valor novo ainda pergunta se vale para as próximas parcelas.
   */
  const dividas = useDebts();
  const divida = editing?.debt_id ? dividas.data?.find((d) => d.id === editing.debt_id) ?? null : null;
  const correcaoDaDivida =
    divida && editing ? correcaoDoPagamento(divida, editing, amountCents) : { erro: null, perguntaAsProximas: false };

  /**
   * O que mudou E vale para a série inteira. Data fica de fora: ela é de cada
   * ocorrência, e propagar empilharia todas as parcelas no mesmo dia.
   *
   * Chave só entra quando o valor MUDOU — mandar o objeto inteiro faria "corrigi só
   * o nome" reescrever a categoria das 40 parcelas com o que estava no formulário.
   */
  const patchDaSerie = (values: FormValues) => {
    if (!editing) return {};
    const patch: Record<string, unknown> = {};
    if (values.amount_cents !== editing.amount_cents) patch.amount_cents = values.amount_cents;
    if ((values.category ?? null) !== editing.category) patch.category = values.category ?? null;
    const desc = values.description.trim();
    if (desc !== editing.description) patch.description = desc;
    const merc = values.merchant?.trim() || null;
    if (merc !== editing.merchant) patch.merchant = merc;
    if ((values.account_id ?? null) !== editing.account_id) patch.account_id = values.account_id ?? null;
    return patch;
  };

  const onSubmit = handleSubmit((values) => {
    /**
     * UMA escrita, e qual delas é decisão pura (`destinoDoSalvar`, com teste). As três são
     * exclusivas de propósito: duas escritas para uma intenção é a compra duplicada na fatura.
     */
    const destino = destinoDoSalvar(editing, {
      installments: values.installments,
      account_id: values.account_id,
      valorDaCompraMudou,
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

    /**
     * O valor de uma PARCELA mudou: quem grava é a compra. Nome, estabelecimento, categoria e
     * conta vão junto, porque a RPC é um `set` da compra inteira — o que a pessoa não mexeu
     * vai com o valor que a compra já tem, nunca com o da linha (o título da linha tem o
     * "(2/10)", e mandá-lo como nome da compra gravaria "tv (2/10) (2/10)").
     */
    if (destino === 'editarCompra' && editing && plano && compra) {
      if (erroDoValorDaCompra) return;
      const titulo = values.description.trim();
      const merchant = values.merchant?.trim() || null;
      const data = brToISO(values.occurred_at);
      // O que é da LINHA: a data (a RPC refaz o calendário quando nada foi pago) e o caixa.
      const patchParcela: {
        occurred_at?: string;
        status?: Transaction['status'];
        due_at?: string | null;
        auto_confirm?: boolean;
      } = {};
      if (data !== editing.occurred_at || plano.locked === 0) patchParcela.occurred_at = data;
      if (podeAdiar && status !== editing.status) patchParcela.status = status;
      if (podeAdiar && dueAt !== editing.due_at) patchParcela.due_at = dueAt;
      if (podeAdiar && autoConfirm !== editing.auto_confirm) patchParcela.auto_confirm = autoConfirm;
      editarCompra.mutate(
        {
          compra: {
            planId: plano.id,
            totalCents: compra.totalCents,
            installments: plano.installments,
            firstOccurredAt: plano.first_occurred_at,
            description: titulo !== editing.description ? nomeDaCompra(titulo) || plano.description : plano.description,
            merchant: merchant !== editing.merchant ? merchant : plano.merchant,
            category: (values.category ?? null) !== editing.category ? values.category : plano.category,
            accountId: (values.account_id ?? null) !== editing.account_id ? values.account_id : plano.account_id,
          },
          parcela: { id: editing.id, patch: patchParcela },
        },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
            toast({
              message: `Compra atualizada: total de ${formatBRL(compra.totalCents)}.`,
              tone: 'success',
            });
          },
          onError: (error) =>
            toast({
              message:
                error && typeof error === 'object' && 'compraSalva' in error
                  ? 'Mudei o valor da compra, mas não a data desta parcela. Tenta de novo.'
                  : financeErrorMessage(error, 'Não deu para mudar o valor da compra. Tenta de novo.'),
              tone: 'error',
            }),
        },
      );
      return;
    }

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

    const patch = patchDaSerie(values);
    // A ocorrência de série escolhe no topo ("Só esta | Esta e as próximas"): aqui já é "Só esta".
    const naSerie = Boolean(editing?.installment_plan_id);

    const gravar = (escopo: 'one' | 'future', depois?: () => void, seFalhar?: string) =>
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
        auto_confirm: autoConfirm,
      },
      {
        onSuccess: () => {
          // A âncora já foi gravada com o formulário inteiro (inclusive data, que não
          // se propaga). A RPC leva o resto da série — e reescreve a âncora com os
          // mesmos valores, que é barato e mantém UM caminho para a regra do lote.
          if (depois) {
            depois();
            return;
          }
          if (escopo === 'future' && editing) {
            salvarSerie.mutate(
              { id: editing.id, scope: 'future', patch },
              {
                onSuccess: (quantas) => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  router.back();
                  toast({ message: `Alterei ${quantas} ${quantas === 1 ? 'lançamento' : 'lançamentos'} desta série.`, tone: 'success' });
                },
                // A âncora JÁ mudou aqui: dizer só "não deu para salvar" seria mentira.
                onError: (error) => toast({
                  message: financeErrorMessage(error, 'Salvei este, mas não consegui aplicar nos futuros. Tenta de novo.'),
                  tone: 'error',
                }),
              },
            );
            return;
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        // Erro NUNCA fecha o modal: o que foi digitado continua na tela.
        onError: (error) => toast({ message: financeErrorMessage(error, seFalhar ?? 'Não deu para salvar. Tenta de novo.'), tone: 'error' }),
      },
    );

    if (correcaoDaDivida.erro) return;
    /**
     * Parcela fixa com valor novo: "Só este pagamento" conta uma parcela e a diferença vira
     * encargo/desconto; "Este e as próximas" passa o contrato ao valor novo, pela mesma porta do
     * "Editar dívida" (com a trava de versão), e SÓ ENTÃO grava o pagamento — a ordem da folha de
     * pagar. Com o contrato já no valor novo, o trigger (`20260925140000`) grava o pagamento mais
     * recente como a parcela inteira nele, sem encargo (25/09/2026: o detalhe dizia "Parcela de
     * R$ 105 + R$ 5 de encargo" para quem tinha dito que a parcela passou a R$ 110).
     */
    if (correcaoDaDivida.perguntaAsProximas && divida?.installments) {
      const valor = values.amount_cents;
      const oMaisRecente = editing?.debt_payment_no === divida.installments_paid;
      const contratoEPagamento = () =>
        salvarDivida.mutate(
          {
            id: divida.id,
            name: divida.name,
            kind: divida.kind,
            ...simpleDebtValues(valor, String(divida.installments), divida.installments_paid),
            account_id: divida.account_id,
            due_day: divida.due_day,
            versao: divida.updated_at ?? null,
          },
          {
            onSuccess: () =>
              gravar(
                'one',
                () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  router.back();
                  toast({ message: <>As parcelas de <Forte>{divida.name}</Forte> passam a {formatBRL(valor)}.</>, tone: 'success' });
                },
                // O contrato JÁ mudou: dizer só "não deu para salvar" seria mentira.
                'Mudei as próximas parcelas, mas não consegui salvar este pagamento. Tenta de novo.',
              ),
            onError: () =>
              toast({ message: 'Não consegui mudar as parcelas. Nada foi salvo — tenta de novo.', tone: 'error' }),
          },
        );
      const diferenca = valor > (editing?.debt_principal_cents ?? valor) ? 'encargo' : 'desconto';
      showItemActions(
        'Aplicar em quais?',
        [
          { label: 'Só este pagamento', onPress: () => gravar('one') },
          { label: 'Este e as próximas parcelas', onPress: contratoEPagamento },
        ],
        oMaisRecente
          ? `Só este: a diferença fica como ${diferenca} deste pagamento. Este e as próximas: a parcela passa a ${formatBRL(valor)}.`
          : `Só este: a diferença fica como ${diferenca} deste pagamento. Este e as próximas: ele fica com o ${diferenca}, e as próximas passam a ${formatBRL(valor)}.`,
      );
      return;
    }

    // A pergunta é no SALVAR, não na abertura: só aqui se sabe se mudou algum campo
    // que faz sentido propagar. Sem mudança propagável, não há escolha a fazer.
    if (naSerie && Object.keys(patch).length > 0) {
      showItemActions(
        'Aplicar em quais?',
        [
          { label: 'Só esta', onPress: () => gravar('one') },
          { label: 'Esta e as próximas', onPress: () => gravar('future') },
        ],
        'As anteriores não mudam — só se você editar cada uma.',
      );
      return;
    }
    gravar('one');
  });

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
            disabled={saving || !!correcaoDaDivida.erro || (formSerie !== null && !serieOk)}
            loading={saving}
            onPress={formSerie ? salvarAsProximas : onSubmit}
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
          ocorrência de recorrente é o seletor "Só esta | Esta e as próximas" (26/09/2026); na
          parcela, a nota, e a pergunta de escopo continua no Salvar.
        */}
        {editing?.recurring_id && serie ? (
          <Field label="Editar">
            <Segmented
              options={[
                { value: 'uma', label: 'Só esta' },
                { value: 'serie', label: 'Esta e as próximas' },
              ]}
              value={formSerie ? 'serie' : 'uma'}
              onChange={(v) => setFormSerie(v === 'serie' ? serieDaOcorrencia(serie, editing) : null)}
            />
          </Field>
        ) : editing && (editing.recurring_id || editing.installment_plan_id) ? (
          // Sem a série carregada (ou na parcela), a nota diz o que é; o seletor chega com ela.
          <Note icon="arrow.triangle.branch">
            {editing.recurring_id
              ? 'Faz parte de uma série.'
              : 'É parcela de uma compra.'}
          </Note>
        ) : null}

        {formSerie ? (
          <CamposDaSerie form={formSerie} onChange={setFormSerie} contas={accounts ?? []} rotuloDaData="Vence em" />
        ) : (
        <>

        {/*
          Tipo primeiro porque ele decide QUAIS campos existem: transferência troca
          "Categoria" por "Para a conta". Controle que remonta o formulário não pode vir
          depois do que ele remonta.

          ⚠️ **Linha de série não troca de tipo.** `gravar('one')` vai pelo `.update()` cru, que
          carrega `kind` — justamente a coluna que `update_transaction_scoped` recusa de
          propósito. Com o Segmented na tela, dava para virar uma parcela de cartão em receita, e
          a fatura ficava com uma linha que soma para o outro lado. O valor gravado continua
          sendo `editing.kind`, que é o que o `defaultValues` já traz.
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

        {naCompra ? (
          <Field label="Valor" error={erroDoValorDaCompra} hint={dicaDoValorDaCompra}>
            {valorTravado ? null : (
              <Segmented options={UNIDADES_DO_VALOR} value={unidade} onChange={setUnidade} />
            )}
            <MoneyField
              valueCents={
                compra && contrato
                  ? valorExibido(compra, unidade, contrato, parcelaAtual, totalOriginal)
                  : (editing?.amount_cents ?? 0)
              }
              onChangeCents={(v) => {
                if (contrato) setCompra(digitarValor(v, unidade, contrato));
              }}
              readOnly={valorTravado}
              invalid={!!erroDoValorDaCompra}
              accessibilityLabel={unidade === 'parcela' ? 'Valor de cada parcela' : 'Valor total da compra'}
            />
          </Field>
        ) : (
          <Controller
            control={control}
            name="amount_cents"
            render={({ field }) => (
              <Field
                label="Valor"
                error={errors.amount_cents?.message ?? correcaoDaDivida.erro ?? undefined}>
                <MoneyField
                  valueCents={field.value}
                  onChangeCents={field.onChange}
                  invalid={!!errors.amount_cents || !!correcaoDaDivida.erro}
                />
              </Field>
            )}
          />
        )}


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
          pergunta faz sentido (gasto em cartão, à vista, sendo criado agora).
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
              label={podeParcelarAqui && installmentCount > 1 ? 'Data da primeira parcela' : dataEVencimento ? dueFieldLabel(kind) : 'Data'}
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
                {dataEVencimento ? null : (
                  <View style={styles.chipRow}>
                    <Chip
                      label="Ontem"
                      selected={occurredAt === yesterday}
                      onPress={() => mudaData(yesterday)}
                    />
                  </View>
                )}
                <DatePickerField
                  value={field.value}
                  onChange={mudaData}
                  accessibilityLabel="Data do lançamento"
                  invalid={!!errors.occurred_at}
                />
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

        {/*
          Número de parcelas, data da 1ª e conta são da COMPRA inteira — em Parceladas. Mora no
          rodapé com as outras ações sobre o registro (não é campo). ⚠️ **`replace`, não
          `push`**: voltando para cá, o formulário ainda carregaria o título velho, e um
          "Salvar" desfaria parte do que acabou de ser feito.
        */}
        {editing?.installment_plan_id ? (
          <Button
            label="Editar parcelas e datas da compra"
            variant="secondary"
            size="sm"
            onPress={() =>
              router.replace({
                pathname: '/finance/installments',
                params: { edit: editing.installment_plan_id! },
              })
            }
          />
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
