import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useBRL } from '@/components/ui/conceal';
import { PurchaseDownPayment } from '@/components/finance/purchase-down-payment';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { ListFilters, type FilterSelect } from '@/components/ui/list-filters';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Field, MoneyField } from '@/components/ui/field';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Deslizavel } from '@/components/ui/deslizavel';
import { PressableScale } from '@/components/motion/pressable-scale';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { VerMais } from '@/components/ui/ver-mais';
import { umDe, usePreferencia } from '@/hooks/use-preferencia';
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
  useDebtDeclaredEstimates,
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
import { pagamentoDaParcelaFixa } from '@/lib/confirmar-baixa';
import { brToISO, isoToBR } from '@/lib/dates';
import { accountSelectOptions } from '@/lib/accounts';
import { listFiltersActive, type ListFiltersValue } from '@/lib/list-filters';
import { semAcento } from '@/lib/text';
import { paidInstallments, porAno, secoesDaLinha, type ItemDaLinha } from '@/lib/debt-history';
import { lerAoVoltar } from '@/lib/volta-da-parcela';
import { financeErrorMessage, simpleDebtValues } from '@/lib/finance-form';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { hrefDoLancar } from '@/lib/lancar';
import { AccountPicker } from '@/components/finance/account-picker';
import { ErrorBand, taxaLabel } from '@/components/finance/formulario-da-divida';
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

export default function DebtsScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const params = useLocalSearchParams<Record<string, string>>();
  const toast = useToast();
  const debts = useDebts();
  const [estrategia, setEstrategia] = usePreferencia<'avalanche' | 'snowball'>('dividas:estrategia', 'avalanche', umDe(['avalanche', 'snowball']));
  const payoff = usePayoffStrategy(estrategia);
  /**
   * A ordem já chegou uma vez? Antes disso "Por onde começar" é só forma; depois, trocar a
   * estratégia mantém título e seletor (é o controle tocado) e só as linhas viram esqueleto.
   * Estado, não ref, e ajustado no render — o mesmo idioma de `useTelaPronta`.
   */
  const [ordemJaVeio, setOrdemJaVeio] = useState(false);
  if (payoff.data && !ordemJaVeio) setOrdemJaVeio(true);
  const accounts = useAccounts();
  const accountsForFilters = useAccounts(undefined, true);
  const filterSelects: readonly FilterSelect[] = [
    { key: 'tipo', label: 'Tipo', options: DEBT_KINDS.map((kind) => ({ id: kind.value, label: kind.label })) },
    { key: 'conta', label: 'Conta', options: accountSelectOptions(accountsForFilters.data ?? [], 'Sem conta', 'none') },
    { key: 'estado', label: 'Estado', options: [{ id: 'ativa', label: 'Ativa' }, { id: 'quitada', label: 'Quitada' }, { id: 'arquivada', label: 'Arquivada' }] },
  ];
  const save = useSaveDebt();
  const archive = useArchiveDebt();
  const unarchive = useUnarchiveDebt();
  const excluirDivida = useDeleteDebt();
  const arquivadas = useArchivedDebts();
  const [verArquivadas, setVerArquivadas] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filters, setFilters] = useState<ListFiltersValue>({});
  const pagar = usePayDebtInstallment();

  /**
   * A FICHA da dívida é uma TELA — `/finance/debts?id=<dívida>` —, não uma folha (25/09/2026). Era
   * um `Sheet`: abrir uma parcela fechava a ficha e voltar a reabria (*"para que fechar e não só
   * voltar?"*). Como tela, a parcela e o lançamento empilham por cima e "voltar" só volta, e quem
   * chega de fora (o pagamento no lançamento, a prestação no ciclo) cai direto nela. O mesmo
   * componente desenha as duas — sem `id` a lista, com `id` a ficha —, e a folha de pagar serve às
   * duas; editar abre o formulário único.
   */
  const fichaId = params.id;
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const detalhe = fichaId ? (debts.data?.find((debt) => debt.id === fichaId) ?? null) : null;
  const pagando = debts.data?.find((debt) => debt.id === pagandoId) ?? null;
  const abrirFicha = (d: Debt) => router.push({ pathname: '/finance/debts', params: { id: d.id } });
  const setPagando = (debt: Debt | null) => setPagandoId(debt?.id ?? null);
  const [pagoCents, setPagoCents] = useState(0);
  const [contaId, setContaId] = useState<string | null>(null);
  /** Quando saiu (26/09/2026): era sempre hoje — pagou ontem e lançou hoje ficava com a data errada. */
  const [pagoEm, setPagoEm] = useState(() => isoToBR(localISODate()));
  const [nasProximas, setNasProximas] = useState(false);

  // Lazy: só a dívida aberta (detalhe ou pagamento) puxa a tabela Price. O formulário de edição lê
  // os dele no corpo.
  const schedule = useDebtSchedule(detalhe?.id ?? pagando?.id);
  const payments = useDebtPayments(detalhe?.id ?? pagando?.id);
  const declaredEstimates = useDebtDeclaredEstimates(detalhe?.id);

  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const lista = useMemo(() => (debts.isError ? [] : (debts.data ?? [])), [debts.isError, debts.data]);
  const listaArquivadas = useMemo(() => (arquivadas.isError ? [] : (arquivadas.data ?? [])), [arquivadas.isError, arquivadas.data]);
  const { listaFiltrada, listaArquivadasFiltrada } = useMemo(() => {
    const termo = semAcento(filters.q ?? '');
    const corresponde = (debt: Debt) => {
      const nome = semAcento(debt.name);
      const estado = debt.archived ? 'arquivada' : Number(debt.remaining_cents) <= 0 ? 'quitada' : 'ativa';
      // O intervalo representa o primeiro vencimento. Sem uma âncora de cronograma, a dívida não casa.
      const data = debt.first_due_date;
      const dataOk = (!filters.from && !filters.to) || (data !== null
        && (!filters.from || data >= filters.from) && (!filters.to || data <= filters.to));
      return (!termo || nome.includes(termo))
        && (!filters.selections?.tipo || debt.kind === filters.selections.tipo)
        && (!filters.selections?.conta || (filters.selections.conta === 'none'
          ? debt.account_id === null : debt.account_id === filters.selections.conta))
        && (!filters.selections?.estado || estado === filters.selections.estado)
        && dataOk;
    };
    return {
      listaFiltrada: lista.filter(corresponde),
      listaArquivadasFiltrada: listaArquivadas.filter(corresponde),
    };
  }, [lista, listaArquivadas, filters]);
  const mostrarArquivadas = verArquivadas || (listFiltersActive(filters) && listaArquivadasFiltrada.length > 0);
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
        overrides: declaredEstimates.data ?? [],
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

  // Criar e editar abrem o formulário único. A dívida sabe se tem passado: as parcelas já pagas.
  const abrirNova = () => router.push(hrefDoLancar('financiamento'));
  const abrirEdicao = (d: Debt) =>
    router.push(hrefDoLancar('financiamento', { id: d.id, origem: 'divida', passado: d.installments_paid > 0 ? '1' : '0' }));

  const abrirPagamento = (d: Debt) => {
    setPagoCents(Number((detalhe?.id === d.id ? schedule.data?.[0]?.payment_cents : null) ?? d.installment_cents ?? 0));
    setContaId(d.account_id);
    setNasProximas(false);
    setPagoEm(isoToBR(localISODate()));
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
      // Chegando de FORA (o "Paguei" de Lançamentos), a lista ainda não veio: lido agora, o
      // recado se perderia. O efeito roda de novo quando ela chega.
      if (!listaDeDividas) return;
      const pedido = lerAoVoltar();
      const d = pedido ? listaDeDividas.find((x) => x.id === pedido.divida) : null;
      if (!pedido || !d) return;
      setPagoCents(pedido.cents ?? Number(d.installment_cents ?? 0));
      setContaId(d.account_id);
      setNasProximas(false);
      setPagoEm(isoToBR(localISODate()));
      setPagandoId(d.id);
    }, [listaDeDividas, setPagoCents, setContaId, setNasProximas, setPagandoId, setPagoEm]),
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

  const confirmarPagamento = () => {
    if (!pagando || pagoCents <= 0 || naParcelaFixa?.erro) return;
    const registrar = () =>
      pagar.mutate(
        { debtId: pagando.id, amountCents: pagoCents, accountId: contaId, paidAt: brToISO(pagoEm) },
        {
          onSuccess: () => {
            toast({
              message: <>Parcela de <Forte>{pagando.name}</Forte> registrada.{mudaContrato ? ` As próximas passam a ${formatBRL(pagoCents)}.` : ''}</>,
              tone: 'success',
            });
            setPagando(null);
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
      `Apagar a dívida ${d.name} por completo?`,
      'Apagar',
      () =>
        excluirDivida.mutate(d.id, {
          onSuccess: () => {
            if (fichaId === d.id) router.back();
            toast({ message: <>Excluí <Forte>{d.name}</Forte>.</>, tone: 'success' });
          },
          onError: (error) =>
            toast({ message: financeErrorMessage(error, `Não deu para apagar ${d.name}.`), tone: 'error' }),
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
    { label: 'Apagar por completo', icon: 'trash', destructive: true, onPress: () => void excluir(d) },
  ];
  const acoesDaDivida = (d: Debt, noDetalhe = false) => showItemActions(d.name, listaDaDivida(d, noDetalhe));

  const acoesDaArquivada = (d: Debt): ItemAction[] => [
    { label: 'Desarquivar', curto: 'Restaurar', icon: 'arrow.uturn.backward', arrasto: 'direita', onPress: () => desarquivar(d) },
    { label: 'Apagar por completo', curto: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => void excluir(d) },
  ];

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
            <HeroLabel>{listFiltersActive(filters) ? 'Total devido · dívidas ativas' : 'Total devido'}</HeroLabel>
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
          <ThemedText type="smallBold">{listFiltersActive(filters) ? 'Por onde começar · dívidas ativas' : 'Por onde começar'}</ThemedText>
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

  const secaoArquivadas = arquivadas.isError ? (
    <ErrorBand message="Não deu para carregar as arquivadas." onRetry={arquivadas.refetch} />
  ) : listaArquivadasFiltrada.length > 0 ? (
      <Section title={listFiltersActive(filters) ? `Arquivadas · ${listaArquivadasFiltrada.length}` : undefined}>
        {listFiltersActive(filters) ? null : <Row
          icon="archivebox"
          title={`Arquivadas · ${listaArquivadasFiltrada.length}`}
          chevron={false}
          trailing={<Icon name={mostrarArquivadas ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
          onPress={() => setVerArquivadas((v) => !v)}
          accessibilityState={{ expanded: mostrarArquivadas }}
        />}
        {mostrarArquivadas
          ? listaArquivadasFiltrada.map((d) => (
              <Deslizavel key={d.id} titulo={d.name} acoes={acoesDaArquivada(d)}>
                <View style={styles.arquivada}>
                  <Row
                    title={d.name}
                    subtitle="arquivada"
                    chevron={false}
                    trailing={<Money cents={Number(d.remaining_cents)} variant="subhead" tone="textSecondary" />}
                    onPress={() => showItemActions(d.name, acoesDaArquivada(d))}
                    accessibilityLabel={`${d.name}, arquivada. Toque para desarquivar ou excluir.`}
                  />
                </View>
              </Deslizavel>
            ))
          : null}
      </Section>
    ) : null;

  // Sem dívida ativa e com arquivada, as arquivadas vêm PRIMEIRO e o vazio vira uma linha embaixo
  // (24/09/2026): o vazio grande no meio da tela deixava "Arquivadas · 1" solto num canto.
  const semAtivas = !debts.isLoading && !debts.isError && lista.length === 0;
  const temArquivadas = listaArquivadas.length > 0;
  const vazio = semAtivas && !arquivadas.isLoading && !arquivadas.isError && !listFiltersActive(filters) ? (
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
      {lista.length > 0 || listaArquivadas.length > 0 ? <FilterBar value={filters} selects={filterSelects}
        dateLabel="Primeiro vencimento" defaultLabel="Todas as dívidas" onPress={() => setFiltersVisible(true)} /> : null}
      <ListFilters visible={filtersVisible} value={filters} onClose={() => setFiltersVisible(false)} onApply={setFilters}
        dateLabels={{ from: 'Primeiro vencimento a partir de', to: 'Primeiro vencimento até' }} selects={filterSelects} />
      {listaFiltrada.map(cartaoDivida)}
      {!debts.isError && !arquivadas.isLoading && !arquivadas.isError && listFiltersActive(filters)
        && listaFiltrada.length === 0 && listaArquivadasFiltrada.length === 0 ? (
        <EmptyState compacto icon="line.3.horizontal.decrease" title="Nenhuma dívida encontrada"
          hint="Ajuste ou limpe os filtros para ver outras dívidas."
          action={{ label: 'Limpar filtros', onPress: () => setFilters({}) }} />
      ) : null}
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

  // A folha de pagar: por cima da lista E da ficha.
  const folhas = (
    <>
      {/* Pagar parcela — sheet com a conta explicada ANTES de confirmar. */}
      <Sheet visible={pagando !== null} onClose={() => setPagando(null)}>
          <TaskHeader
            title={pagando ? `Pagar ${pagando.name}` : 'Pagar'}
            onClose={() => setPagando(null)}
          />

          {pagando ? (
            <SheetScroll contentContainerStyle={styles.sheetBody}>
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

              <Field label="Quando">
                <DatePickerField
                  value={pagoEm}
                  onChange={setPagoEm}
                  max={localISODate()}
                  accessibilityLabel="Data do pagamento"
                />
              </Field>

              <Button
                label="Registrar pagamento"
                block
                loading={pagar.isPending || save.isPending}
                disabled={pagoCents <= 0 || Boolean(naParcelaFixa?.erro)}
                onPress={confirmarPagamento}
              />
            </SheetScroll>
          ) : null}
      </Sheet>
    </>
  );

  /** A ficha de UMA dívida — o que era a folha "Amortização", agora a tela dela. */
  const fichaConteudo = (
    <>
      {detalhe ? <PurchaseDownPayment type="financiamento" parentId={detalhe.id}
        installmentsCents={detalhe.calculation_mode === 'fixed_installments' ? Number(detalhe.principal_cents) : undefined} /> : null}
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
      {declaredEstimates.isError ? (
        <ErrorBand message="Não deu para carregar as estimativas históricas." onRetry={declaredEstimates.refetch} />
      ) : null}

      {/*
        Só com os pagamentos E o cronograma respondidos: sem os pagamentos, todo pagamento
        lançado apareceria como "por volta de" (estimado) e trocaria de rótulo ao chegar.
      */}
      {detalhe && payments.isSuccess && declaredEstimates.isSuccess && !schedule.isLoading &&
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

      {!schedule.isLoading && !schedule.isError && (!detalhe || declaredEstimates.isSuccess) && !proxima ? (
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

  /*
    Link antigo (`?create=financing` do "Aplicar" de um APK anterior, `?id=&edit=1`): o formulário
    agora é o único, e esta tela não fica por baixo — fechar devolve para quem abriu. O link não diz
    se a dívida tem passado: o hospedeiro assume que sim.
  */
  if (params.edit === '1' && fichaId) return <Redirect href={hrefDoLancar('financiamento', { id: fichaId, origem: 'divida' })} />;
  if (params.create === 'financing') {
    const { create: _c, de: _d, ...resto } = params;
    return <Redirect href={hrefDoLancar('financiamento', resto)} />;
  }

  if (fichaId) {
    return (
      <Screen
        grouped
        wide={tablet}
        onRefresh={() => Promise.all([debts.refetch(), schedule.refetch(), payments.refetch(), declaredEstimates.refetch(), accounts.refetch()])}>
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
  explica: {
    gap: Space.sm,
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
});
