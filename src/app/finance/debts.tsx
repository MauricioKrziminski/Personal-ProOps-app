import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useBRL } from '@/components/ui/conceal';
import { SelectField } from '@/components/ui/select-field';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
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
import { Deslizavel } from '@/components/ui/deslizavel';
import { PressableScale } from '@/components/motion/pressable-scale';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { VerMais } from '@/components/ui/ver-mais';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { Segmented } from '@/components/ui/segmented';
import { SwitchRow } from '@/components/ui/switch-row';
import { Skeleton, SkeletonHero, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
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
import { formatBRL, localISODate } from '@/hooks/use-items';
import { useVoltarQuandoFechar } from '@/hooks/use-voltar-quando-fechar';
import { pagamentoDaParcelaFixa } from '@/lib/confirmar-baixa';
import { brToISO, formatNumberBR, isoToBR } from '@/lib/dates';
import { paidInstallments, porAno, secoesDaLinha, type ItemDaLinha } from '@/lib/debt-history';
import { lerAoVoltar } from '@/lib/volta-da-parcela';
import {
  ancoraDoContrato,
  debtTerm,
  financeErrorMessage,
  parcelaDoTotalDoContrato,
  proximaNoCronograma,
  simpleDebtValues,
  type UnidadeDoValor,
} from '@/lib/finance-form';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { AccountPicker } from '@/components/finance/account-picker';
import { DebtTimeline } from '@/components/finance/debt-timeline';
import { RingGauge } from '@/components/ui/ring-gauge';
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
  id?: string;
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

const FORM_VAZIO: FormState = {
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
  const toast = useToast();
  const debts = useDebts();
  const [estrategia, setEstrategia] = useState<'avalanche' | 'snowball'>('avalanche');
  const payoff = usePayoffStrategy(estrategia);
  /**
   * A ordem já chegou uma vez? Antes disso "Por onde começar" é só forma; depois, trocar a
   * estratégia mantém título e seletor (é o controle tocado) e só as linhas viram esqueleto.
   * Estado, não ref, e ajustado no render — o mesmo idioma de `useTelaPronta`.
   */
  const [ordemJaVeio, setOrdemJaVeio] = useState(false);
  if (payoff.data && !ordemJaVeio) setOrdemJaVeio(true);
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
   * A FICHA da dívida é uma TELA — `/finance/debts?id=<dívida>` —, não uma folha (25/09/2026). Era
   * um `Sheet`: abrir uma parcela fechava a ficha e voltar a reabria (*"para que fechar e não só
   * voltar?"*). Como tela, a parcela e o lançamento empilham por cima e "voltar" só volta, e quem
   * chega de fora (o pagamento no lançamento, a prestação no ciclo) cai direto nela. O mesmo
   * componente desenha as duas — sem `id` a lista, com `id` a ficha —, e as folhas de pagar e de
   * editar servem às duas.
   */
  const fichaId = params.id;
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const detalhe = fichaId ? (debts.data?.find((debt) => debt.id === fichaId) ?? null) : null;
  const pagando = debts.data?.find((debt) => debt.id === pagandoId) ?? null;
  const abrirFicha = (d: Debt) => router.push({ pathname: '/finance/debts', params: { id: d.id } });
  const setPagando = (debt: Debt | null) => setPagandoId(debt?.id ?? null);
  const [pagoCents, setPagoCents] = useState(0);
  const [contaId, setContaId] = useState<string | null>(null);
  const [nasProximas, setNasProximas] = useState(false);

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
  /**
   * A linha do tempo em duas metades, cada uma aos poucos (24/09/2026): o que falta a partir da
   * próxima, e o que já foi pago do mais recente para o mais antigo. Um financiamento de 360
   * parcelas desenhava as 360 de uma vez, com a próxima centenas de linhas abaixo do topo.
   */
  const secoes = secoesDaLinha(historico, detalhe ? (schedule.data ?? []) : []);
  const aSeguir = useAosPoucos(secoes.aSeguir, detalhe?.id ?? '');
  const jaPagas = useAosPoucos(secoes.pagas, detalhe?.id ?? '');
  const pagadoras = (accounts.data ?? []).filter((a) => a.type !== 'credit_card');

  const abrirNova = () => setForm({ ...FORM_VAZIO });
  const abrirEdicao = (d: Debt) =>
    setForm({
      calculationMode: d.calculation_mode,
      // No editar, nome e conta já aparecem: quem abriu o editar veio mudar alguma coisa.
      unidade: 'parcela',
      valorCents: Number(d.installment_cents ?? 0),
      ancora: d.first_due_date ?? null,
      pagasOriginal: d.installments_paid,
      id: d.id,
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
    });

  const abrirPagamento = (d: Debt) => {
    setPagoCents(Number((detalhe?.id === d.id ? schedule.data?.[0]?.payment_cents : null) ?? d.installment_cents ?? 0));
    setContaId(d.account_id);
    setNasProximas(false);
    setPagando(d);
  };

  /**
   * Toda parcela abre (25/09/2026): a paga com lançamento abre o LANÇAMENTO (editar, apagar); a
   * futura e a só contada, a tela da parcela. As duas empilham sobre a ficha — voltar é voltar.
   */
  const abrirParcela = (item: ItemDaLinha) => {
    if (!detalhe) return;
    if (item.txId) router.push({ pathname: '/finance/[txId]', params: { txId: item.txId } });
    else router.push({ pathname: '/finance/debt-installment', params: { debt: detalhe.id, n: String(item.n) } });
  };
  // "Paguei esta parcela" na tela da parcela volta para a ficha JÁ no pagamento
  // (`volta-da-parcela.ts`). ⚠️ `useCallback`: sem ele o efeito roda a cada render, não só no foco.
  const listaDeDividas = debts.data;
  useFocusEffect(
    useCallback(() => {
      const pedido = lerAoVoltar();
      const d = pedido ? listaDeDividas?.find((x) => x.id === pedido.divida) : null;
      if (!pedido || !d) return;
      setPagoCents(pedido.cents ?? Number(d.installment_cents ?? 0));
      setContaId(d.account_id);
      setNasProximas(false);
      setPagandoId(d.id);
    }, [listaDeDividas, setPagoCents, setContaId, setNasProximas, setPagandoId]),
  );

  /**
   * Parcela fixa paga com outro valor (25/09/2026): conta UMA parcela e a diferença é encargo ou
   * desconto (`20260925120000`). Com "Usar este valor nas próximas" o contrato passa ao valor novo
   * ANTES do pagamento — a parcela sai inteira nele, sem encargo, e o saldo continua sendo
   * parcela × restantes (o CHECK do contrato fixo).
   */
  const parcelaDoContrato = pagando?.calculation_mode === 'fixed_installments'
    ? Math.min(Number(pagando.installment_cents ?? 0), Number(pagando.remaining_cents))
    : 0;
  const naParcelaFixa = parcelaDoContrato > 0 ? pagamentoDaParcelaFixa(parcelaDoContrato, pagoCents) : null;
  const podeMudarContrato = Boolean(naParcelaFixa && !naParcelaFixa.erro && naParcelaFixa.diferenca !== 0 && pagando?.installments);
  const mudaContrato = podeMudarContrato && nasProximas;

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
  /**
   * Pagamento lançado pelo app é fato: dizer menos pagas do que isso é contradição. O piso é a
   * MAIOR parcela já paga, não só a contagem — com um "Paguei" lançado como a 5ª, dizer 4 pagas
   * deixava a 5ª paga aparecendo como futura na linha do tempo e no cronograma.
   */
  const pagamentosLancados = form?.id
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
  const ancoraEfetiva = form?.ancora ?? null;
  const diaDoContrato = form?.diaVencimento ? Number(form.diaVencimento) : null;
  const proximaISO =
    ancoraEfetiva && diaDoContrato && form
      ? // A do CRONOGRAMA, não só a do contrato: diminuir as pagas não põe a data no passado.
        proximaNoCronograma(ancoraEfetiva, form.installmentsPaid, diaDoContrato, localISODate())
      : form?.id
        ? (schedule.data?.[0]?.due_date ?? null)
        : null;
  /** Valor e prazo preenchidos e sem data: o único motivo de o Salvar estar travado — e a tela diz. */
  const faltaData = Boolean(form?.parcelas) && !ancoraEfetiva && !(form?.id && diaDoContrato) &&
    (form?.calculationMode === 'fixed_installments' ? parcelaCents > 0 : (form?.remainingCents ?? 0) > 0);
  const rotuloDaData = !form || form.installmentsPaid === 0 ? 'Primeira parcela' : `Próxima parcela (a ${form.installmentsPaid + 1}ª)`;
  const escolherData = (br: string) => {
    if (!form) return;
    const iso = brToISO(br);
    const dia = Number(iso.slice(8));
    const [ano, mes] = iso.split('-').map(Number);
    const ultimoDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    // O último dia de um mês curto (28/02, 30/04) é o dia 31 CLAMPADO: quem já vence no 31 não
    // pode virar dia 28 para sempre só por ter escolhido a data num mês curto.
    const atual = Number(form.diaVencimento) || 0;
    const diaVencimento = dia === ultimoDoMes && atual > dia ? atual : dia;
    setForm({ ...form, ancora: ancoraDoContrato(iso, form.installmentsPaid), diaVencimento: String(diaVencimento) });
  };
  const mudarPagas = (n: number) => {
    if (!form) return;
    // Pagas além do total assentam no total: é o teto que existe.
    // O teto nunca fica ABAIXO das pagas: digitar "60" passa por "6", e o total não pode arrastar
    // as pagas junto no meio da digitação (o `onBlur` do total é que assenta, frontend.md).
    const teto = totalDeParcelas > 0 ? Math.max(totalDeParcelas, form.installmentsPaid) : Infinity;
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
   * O nome é obrigatório (23/09/2026: *"ser obrigatório o nome"*) — caía em "Financiamento 2". Com
   * o resto preenchido e o nome faltando, o campo diz por que o Salvar não liga.
   */
  const faltaNome = Boolean(form) && !nomeOk &&
    (form?.calculationMode === 'fixed_installments' ? Boolean(simpleValues) : (form?.remainingCents ?? 0) > 0);
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
  const podeSalvar = Boolean(form && nomeOk && validDueDay && (!form.id || payments.isSuccess) && (form.calculationMode === 'fixed_installments' ? simpleValues : advancedValid));


  const salvar = () => {
    if (!form || !podeSalvar) return;
    save.mutate(
      {
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
      },
      {
        onSuccess: () => {
          toast({ message: form.id ? 'Dívida atualizada.' : 'Dívida cadastrada.', tone: 'success' });
          volta.aoFechar(() => setForm(null));
        },
        onError: (error) =>
          toast({
            message:
              (error as { code?: string }).code === 'VERSAO'
                ? 'A dívida mudou enquanto você editava (um pagamento pode ter chegado). Feche e abra de novo.'
                : financeErrorMessage(error, 'Não deu para salvar. Já existe uma dívida com esse nome?'),
            tone: 'error',
          }),
      }
    );
  };

  const confirmarPagamento = () => {
    if (!pagando || pagoCents <= 0 || naParcelaFixa?.erro) return;
    const registrar = () =>
      pagar.mutate(
        { debtId: pagando.id, amountCents: pagoCents, accountId: contaId },
        {
          onSuccess: () => {
            toast({
              message: <>Parcela de <Forte>{pagando.name}</Forte> registrada.{mudaContrato ? ` As próximas passam a ${formatBRL(pagoCents)}.` : ''}</>,
              tone: 'success',
            });
            volta.aoFechar(() => setPagando(null));
          },
          // o sheet FICA aberto: fechar num erro faz o usuário registrar o pagamento de novo
          onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para registrar o pagamento.'), tone: 'error' }),
        }
      );
    if (!mudaContrato) return registrar();
    // Contrato primeiro: falhando, nada foi pago. A mesma porta do "Editar dívida", com a trava
    // de versão (um "Paguei" pelo WhatsApp no meio não é sobrescrito).
    save.mutate(
      {
        id: pagando.id,
        name: pagando.name,
        kind: pagando.kind,
        ...simpleDebtValues(pagoCents, String(pagando.installments), pagando.installments_paid),
        account_id: pagando.account_id,
        due_day: pagando.due_day,
        versao: pagando.updated_at ?? null,
      },
      {
        onSuccess: registrar,
        onError: (error) =>
          toast({
            message:
              (error as { code?: string }).code === 'VERSAO'
                ? 'A dívida mudou enquanto você pagava (um pagamento pode ter chegado). Feche e abra de novo.'
                : financeErrorMessage(error, 'Não deu para mudar o valor das próximas parcelas.'),
            tone: 'error',
          }),
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
      onSuccess: () => {
        toast({
          message: <>Arquivei <Forte>{d.name}</Forte>.</>,
          tone: 'success',
          action: { label: 'Desfazer', onPress: () => desarquivar(d) },
        });
        // Arquivada, ela sai das ativas: a ficha dela não tem mais o que mostrar.
        if (fichaId === d.id) router.back();
      },
      onError: () => toast({ message: <>Não deu para arquivar <Forte>{d.name}</Forte>.</>, tone: 'error' }),
    });

  const desarquivar = (d: Debt) =>
    unarchive.mutate(d.id, {
      onSuccess: (voltou) =>
        toast(
          voltou
            ? { message: <><Forte>{d.name}</Forte> voltou para a lista.</>, tone: 'success' as const }
            : { message: <><Forte>{d.name}</Forte> não existe mais.</>, tone: 'error' as const },
        ),
      onError: () => toast({ message: <>Não deu para desarquivar <Forte>{d.name}</Forte>.</>, tone: 'error' }),
    });

  /**
   * "Excluir por completo" (23/09/2026): a dívida, os pagamentos já lançados e as parcelas
   * futuras da projeção. A confirmação diz a consequência CONTADA — quantos pagamentos e quanto
   * volta ao saldo —, porque é isso que muda o passado da pessoa.
   */
  const excluir = async (d: Debt) => {
    let consequencia = 'Apaga a dívida e as parcelas futuras da projeção. Não dá para desfazer.';
    try {
      const { count, totalCents } = await pagamentosDaDivida(d.id);
      if (count > 0) {
        consequencia = `Apaga a dívida, ${count === 1 ? 'o pagamento já lançado' : `os ${count} pagamentos já lançados`} (${brl(totalCents)}, que ${count === 1 ? 'volta' : 'voltam'} ao saldo das contas) e as parcelas futuras da projeção. Não dá para desfazer.`;
      }
    } catch {
      /* Sem a contagem, a frase genérica ainda diz o que some. */
    }
    confirmDestructive(
      `Excluir a dívida ${d.name} por completo?`,
      'Excluir',
      () =>
        excluirDivida.mutate(d.id, {
          onSuccess: () => {
            if (fichaId === d.id) router.back();
            toast({ message: <>Excluí <Forte>{d.name}</Forte>.</>, tone: 'success' });
          },
          onError: (error) =>
            toast({ message: financeErrorMessage(error, `Não deu para excluir ${d.name}.`), tone: 'error' }),
        }),
      consequencia
    );
  };

  /** Uma lista só de ações: o toque longo e o "…" do detalhe leem daqui. */
  /**
   * O menu da dívida, UMA lista para o toque longo, o "…" do detalhe e o arrasto. "Pagar parcela"
   * é a ação rápida do card (o detalhe tem o caminho dele); Arquivar tem "Desfazer" no aviso, e
   * por isso vale até o fim.
   */
  const listaDaDivida = (d: Debt, noDetalhe = false): ItemAction[] => [
    ...(noDetalhe || Number(d.remaining_cents) <= 0
      ? []
      : [{ label: 'Pagar parcela', curto: 'Pagar', icon: 'banknote' as const, arrasto: 'direita' as const, onPress: () => abrirPagamento(d) }]),
    // No detalhe já se está vendo as parcelas: a ação sai, o resto é a MESMA lista.
    ...(noDetalhe ? [] : [{ label: 'Ver as parcelas', onPress: () => abrirFicha(d) }]),
    { label: 'Editar', onPress: () => abrirEdicao(d) },
    { label: 'Arquivar', icon: 'archivebox', arrasto: 'esquerda', desfaz: true, onPress: () => arquivar(d) },
    { label: 'Excluir por completo', destructive: true, onPress: () => void excluir(d) },
  ];
  const acoesDaDivida = (d: Debt, noDetalhe = false) => showItemActions(d.name, listaDaDivida(d, noDetalhe));

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
    const juros = d.calculation_mode === 'fixed_installments' ? 'parcela fixa' : d.interest_rate_monthly > 0 ? `juros ${taxaLabel(d.interest_rate_monthly)}` : 'sem juros';
    const parcelas = d.installments ? `${d.installments_paid}/${d.installments} pagas` : null;

    return (
      <Animated.View
        key={d.id}
        layout={transicaoDeLayout}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Deslizavel titulo={d.name} acoes={listaDaDivida(d)} forma="card">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${d.name}, ${tipo}, deve ${brl(restante)}, ${juros}${parcelas ? `, ${parcelas}` : ''}`}
          onPress={() => abrirFicha(d)}
          onLongPress={() => acoesDaDivida(d)}>
          <Card style={styles.divida}>
            <View style={styles.dividaTopo}>
              <ThemedText type="default" style={styles.dividaNome}>
                {d.name}
              </ThemedText>
              <Money cents={restante} variant="ticker" tone="danger" />
            </View>
            <ProgressBar value={pago} max={original} tone={restante <= 0 ? 'success' : 'tint'} />
            <ThemedText type="footnote" themeColor="textSecondary">
              {tipo} · {juros}
              {parcelas ? ` · ${parcelas}` : ''}
            </ThemedText>
          </Card>
        </PressableScale>
        </Deslizavel>
      </Animated.View>
    );
  };

  const loading = debts.isLoading ? (
    <>
      <Skeleton height={120} radius={Radius.md} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;

  /** As linhas da ordem enquanto ela chega — na primeira carga e na troca de estratégia. */
  const ordemEsqueleto = lista.map((d) => (
    <View key={d.id} style={styles.ordemLinha}>
      <Skeleton width={18} height={18} />
      <View style={styles.ordemTexto}>
        <Skeleton width="70%" height={18} />
        <Skeleton width="50%" height={14} />
      </View>
      <Skeleton width={76} height={22} />
    </View>
  ));

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
              <ThemedText type="small" themeColor="textSecondary">
                <Money cents={jurosAteQuitar} variant="subhead" tone="textSecondary" /> de juros até
                quitar tudo
              </ThemedText>
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

      {lista.length > 1 && !payoff.isError && !ordemJaVeio && payoff.isLoading ? (
        // Primeira carga: texto nunca aparece em esqueleto (25/09/2026) — título, seletor e
        // linhas são forma, nas alturas do bloco pronto.
        <Card style={styles.ordem}>
          <Skeleton width="40%" height={19} />
          <Skeleton height={40} radius={Radius.pill} />
          {estrategia === 'avalanche' ? <Skeleton width="60%" height={19} /> : null}
          {ordemEsqueleto}
        </Card>
      ) : lista.length > 1 && !payoff.isError ? (
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
          {estrategia === 'avalanche' ? (
            <ThemedText type="small" themeColor="textSecondary">
              Sem taxa informada fica por último
            </ThemedText>
          ) : null}
          {payoff.isLoading ? ordemEsqueleto : (payoff.data ?? []).map((p, i) => (
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
                  {lista.find((d) => d.id === p.debt_id)?.calculation_mode === 'fixed_installments' ? 'parcelas fixas' : Number(p.interest_rate_monthly) > 0 ? `juros ${taxaLabel(Number(p.interest_rate_monthly))}` : 'sem juros'} · {p.months_left} meses
                </ThemedText>
              </View>
              <Money cents={Number(p.remaining_cents)} variant="subhead" tone="danger" />
            </Animated.View>
          ))}
        </Card>
      ) : null}
    </View>
  );

  const listaArquivadas = arquivadas.isError ? [] : (arquivadas.data ?? []);
  const secaoArquivadas = arquivadas.isError ? (
    <ErrorBand message="Não deu para carregar as arquivadas." onRetry={arquivadas.refetch} />
  ) : listaArquivadas.length > 0 ? (
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
              <View key={d.id} style={styles.arquivada}>
                <Row
                  title={d.name}
                  subtitle="arquivada"
                  chevron={false}
                  trailing={<Money cents={Number(d.remaining_cents)} variant="subhead" tone="textSecondary" />}
                  onPress={() => acoesDaArquivada(d)}
                  accessibilityLabel={`${d.name}, arquivada. Toque para desarquivar ou excluir.`}
                />
              </View>
            ))
          : null}
      </Section>
    ) : null;

  // Sem dívida ativa e com arquivada, as arquivadas vêm PRIMEIRO e o vazio vira uma linha embaixo
  // (24/09/2026): o vazio grande no meio da tela deixava "Arquivadas · 1" solto num canto.
  const semAtivas = !debts.isLoading && !debts.isError && lista.length === 0;
  const temArquivadas = listaArquivadas.length > 0;
  const vazio = semAtivas ? (
    <EmptyState
      icon="creditcard.trianglebadge.exclamationmark"
      title={temArquivadas ? 'Nenhuma dívida ativa' : 'Nenhuma dívida cadastrada'}
      hint={'Manda no WhatsApp: *financiei o carro em 48x de 1.470*\n— ou toca em + para cadastrar aqui.'}
      action={{ label: 'Nova dívida', onPress: abrirNova }}
      compacto={temArquivadas}
    />
  ) : null;

  // Com as dívidas chegando, nada embaixo do esqueleto: "Arquivadas · N" pintava sob ele e depois
  // pulava para baixo da lista (25/09/2026).
  const debtListContent = debts.isLoading ? null : (
    <View style={styles.paneBody}>
      {lista.map(cartaoDivida)}
      {semAtivas && temArquivadas ? secaoArquivadas : null}
      {vazio}
      {semAtivas && temArquivadas ? null : secaoArquivadas}
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

  // As folhas de pagar e de editar: por cima da lista E da ficha.
  const folhas = (
    <>
      {/* Pagar parcela — sheet com a conta explicada ANTES de confirmar. */}
      <Sheet visible={pagando !== null} onClose={() => volta.aoFechar(() => setPagando(null))}>
          <TaskHeader
            title={pagando ? `Pagar ${pagando.name}` : 'Pagar'}
            onClose={() => volta.aoFechar(() => setPagando(null))}
          />

          {pagando ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              {/* Superfície de DECISÃO: o valor que a pessoa confere agora não se esconde. */}
              <Field
                label="Quanto você pagou"
                hint={
                  !podeMudarContrato || !naParcelaFixa
                    ? undefined
                    : mudaContrato
                      ? `Esta e as próximas parcelas passam a ${formatBRL(pagoCents)}.`
                      : `Conta como 1 parcela; ${formatBRL(Math.abs(naParcelaFixa.diferenca))} de ${naParcelaFixa.diferenca > 0 ? 'encargo' : 'desconto'}.`
                }
                error={naParcelaFixa?.erro ?? undefined}>
                <MoneyField valueCents={pagoCents} onChangeCents={setPagoCents} />
              </Field>
              {podeMudarContrato ? (
                <SwitchRow label="Usar este valor nas próximas" value={nasProximas} onValueChange={setNasProximas} />
              ) : null}

              {/* A conta é a metade do valor da tela: parcela NÃO abate o saldo pelo valor cheio. */}
              {proxima && pagando.calculation_mode !== 'fixed_installments' ? (
                /* Superfície de DECISÃO: a conta que explica o pagamento em curso não pode
                   sumir com o "esconder saldo" — é ela que justifica o valor digitado. */
                <Card style={styles.explica}>
                  <ThemedText type="small" themeColor="textSecondary">
                    <Money
                      cents={Number(proxima.interest_cents)}
                      variant="subhead"
                      tone="danger"
                      concealable={false}
                    />{' '}
                    vão para o juro do mês,{' '}
                    <Money
                      cents={Math.max(0, pagoCents - Number(proxima.interest_cents))}
                      variant="subhead"
                      concealable={false}
                    />{' '}
                    abatem o saldo.
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Fica em{' '}
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
                  </ThemedText>
                </Card>
              ) : null}

              <Field label="Conta que paga">
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
                loading={pagar.isPending || save.isPending}
                disabled={pagoCents <= 0 || Boolean(naParcelaFixa?.erro)}
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
                <Field label={rotuloDaData} error={faltaData ? 'Escolha a data' : undefined}>
                  <DatePickerField
                    value={proximaISO ? isoToBR(proximaISO) : null}
                    onChange={escolherData}
                    accessibilityLabel={rotuloDaData}
                    invalid={faltaData}
                  />
                </Field>
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
                hint="Zero se ainda não pagou nada">
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

              <Field label="Valor da parcela">
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
              {form.parcelas !== '' ? (
                <Field label={rotuloDaData} error={faltaData ? 'Escolha a data' : undefined}>
                  <DatePickerField
                    value={proximaISO ? isoToBR(proximaISO) : null}
                    onChange={escolherData}
                    accessibilityLabel={rotuloDaData}
                    invalid={faltaData}
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
            </ScrollView>
          ) : null}
      </Sheet>
    </>
  );

  /** A ficha de UMA dívida — o que era a folha "Amortização", agora a tela dela. */
  const fichaConteudo = (
    <>
      {schedule.isLoading ? (
        <>
          <SkeletonHero />
          <SkeletonList linhas={6} />
        </>
      ) : null}

      {schedule.isError ? (
        <ErrorBand
          message="Não deu para carregar as parcelas."
          onRetry={schedule.refetch}
        />
      ) : null}

      {proxima && detalhe ? (
        <Card style={styles.proxima}>
          <View style={styles.contrato}>
            {detalhe.installments ? (
              <RingGauge
                value={detalhe.installments_paid / detalhe.installments}
                size={76}
                stroke={7}
                accessibilityLabel={`${detalhe.installments_paid} de ${detalhe.installments} parcelas pagas`}>
                <ThemedText type="headline" style={tabular}>
                  {detalhe.installments_paid}
                </ThemedText>
              </RingGauge>
            ) : null}
            <View style={styles.contratoTexto}>
              <HeroLabel>Falta pagar</HeroLabel>
              <Money cents={Number(detalhe.remaining_cents)} variant="money" />
              {detalhe.installments ? (
                <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                  {`${detalhe.installments_paid} de ${detalhe.installments} pagas`}
                </ThemedText>
              ) : null}
            </View>
          </View>
          {/* Rótulo e valor no MESMO tamanho: em tamanhos diferentes a linha de base desalinhava. */}
          <View style={styles.proximaLinha}>
            <ThemedText type="default" themeColor="textSecondary" style={tabular}>
              {`Próxima · ${isoToBR(proxima.due_date)}`}
            </ThemedText>
            <Money cents={Number(proxima.payment_cents)} variant="body" />
          </View>
          {detalhe.calculation_mode !== 'fixed_installments' && Number(proxima.interest_cents) > 0 && (
            <ThemedText type="small" themeColor="danger">
              <Money cents={Number(proxima.interest_cents)} variant="subhead" tone="danger" /> disso
              são juros
            </ThemedText>
          )}
          <Button
            label="Paguei esta parcela"
            block
            onPress={() => abrirPagamento(detalhe)}
          />
        </Card>
      ) : null}


      {payments.isError ? (
        <ErrorBand message="Não deu para carregar os pagamentos." onRetry={payments.refetch} />
      ) : null}

      {/*
        Só com os pagamentos E o cronograma respondidos: sem os pagamentos, todo pagamento
        lançado apareceria como "por volta de" (estimado) e trocaria de rótulo ao chegar.
      */}
      {detalhe && payments.isSuccess && !schedule.isLoading &&
      (historico.length > 0 || (schedule.data ?? []).length > 0) ? (
        <>
          {aSeguir.visiveis.length > 0 ? (
            <View style={styles.secaoDaLinha}>
              <SectionHead title="A seguir" inset={false} />
              <DebtTimeline anos={porAno(aSeguir.visiveis)} onItemPress={abrirParcela} />
              <VerMais restantes={aSeguir.restantes} onPress={aSeguir.verMais} />
            </View>
          ) : null}
          {jaPagas.visiveis.length > 0 ? (
            <View style={styles.secaoDaLinha}>
              <SectionHead title="Já pagas" inset={false} />
              <DebtTimeline anos={porAno(jaPagas.visiveis)} onItemPress={abrirParcela} />
              <VerMais restantes={jaPagas.restantes} onPress={jaPagas.verMais} />
            </View>
          ) : null}
        </>
      ) : null}

      {!schedule.isLoading && !schedule.isError && !proxima ? (
        <EmptyState
          icon="calendar"
          title={
            detalhe && Number(detalhe.remaining_cents) <= 0
              ? 'Nada em aberto. Dívida quitada.'
              : 'Sem parcelas para mostrar'
          }
          hint={
            detalhe && Number(detalhe.remaining_cents) > 0
              ? 'Informe quantas parcelas faltam para eu montar a tabela.'
              : undefined
          }
          action={
            detalhe && Number(detalhe.remaining_cents) > 0
              ? { label: 'Editar dívida', onPress: () => abrirEdicao(detalhe) }
              : undefined
          }
          // Com histórico, "Já pagas" (o que existe) vem antes e o vazio é a linha compacta.
          compacto={historico.length > 0}
        />
      ) : null}
    </>
  );

  if (fichaId) {
    return (
      <Screen
        grouped
        wide={tablet}
        onRefresh={() => Promise.all([debts.refetch(), schedule.refetch(), payments.refetch(), accounts.refetch()])}>
        <Stack.Screen options={{ title: detalhe?.name ?? 'Dívida' }} />
        {/* Editar à direita e o resto no "…", como no lançamento. */}
        <HeaderActions
          actions={detalhe ? [{ label: 'Editar', onPress: () => abrirEdicao(detalhe) }] : []}
          menu={
            detalhe
              ? { title: detalhe.name, actions: listaDaDivida(detalhe, true).filter((a) => a.label !== 'Editar') }
              : undefined
          }
        />
        {debts.isLoading ? (
          <>
            <SkeletonHero />
            <SkeletonList linhas={6} />
          </>
        ) : debts.isError ? (
          <ErrorBand message="Não deu para carregar a dívida." onRetry={debts.refetch} />
        ) : !detalhe ? (
          <EmptyState
            icon="questionmark.folder"
            title="Essa dívida não existe mais"
            hint="Ela pode ter sido arquivada ou excluída."
            action={{ label: 'Voltar', onPress: () => router.back() }}
          />
        ) : (
          fichaConteudo
        )}
        {folhas}
      </Screen>
    );
  }

  return (
    <Screen
      grouped
      wide={tablet}
      onRefresh={() => Promise.all([debts.refetch(), payoff.refetch(), accounts.refetch(), arquivadas.refetch(), ...(pagandoId ? [schedule.refetch()] : [])])}>
      <Stack.Screen
        options={{
          title: 'Dívidas',
        }}
      />

      <HeaderActions actions={[{ label: 'Nova dívida', icon: 'plus', onPress: abrirNova }]} />

      {tablet ? tabletBody : compactBody}


      {folhas}
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
    gap: Space.half,
  },
  divida: {
    gap: Space.sm,
  },
  dividaTopo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  // ⚠️ `flexShrink: 0` + `flexWrap` na linha: dentro de `entering` o texto encolhido não se
  // remede (design.md §3, o "App bloqueado" pintado como "App").
  dividaNome: {
    flexShrink: 0,
    maxWidth: '100%',
  },
  arquivada: {
    opacity: 0.6,
  },
  proxima: {
    gap: Space.md,
  },
  contrato: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space.lg,
  },
  proximaLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  contratoTexto: {
    flex: 1,
    minWidth: 160,
    gap: Space.xs,
  },
  resumo: {
    gap: Space.sm,
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
  // Título da seção a `Space.md` do conteúdo, como todo `SectionHead` (design.md §2).
  secaoDaLinha: { gap: Space.md },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
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
