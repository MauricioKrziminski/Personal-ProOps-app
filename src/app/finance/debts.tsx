import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useBRL } from '@/components/ui/conceal';
import { SelectField } from '@/components/ui/select-field';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  DEBT_KINDS,
  useAccounts,
  pagamentosDaDivida,
  useArchiveDebt,
  useArchivedDebts,
  useDebtPayments,
  useDeleteDebt,
  useDebtSchedule,
  useDebts,
  usePayDebtInstallment,
  usePayoffStrategy,
  useSaveDebt,
  useUnarchiveDebt,
  type Debt,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';
import { useVoltarQuandoFechar } from '@/hooks/use-voltar-quando-fechar';
import { brToISO, formatBRL, formatNumberBR, isoToBR } from '@/lib/dates';
import { paidInstallments } from '@/lib/debt-history';
import {
  ancoraDoContrato,
  debtTerm,
  financeErrorMessage,
  parcelaDoTotalDoContrato,
  proximaDoContrato,
  simpleDebtValues,
  type UnidadeDoValor,
} from '@/lib/finance-form';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { AccountPicker } from '@/components/finance/account-picker';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * Dívidas — "quanto disso é juro, e por onde eu começo?".
 *
 * A amortização Price e a ordem de ataque vêm prontas do banco (`debt_schedule`,
 * `payoff_strategy`); o valor da tela está em não errar a entrada e em mostrar a conta na hora de
 * pagar.
 *
 * Dois consertos que motivaram a redesenhada:
 * - **Editar existia no hook e não na tela** (`save.mutate` ia sem `id`): dívida cadastrada com a
 *   taxa errada só podia ser arquivada e recriada.
 * - **`principal_cents` e `remaining_cents` iam sempre iguais**, então a barra de progresso nascia
 *   em 0% mesmo para quem já tinha pago metade. Agora são dois campos.
 */

/** 0.0199 → "1,99% a.m." */
function taxaLabel(fracao: number): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.`;
}

/** "1,99" → 0.0199. Aceita vírgula, que é como o brasileiro digita. */
function parseTaxa(texto: string): number {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n / 100 : 0;
}

interface FormState {
  calculationMode: 'amortized' | 'fixed_installments';
  showDetails: boolean;
  id?: string;
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

const FORM_VAZIO: FormState = {
  calculationMode: 'fixed_installments',
  showDetails: false,
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
function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
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

export default function DebtsScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const params = useLocalSearchParams<{ create?: string; id?: string }>();
  const theme = useTheme();
  const toast = useToast();
  const debts = useDebts();
  const [estrategia, setEstrategia] = useState<'avalanche' | 'snowball'>('avalanche');
  const payoff = usePayoffStrategy(estrategia);
  const accounts = useAccounts();
  const save = useSaveDebt();
  const archive = useArchiveDebt();
  const unarchive = useUnarchiveDebt();
  const excluirDivida = useDeleteDebt();
  const arquivadas = useArchivedDebts();
  const [verArquivadas, setVerArquivadas] = useState(false);
  const pagar = usePayDebtInstallment();

  const [form, setForm] = useState<FormState | null>(() => params.create === 'financing' ? { ...FORM_VAZIO, kind: 'financing' } : null);
  // Quem chegou por `?create=financing` veio do lançamento ou do Financeiro — fechar devolve.
  const volta = useVoltarQuandoFechar(params.create === 'financing');
  /**
   * `?id=<dívida>` já abre o detalhe. O extrato do mês mandava a prestação para a LISTA — o
   * `ref_id` de linha projetada é id de dívida, não de lançamento —, e quem tem cinco
   * financiamentos tinha que caçar qual era.
   */
  const [detalheId, setDetalheId] = useState<string | null>(() => params.id ?? null);
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const detalhe = debts.data?.find((debt) => debt.id === detalheId) ?? null;
  const pagando = debts.data?.find((debt) => debt.id === pagandoId) ?? null;
  const setDetalhe = (debt: Debt | null) => setDetalheId(debt?.id ?? null);
  const setPagando = (debt: Debt | null) => setPagandoId(debt?.id ?? null);
  const [pagoCents, setPagoCents] = useState(0);
  const [contaId, setContaId] = useState<string | null>(null);

  // Lazy: só a dívida aberta (detalhe ou pagamento) puxa a tabela Price.
  // O formulário de edição também lê os dois: o cronograma dá a próxima parcela de quem não tem
  // âncora, e os pagamentos lançados são o piso das "pagas".
  const schedule = useDebtSchedule(detalhe?.id ?? pagando?.id ?? form?.id);
  const payments = useDebtPayments(detalhe?.id ?? pagando?.id ?? form?.id);

  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const lista = debts.isError ? [] : (debts.data ?? []);
  const totalDevido = lista.reduce((s, d) => s + Number(d.remaining_cents), 0);
  const jurosAteQuitar = (payoff.data ?? []).reduce(
    (s, p) => s + Number(p.total_interest_cents),
    0
  );
  const proxima = schedule.data?.[0];
  /**
   * O passado do contrato. `debts` guarda "8 pagas" como CONTAGEM, então abrir um
   * financiamento de 48x mostrava só as 40 que faltam — o histórico não existia e o
   * contrato parecia ter nascido com 40 parcelas. Isto é apresentação derivada da
   * contagem, não lançamento: não entra na projeção nem no saldo.
   */
  const historico = detalhe
    ? paidInstallments({
        installmentsPaid: detalhe.installments_paid,
        installmentCents: Number(detalhe.installment_cents ?? proxima?.payment_cents ?? 0),
        nextDueDate: proxima?.due_date ?? null,
        payments: payments.data ?? [],
      })
    : [];
  const temEstimada = historico.some((p) => !p.registered);
  const pagadoras = (accounts.data ?? []).filter((a) => a.type !== 'credit_card');

  const abrirNova = () => setForm({ ...FORM_VAZIO });
  const abrirEdicao = (d: Debt) =>
    setForm({
      calculationMode: d.calculation_mode,
      // No editar, nome e conta já aparecem: quem abriu o editar veio mudar alguma coisa.
      showDetails: true,
      unidade: 'parcela',
      valorCents: Number(d.installment_cents ?? 0),
      ancora: d.first_due_date ?? null,
      pagasOriginal: d.installments_paid,
      id: d.id,
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
    });

  const abrirPagamento = (d: Debt) => {
    setDetalhe(null);
    setPagoCents(Number((detalhe?.id === d.id ? schedule.data?.[0]?.payment_cents : null) ?? d.installment_cents ?? 0));
    setContaId(d.account_id);
    setPagando(d);
  };

  const fracao = form ? parseTaxa(form.taxa) : 0;
  const totalDeParcelas = form && /^\d+$/.test(form.parcelas) ? Number(form.parcelas) : 0;
  /** A parcela do contrato fixo, venha o valor digitado como parcela ou como total a pagar. */
  const parcelaCents = form
    ? form.unidade === 'total'
      ? parcelaDoTotalDoContrato(form.valorCents, totalDeParcelas)
      : form.valorCents
    : 0;
  let simpleValues: ReturnType<typeof simpleDebtValues> | null = null;
  if (form?.calculationMode === 'fixed_installments') {
    try { simpleValues = simpleDebtValues(parcelaCents, form.parcelas, form.installmentsPaid); } catch { /* Invalid input keeps Save disabled. */ }
  }
  /** Pagamento lançado pelo app é fato: dizer menos pagas do que isso é contradição. */
  const pagamentosLancados = form?.id ? (payments.data ?? []).length : 0;
  /**
   * A âncora que vale: a do formulário, ou — dívida antiga, sem `first_due_date` — a que o
   * cronograma do banco implica (a próxima dele, andando para trás as pagas de ABERTURA). Sem
   * cronograma carregado não se inventa nada: o salvar não mexe na data.
   */
  const ancoraEfetiva =
    form?.ancora ??
    (form?.id && schedule.data?.[0]
      ? ancoraDoContrato(schedule.data[0].due_date, form.pagasOriginal)
      : null);
  const diaDoContrato = form?.diaVencimento ? Number(form.diaVencimento) : null;
  const proximaISO =
    ancoraEfetiva && diaDoContrato && form
      ? proximaDoContrato(ancoraEfetiva, form.installmentsPaid, diaDoContrato)
      : null;
  const rotuloDaData = !form || form.installmentsPaid === 0 ? 'Primeira parcela' : `Próxima parcela (a ${form.installmentsPaid + 1}ª)`;
  const escolherData = (br: string) => {
    if (!form) return;
    const iso = brToISO(br);
    setForm({ ...form, ancora: ancoraDoContrato(iso, form.installmentsPaid), diaVencimento: String(Number(iso.slice(8))) });
  };
  const mudarPagas = (n: number) => {
    if (!form) return;
    // Pagas além do total assentam no total: é o teto que existe.
    const teto = totalDeParcelas > 0 ? totalDeParcelas : Infinity;
    setForm({ ...form, installmentsPaid: Math.max(pagamentosLancados, Math.min(n, teto)), historyConfirmed: true });
  };
  const mudarUnidade = (unidade: UnidadeDoValor) => {
    if (!form || unidade === form.unidade) return;
    // Trocar a unidade sem digitar não move dinheiro: o número muda de régua, o contrato fica.
    const valorCents =
      unidade === 'total' ? form.valorCents * totalDeParcelas : parcelaDoTotalDoContrato(form.valorCents, totalDeParcelas);
    setForm({ ...form, unidade, valorCents: totalDeParcelas > 0 ? valorCents : form.valorCents });
  };
  const nomeOk = (form?.name.trim().length ?? 0) >= 2;
  /**
   * Contrato com parcelas TEM dia de vencimento — sem ele o cronograma ancora numa
   * data arbitrária e a projeção de caixa passa a mentir sobre quando o dinheiro sai.
   * Dívida sem parcelas ("devo 500 pro João") não tem cadência e continua sem exigir.
   */
  const validDueDay = form?.parcelas
    ? Boolean(ancoraEfetiva) || Boolean(form.id && diaDoContrato && diaDoContrato >= 1 && diaDoContrato <= 31)
    : true;
  const advancedValid = form && nomeOk && (!form.parcelas || form.historyConfirmed) &&
    Number.isInteger(form.installmentsPaid) && form.installmentsPaid >= 0 && form.remainingCents > 0 &&
    (!form.parcelas || Number(form.parcelas) > 0) &&
    (form.kind !== 'financing' || (form.taxa.trim() !== '' && !!form.parcelas)) &&
    Number.isFinite(Number(form.taxa.replace(',', '.'))) && Number(form.taxa.replace(',', '.')) >= 0;
  const podeSalvar = Boolean(form && validDueDay && (form.calculationMode === 'fixed_installments' ? simpleValues : advancedValid));


  const salvar = () => {
    if (!form || !podeSalvar) return;
    let defaultName = 'Financiamento';
    for (let suffix = 2; lista.some((d) => d.id !== form.id && d.name.toLowerCase() === defaultName.toLowerCase()); suffix++) defaultName = `Financiamento ${suffix}`;
    save.mutate(
      {
        id: form.id,
        name: form.name.trim() || defaultName,
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
      },
      {
        onSuccess: () => {
          toast({ message: form.id ? 'Dívida atualizada.' : 'Dívida cadastrada.', tone: 'success' });
          volta.aoFechar(() => setForm(null));
        },
        onError: (error) =>
          toast({
            message: financeErrorMessage(error, 'Não deu para salvar. Já existe uma dívida com esse nome?'),
            tone: 'error',
          }),
      }
    );
  };

  const confirmarPagamento = () => {
    if (!pagando || pagoCents <= 0) return;
    pagar.mutate(
      { debtId: pagando.id, amountCents: pagoCents, accountId: contaId },
      {
        onSuccess: () => {
          toast({ message: `Parcela de ${pagando.name} registrada.`, tone: 'success' });
          setPagando(null);
        },
        // o sheet FICA aberto: fechar num erro faz o usuário registrar o pagamento de novo
        onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para registrar o pagamento.'), tone: 'error' }),
      }
    );
  };

  /**
   * Arquivar deixou de pedir confirmação (23/09/2026): agora tem volta — o "Desfazer" do toast e
   * a seção "Arquivadas" no fim da lista. Confirmar o que se desfaz com um toque é atrito sem
   * proteção nenhuma.
   */
  const arquivar = (d: Debt) =>
    archive.mutate(d.id, {
      onSuccess: () =>
        toast({
          message: `${d.name} arquivada.`,
          tone: 'success',
          action: { label: 'Desfazer', onPress: () => unarchive.mutate(d.id) },
        }),
      onError: () => toast({ message: `Não deu para arquivar ${d.name}.`, tone: 'error' }),
    });

  const desarquivar = (d: Debt) =>
    unarchive.mutate(d.id, {
      onSuccess: () => toast({ message: `${d.name} voltou para a lista.`, tone: 'success' }),
      onError: () => toast({ message: `Não deu para desarquivar ${d.name}.`, tone: 'error' }),
    });

  /**
   * "Excluir por completo" (23/09/2026): a dívida, os pagamentos já lançados e as parcelas
   * futuras da projeção. A confirmação diz a consequência CONTADA — quantos pagamentos e quanto
   * volta ao saldo —, porque é isso que muda o passado da pessoa.
   */
  const excluir = async (d: Debt) => {
    let consequencia = 'Apaga o financiamento e as parcelas futuras da projeção. Não dá para desfazer.';
    try {
      const { count, totalCents } = await pagamentosDaDivida(d.id);
      if (count > 0) {
        consequencia = `Apaga o financiamento, ${count === 1 ? 'o pagamento já lançado' : `os ${count} pagamentos já lançados`} (${brl(totalCents)}, que ${count === 1 ? 'volta' : 'voltam'} ao saldo das contas) e as parcelas futuras da projeção. Não dá para desfazer.`;
      }
    } catch {
      /* Sem a contagem, a frase genérica ainda diz o que some. */
    }
    confirmDestructive(
      `Excluir "${d.name}" por completo?`,
      'Excluir',
      () =>
        excluirDivida.mutate(d.id, {
          onSuccess: () => {
            if (detalheId === d.id) setDetalhe(null);
            toast({ message: `${d.name} excluída.`, tone: 'success' });
          },
          onError: (error) =>
            toast({ message: financeErrorMessage(error, `Não deu para excluir ${d.name}.`), tone: 'error' }),
        }),
      consequencia
    );
  };

  /** Uma lista só de ações: o toque longo e o "…" do detalhe leem daqui. */
  const acoesDaDivida = (d: Debt) =>
    showItemActions(d.name, [
      { label: 'Ver as parcelas', onPress: () => setDetalhe(d) },
      {
        label: 'Editar',
        onPress: () => {
          setDetalhe(null);
          abrirEdicao(d);
        },
      },
      { label: 'Arquivar', onPress: () => arquivar(d) },
      { label: 'Excluir por completo', destructive: true, onPress: () => void excluir(d) },
    ]);

  const acoesDaArquivada = (d: Debt) =>
    showItemActions(d.name, [
      { label: 'Desarquivar', onPress: () => desarquivar(d) },
      { label: 'Excluir por completo', destructive: true, onPress: () => void excluir(d) },
    ]);

  const cartaoDivida = (d: Debt, index: number) => {
    const restante = Number(d.remaining_cents);
    const original = Number(d.principal_cents) || restante;
    const pago = Math.max(0, original - restante);
    const tipo = DEBT_KINDS.find((k) => k.value === d.kind)?.label ?? '';
    const juros = d.calculation_mode === 'fixed_installments' ? 'juros incluídos, sem detalhamento' : d.interest_rate_monthly > 0 ? `juros ${taxaLabel(d.interest_rate_monthly)}` : 'sem juros';
    const parcelas = d.installments ? `${d.installments_paid}/${d.installments} pagas` : null;

    return (
      <Animated.View
        key={d.id}
        layout={transicaoDeLayout}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${d.name}, ${tipo}, deve ${formatBRL(restante)}, ${juros}${parcelas ? `, ${parcelas}` : ''}`}
          onPress={() => setDetalhe(d)}
          onLongPress={() => acoesDaDivida(d)}>
          <Card style={styles.divida}>
            <View style={styles.dividaTopo}>
              <ThemedText type="default" style={styles.dividaNome}>
                {d.name}
              </ThemedText>
              <Money cents={restante} variant="ticker" tone="danger" />
            </View>
            <ProgressBar value={pago} max={original} tone="success" />
            <ThemedText type="footnote" themeColor="textSecondary">
              {tipo} · {juros}
              {parcelas ? ` · ${parcelas}` : ''}
            </ThemedText>
          </Card>
        </Pressable>
      </Animated.View>
    );
  };

  const loading = debts.isLoading ? (
    <>
      <Skeleton height={120} radius={Radius.lg} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;

  const debtContext = (
    <View style={styles.paneBody}>
      {debts.isError ? (
        <ErrorBand message="Não deu para carregar suas dívidas." onRetry={debts.refetch} />
      ) : lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Total devido</HeroLabel>
            <Money cents={totalDevido} variant="money" tone="danger" />
            {jurosAteQuitar > 0 ? (
              <View style={styles.valores}>
                <Money cents={jurosAteQuitar} variant="subhead" tone="textSecondary" />
                <ThemedText type="small" themeColor="textSecondary">
                  de juros até quitar tudo
                </ThemedText>
              </View>
            ) : null}
          </Card>
        </Animated.View>
      ) : null}

      {payoff.isError && lista.length > 1 ? (
        <ErrorBand
          message="Não deu para montar a ordem de ataque. Suas dívidas continuam na lista."
          onRetry={payoff.refetch}
        />
      ) : null}

      {lista.length > 1 && !payoff.isError ? (
        <Card style={styles.ordem}>
          <ThemedText type="smallBold">Por onde começar</ThemedText>
          <Segmented
            options={[
              { value: 'avalanche', label: 'Juros mais altos' },
              { value: 'snowball', label: 'Dívida mais curta' },
            ]}
            value={estrategia}
            onChange={setEstrategia}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {estrategia === 'avalanche'
              ? 'Ordenado pelas taxas conhecidas. Parcelas simples ficam ao fim, pois a taxa não foi informada.'
              : 'Atacar a de saldo menor primeiro quita a primeira mais rápido.'}
          </ThemedText>
          {payoff.isLoading ? lista.map((d) => (
            <View key={d.id} style={styles.ordemLinha}>
              <Skeleton width={18} height={18} />
              <View style={styles.ordemTexto}>
                <Skeleton width="70%" height={18} />
                <Skeleton width="50%" height={14} />
              </View>
              <Skeleton width={76} height={22} />
            </View>
          )) : (payoff.data ?? []).map((p, i) => (
            <Animated.View
              key={p.debt_id}
              layout={transicaoDeLayout}
              style={styles.ordemLinha}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={tabular}>
                {i + 1}
              </ThemedText>
              <View style={styles.ordemTexto}>
                <ThemedText type="small">
                  {p.name}
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {lista.find((d) => d.id === p.debt_id)?.calculation_mode === 'fixed_installments' ? 'parcelas fixas' : `juros ${taxaLabel(Number(p.interest_rate_monthly))}`} · {p.months_left} meses
                </ThemedText>
              </View>
              <Money cents={Number(p.remaining_cents)} variant="subhead" tone="danger" />
            </Animated.View>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Cada dívida contada sozinha, sem supor que você joga a parcela quitada na próxima.
          </ThemedText>
        </Card>
      ) : null}
    </View>
  );

  const listaArquivadas = arquivadas.isError ? [] : (arquivadas.data ?? []);
  const secaoArquivadas =
    listaArquivadas.length > 0 ? (
      <Section>
        <Row
          icon="archivebox"
          title={`Arquivadas · ${listaArquivadas.length}`}
          chevron={false}
          trailing={<Icon name={verArquivadas ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
          onPress={() => setVerArquivadas((v) => !v)}
          accessibilityState={{ expanded: verArquivadas }}
        />
        {verArquivadas
          ? listaArquivadas.map((d) => (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}, arquivada. Toque para desarquivar ou excluir.`}
                onPress={() => acoesDaArquivada(d)}
                onLongPress={() => acoesDaArquivada(d)}>
                <View style={[styles.arquivada, { borderTopColor: theme.separator }]}>
                  <ThemedText type="default" themeColor="textSecondary" style={styles.dividaNome}>
                    {d.name}
                  </ThemedText>
                  <Money cents={Number(d.remaining_cents)} variant="subhead" tone="textSecondary" />
                </View>
              </Pressable>
            ))
          : null}
      </Section>
    ) : null;

  const debtListContent = (
    <View style={styles.paneBody}>
      {lista.map(cartaoDivida)}
      {!debts.isLoading && !debts.isError && lista.length === 0 ? (
        <EmptyState
          icon="creditcard.trianglebadge.exclamationmark"
          title="Nenhuma dívida cadastrada"
          hint="Informe o valor da parcela e quantas são. Os outros detalhes são opcionais."
          action={{ label: 'Cadastrar dívida', onPress: abrirNova }}
        />
      ) : null}
      {secaoArquivadas}
    </View>
  );

  const debtList = (
    <View style={styles.paneBody}>
      {loading}
      {debtListContent}
    </View>
  );

  const compactBody = (
    <>
      {loading}
      {debtContext}
      {debtListContent}
    </>
  );

  const tabletBody = (
    <AdaptivePanes
      main={debtList}
      support={debts.isError || lista.length > 0 ? debtContext : undefined}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="debts-tablet-workspace"
    />
  );

  return (
    <Screen
      grouped
      wide={tablet}
      onRefresh={() => Promise.all([debts.refetch(), payoff.refetch(), accounts.refetch(), ...(detalheId || pagandoId ? [schedule.refetch()] : [])])}>
      <Stack.Screen
        options={{
          title: 'Dívidas',
        }}
      />

      <HeaderActions actions={[{ label: 'Nova dívida', icon: 'plus', onPress: abrirNova }]} />

      {tablet ? tabletBody : compactBody}

      {/* Amortização — sheet, não acordeão: um financiamento em 60x tem 60 linhas. */}
      <Sheet visible={detalhe !== null} onClose={() => setDetalhe(null)}>
          <TaskHeader
            title={detalhe?.name ?? 'Dívida'}
            onClose={() => setDetalhe(null)}
          />

          <ScrollView contentContainerStyle={styles.sheetBody}>
            {schedule.isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : null}

            {schedule.isError ? (
              <ErrorBand
                message="Não deu para montar a tabela de amortização."
                onRetry={schedule.refetch}
              />
            ) : null}

            {proxima && detalhe ? (
              <Card style={styles.proxima}>
                <ThemedText type="small" themeColor="textSecondary">
                  Próxima parcela
                </ThemedText>
                <View style={styles.valores}>
                  <Money cents={Number(proxima.payment_cents)} variant="title2" />
                  <ThemedText type="small" themeColor="textSecondary">
                    em {isoToBR(proxima.due_date)}
                  </ThemedText>
                </View>
                {detalhe.calculation_mode !== 'fixed_installments' && <View style={styles.valores}>
                  <Money cents={Number(proxima.interest_cents)} variant="subhead" tone="danger" />
                  <ThemedText type="small" themeColor="danger">
                    disso são juros
                  </ThemedText>
                </View>}
                <Button
                  label="Paguei esta parcela"
                  block
                  onPress={() => abrirPagamento(detalhe)}
                />
              </Card>
            ) : null}

            {!schedule.isLoading && !schedule.isError && !proxima ? (
              <EmptyState
                icon="tablecells"
                title={
                  detalhe && Number(detalhe.remaining_cents) <= 0
                    ? 'Nada em aberto. Dívida quitada.'
                    : 'Sem tabela de amortização'
                }
                hint={
                  detalhe && Number(detalhe.remaining_cents) > 0
                    ? 'Informe quantas parcelas faltam para eu montar a tabela.'
                    : undefined
                }
                action={
                  detalhe && Number(detalhe.remaining_cents) > 0
                    ? {
                        label: 'Editar dívida',
                        onPress: () => {
                          const d = detalhe;
                          setDetalhe(null);
                          abrirEdicao(d);
                        },
                      }
                    : undefined
                }
              />
            ) : null}

            {historico.length > 0 && detalhe ? (
              <View style={styles.tabelaBloco}>
                <SectionHead
                  title={`Já pagas · ${historico.length}${detalhe.installments ? ` de ${detalhe.installments}` : ''}`}
                />
                <Section>
                  {historico.map((p) => (
                    <Row
                      key={p.installment_no}
                      icon="checkmark.circle.fill"
                      chevron={false}
                      title={`Parcela ${p.installment_no}${detalhe.installments ? ` de ${detalhe.installments}` : ''}`}
                      subtitle={
                        p.registered
                          ? `Paga em ${isoToBR(p.due_date)}`
                          : `Vencimento estimado · ${isoToBR(p.due_date)}`
                      }
                      trailing={<Money cents={p.payment_cents} variant="footnote" tone="textSecondary" />}
                    />
                  ))}
                </Section>
                {temEstimada ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    As parcelas sem pagamento registrado vieram da contagem que você informou. O
                    valor é o da parcela e a data segue a cadência mensal do contrato.
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            {(schedule.data ?? []).length > 0 ? (
              <View style={styles.tabelaBloco}>
                <SectionHead title="A pagar" />
                {/* rola dentro do próprio container, nunca empurrando o corpo do sheet */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={styles.tabelaLinha}>
                      {['nº', 'vencimento', 'parcela', 'juros', 'amortiza', 'saldo'].map((h) => (
                        <ThemedText
                          key={h}
                          type="footnote"
                          themeColor="textSecondary"
                          style={[styles.celula, h === 'nº' ? styles.celulaEstreita : null]}>
                          {h}
                        </ThemedText>
                      ))}
                    </View>
                    {(schedule.data ?? []).map((p) => (
                      <View
                        key={p.installment_no}
                        style={[styles.tabelaLinha, { borderTopColor: theme.separator }]}>
                        <ThemedText
                          type="footnote"
                          style={[styles.celula, styles.celulaEstreita, tabular]}>
                          {p.installment_no}
                        </ThemedText>
                        <ThemedText type="footnote" style={[styles.celula, tabular]}>
                          {isoToBR(p.due_date)}
                        </ThemedText>
                        <View style={styles.celula}>
                          <Money cents={Number(p.payment_cents)} variant="footnote" />
                        </View>
                        <View style={styles.celula}>
                          {detalhe?.calculation_mode === 'fixed_installments' ? <ThemedText type="footnote">—</ThemedText> : <Money cents={Number(p.interest_cents)} variant="footnote" tone="danger" />}
                        </View>
                        <View style={styles.celula}>
                          {detalhe?.calculation_mode === 'fixed_installments' ? <ThemedText type="footnote">—</ThemedText> : <Money cents={Number(p.principal_cents)} variant="footnote" />}
                        </View>
                        <View style={styles.celula}>
                          <Money
                            cents={Number(p.balance_cents)}
                            variant="footnote"
                            tone="textSecondary"
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
      </Sheet>

      {/* Pagar parcela — sheet com a conta explicada ANTES de confirmar. */}
      <Sheet visible={pagando !== null} onClose={() => setPagando(null)}>
          <TaskHeader
            title="Pagar {pagando?.name}"
            onClose={() => setPagando(null)}
          />

          {pagando ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              {pagando.calculation_mode === 'fixed_installments' ? <Field label="Valor desta parcela">
                <Money cents={pagoCents} variant="headline" concealable={false} />
              </Field> : <Field label="Quanto você pagou" hint="Pagar a mais abate mais do saldo.">
                <MoneyField valueCents={pagoCents} onChangeCents={setPagoCents} />
              </Field>}

              {/* A conta é a metade do valor da tela: parcela NÃO abate o saldo pelo valor cheio. */}
              {proxima && pagando.calculation_mode !== 'fixed_installments' ? (
                /* Superfície de DECISÃO: a conta que explica o pagamento em curso não pode
                   sumir com o "esconder saldo" — é ela que justifica o valor digitado. */
                <Card style={styles.explica}>
                  <View style={styles.valores}>
                    <Money
                      cents={Number(proxima.interest_cents)}
                      variant="subhead"
                      tone="danger"
                      concealable={false}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      vão para o juro do mês,
                    </ThemedText>
                    <Money
                      cents={Math.max(0, pagoCents - Number(proxima.interest_cents))}
                      variant="subhead"
                      concealable={false}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      abatem o saldo.
                    </ThemedText>
                  </View>
                  <View style={styles.valores}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Fica em
                    </ThemedText>
                    <Money
                      cents={Math.max(
                        0,
                        Number(pagando.remaining_cents) -
                          Math.max(0, pagoCents - Number(proxima.interest_cents))
                      )}
                      variant="subhead"
                      concealable={false}
                      tone="danger"
                    />
                  </View>
                </Card>
              ) : null}

              <Field label="Conta que paga" hint="Opcional — o lançamento fica sem conta se você não escolher.">
                <AccountPicker
                  accounts={pagadoras}
                  value={contaId}
                  onChange={setContaId}
                  emptyLabel="Não informar"
                />
              </Field>

              <Button
                label="Registrar pagamento"
                block
                loading={pagar.isPending}
                disabled={pagoCents <= 0}
                onPress={confirmarPagamento}
              />
            </ScrollView>
          ) : null}
      </Sheet>

      {/* Criar / editar */}
      <Sheet visible={form !== null} onClose={() => volta.aoFechar(() => setForm(null))}>
          <TaskHeader
            title={form?.id ? 'Editar dívida' : 'Nova dívida'}
            onClose={() => volta.aoFechar(() => setForm(null))}
            action={
              <Button
                label="Salvar"
                size="sm"
                loading={save.isPending}
                disabled={!podeSalvar}
                onPress={salvar}
              />
            }
          />

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              {!form.id && <Segmented
                options={[{ value: 'fixed_installments', label: 'Parcela fixa' }, { value: 'amortized', label: 'Com juros ao mês' }]}
                value={form.calculationMode}
                // O "Tipo" só aparece no modo com juros. Voltando para parcela fixa, o tipo escolhido
                // lá ficaria escondido e seria gravado; volta ao padrão com que o formulário abriu.
                onChange={(calculationMode) => setForm({
                  ...form,
                  calculationMode,
                  ...(calculationMode === 'fixed_installments'
                    ? { kind: params.create === 'financing' ? 'financing' : FORM_VAZIO.kind }
                    : {}),
                })}
              />}
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
                    placeholder="48"
                  />
                </Field>
                <Field
                  label="Parcelas já pagas"
                  hint={pagamentosLancados > 0 ? `${pagamentosLancados} ${pagamentosLancados === 1 ? 'lançada' : 'lançadas'} pelo app.` : undefined}>
                  <QuantityField
                    value={form.installmentsPaid}
                    min={pagamentosLancados}
                    max={totalDeParcelas > 0 ? totalDeParcelas : 999}
                    onChange={mudarPagas}
                    accessibilityLabel="Parcelas já pagas"
                  />
                </Field>
                <Field label={rotuloDaData}>
                  <DatePickerField
                    value={proximaISO ? isoToBR(proximaISO) : null}
                    onChange={escolherData}
                    accessibilityLabel={rotuloDaData}
                  />
                </Field>
                {simpleValues && <Card>
                  <ThemedText type="small">{`${simpleValues.installments}× de ${brl(parcelaCents)} = ${brl(simpleValues.principal_cents)}`}</ThemedText>
                  <Money cents={simpleValues.remaining_cents} variant="headline" />
                  <ThemedText type="caption" themeColor="textSecondary">{`Faltam ${simpleValues.installments - form.installmentsPaid} parcelas. Não é uma simulação de juros.`}</ThemedText>
                </Card>}
                {/*
                  "Nome e conta" era um botão SÓ DE TEXTO ("Adicionar detalhes (opcional)") solto no
                  formulário — não parecia clicável (23/09/2026). É uma linha que abre no lugar e já
                  diz o que está lá. O caminho rápido continua pedindo só o necessário, e o nome cai
                  em "Financiamento" quando vazio.
                */}
                <Section>
                  <Row
                    icon="pencil"
                    title="Nome e conta"
                    subtitle={`${form.name.trim() || 'Financiamento'} · ${pagadoras.find((a) => a.id === form.accountId)?.name ?? 'sem conta'}`}
                    chevron={false}
                    trailing={<Icon name={form.showDetails ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
                    onPress={() => setForm({ ...form, showDetails: !form.showDetails })}
                    accessibilityState={{ expanded: form.showDetails }}
                  />
                </Section>
                {form.showDetails && <>
                  {/*
                    ⚠️ O placeholder mostra o NOME QUE SERÁ GRAVADO, não um exemplo do que
                    escrever. Ele dizia "Financiamento do carro" e o default era "Financiamento":
                    o campo parecia vazio, salvava, e a dívida nascia com outro nome.
                  */}
                  <Field label="Nome"><TextField value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Financiamento" /></Field>
                  <Field label="Conta que paga" hint="Opcional — a parcela fica sem conta se você não escolher.">
                    <AccountPicker accounts={pagadoras} value={form.accountId} onChange={(accountId: string | null) => setForm({ ...form, accountId })} emptyLabel="Não informar" />
                  </Field>
                </>}
                <ThemedText type="caption" themeColor="textSecondary">Cadastrar não desconta dinheiro. Registre as parcelas conforme forem pagas.</ThemedText>
              </> : <>
              <Field label="Nome">
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Empréstimo do banco"
                  autoFocus
                />
              </Field>

              {/*
                `Chip` é filtro de lista — muitos, ligáveis, resposta imediata. Aqui são cinco
                opções mutuamente exclusivas GRAVADAS num campo, que é o papel do `SelectField`:
                colapsado ele mostra o valor, e a forma de cada tipo vem do glifo em `DEBT_KINDS`.
              */}
              <Field label="Tipo">
                <SelectField
                  options={DEBT_KINDS.map((k) => ({ id: k.value, label: k.label, icon: k.icon }))}
                  value={form.kind}
                  onChange={(kind) => setForm({ ...form, kind: (kind ?? 'loan') as Debt['kind'] })}
                  placeholder="Escolher"
                />
              </Field>

              <Field label="Quanto você deve hoje">
                <MoneyField
                  valueCents={form.remainingCents}
                  onChangeCents={(remainingCents) => setForm({ ...form, remainingCents })}
                />
              </Field>

              <Field
                label="Valor original"
                hint="Deixe zerado se você ainda não pagou nada. É daqui que sai a barra de progresso.">
                <MoneyField
                  valueCents={form.principalCents}
                  onChangeCents={(principalCents) => setForm({ ...form, principalCents })}
                />
              </Field>

              <Field
                label="Juros por mês"
                hint="A taxa mensal do contrato. Zero só se não houver juros.">
                <View>
                  <TextField
                    value={form.taxa}
                    onChangeText={(taxa) => setForm({ ...form, taxa })}
                    placeholder="1,99"
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
                <View style={styles.valores}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {taxaLabel(fracao)} dá
                  </ThemedText>
                  <Money
                    cents={Math.round(form.remainingCents * fracao)}
                    variant="subhead"
                    tone="danger"
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    de juros no primeiro mês sobre
                  </ThemedText>
                  <Money cents={form.remainingCents} variant="subhead" tone="textSecondary" />
                </View>
              ) : null}

              {fracao > 0.2 ? (
                <View style={styles.aviso}>
                  <Icon name="exclamationmark.triangle" size="sm" color="warning" />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.avisoTexto}>
                    Confira se a taxa do contrato é mensal. Taxa anual efetiva não deve ser dividida por 12.
                  </ThemedText>
                </View>
              ) : null}

              <Field label="Valor da parcela" hint="O valor do contrato. A amortização é estimativa Price.">
                <MoneyField valueCents={form.installmentCents} onChangeCents={(installmentCents) => setForm({ ...form, installmentCents })} />
              </Field>
              <ThemedText type="small" themeColor="textSecondary">O cronograma é uma estimativa mensal. Cadastrar a dívida não cria prestações pendentes na projeção; registre cada pagamento nesta tela.</ThemedText>
              <View style={styles.duasColunas}>
                <View style={styles.coluna}>
                  <Field label="Parcelas que faltam">
                    <TextField
                      value={form.parcelas}
                      onChangeText={(v) =>
                        setForm({ ...form, parcelas: v.replace(/\D/g, '').slice(0, 3) })
                      }
                      placeholder="12"
                      keyboardType="number-pad"
                    />
                  </Field>
                </View>
              </View>
              {form.parcelas !== '' ? (
                <Field label={rotuloDaData}>
                  <DatePickerField
                    value={proximaISO ? isoToBR(proximaISO) : null}
                    onChange={escolherData}
                    accessibilityLabel={rotuloDaData}
                  />
                </Field>
              ) : null}
              {/*
                ⚠️ **Vem DEPOIS de "Parcelas que faltam", porque é esse campo que o cria.**
                Ele renderizava ACIMA, gated em `form.parcelas !== ''` — então digitar o número
                de parcelas fazia um campo novo NASCER acima do dedo e empurrar o formulário
                inteiro para baixo no meio da digitação. É a mesma frase da régua de
                `frontend.md` ("a tela se remonta debaixo do dedo"), só que para cima.
              */}
              {form.parcelas !== '' && (
                <Field label="Parcelas já pagas"
                  hint="Já está no saldo devedor acima — não desconto de novo.">
                  {/*
                    ⚠️ **Sem chip "Nenhuma", e o campo nasce em `0`** (15/09/2026, a mesma régua
                    do formulário de lançamento). O chip escrevia exatamente o valor que o campo
                    ao lado passaria a mostrar — dois controles para um dado só. O que ele
                    existia para resolver era o campo nascer VAZIO precisando de confirmação;
                    com default o problema não existe, e a frase logo abaixo diz a conta que saiu
                    disso ("N pagas + M restantes").
                  */}
                  <TextField value={String(form.installmentsPaid)}
                    onChangeText={(v) => setForm({ ...form, installmentsPaid: Number(v.replace(/\D/g, '')), historyConfirmed: true })}
                    placeholder="0" maxLength={3} keyboardType="number-pad"
                    accessibilityLabel="Parcelas do financiamento já pagas" />
                </Field>
              )}
              {form.parcelas !== '' && form.historyConfirmed && (
                <ThemedText type="small" themeColor="textSecondary">
                  {`${form.installmentsPaid} pagas + ${form.parcelas} restantes = ${Number(form.parcelas) + form.installmentsPaid} parcelas no total.`}
                </ThemedText>
              )}
              {/*
                A conta que paga vem DEPOIS do cronograma: ela estava no meio dos valores,
                separando "valor da prestação" de "quantas parcelas". Campo longo (uma lista
                de contas) partindo um grupo curto era o "ordem toda bagunçada" de 09/09/2026.
              */}
              <Field label="Conta que paga">
                <AccountPicker accounts={pagadoras} value={form.accountId} onChange={(accountId: string | null) => setForm({ ...form, accountId })} emptyLabel="Não informar" />
              </Field>
              </>}
            </ScrollView>
          ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  paneBody: {
    gap: Space.xl,
    minWidth: 0,
  },
  hero: {
    gap: Space.sm,
  },
  valores: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  ordem: {
    gap: Space.md,
  },
  ordemLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  ordemTexto: {
    flex: 1,
    gap: 2,
  },
  divida: {
    gap: Space.sm,
  },
  dividaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  dividaNome: {
    flexShrink: 1,
  },
  arquivada: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingVertical: Space.md,
    // a mesma calha do `Row` acima dela
    paddingHorizontal: Space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  proxima: {
    gap: Space.md,
  },
  explica: {
    gap: Space.sm,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  tabelaBloco: {
    gap: Space.sm,
  },
  tabelaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  /**
   * `minWidth`, não `width`: a tabela vive num `ScrollView` horizontal, então a célula pode
   * crescer com o conteúdo em vez de cortá-lo. Com largura fixa, "vencimento" e uma data em
   * fonte grande viravam "vencimen…" — e uma data pela metade não é dado, é ruído.
   */
  celula: {
    minWidth: 92,
  },
  celulaEstreita: {
    minWidth: 32,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  duasColunas: {
    flexDirection: 'row',
    gap: Space.md,
  },
  coluna: {
    flex: 1,
  },
});
