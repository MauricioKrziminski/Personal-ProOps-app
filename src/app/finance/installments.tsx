import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AccountPicker } from '@/components/finance/account-picker';
import { CategoryPicker } from '@/components/finance/category-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { useBRL } from '@/components/ui/conceal';
import { Button } from '@/components/ui/button';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { monthLabel, monthShort, shiftMonth } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Screen } from '@/components/ui/screen';
import { Deslizavel } from '@/components/ui/deslizavel';
import { VerMais } from '@/components/ui/ver-mais';
import { useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { BarTrack, ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useDeleteInstallmentPlan,
  useInstallmentPlans,
  useUpdateInstallmentPlan,
  type InstallmentPlanSummary,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { brToISO, isValidBRDate, isoToBR } from '@/lib/dates';
import {
  digitarValor,
  faixaDeParcelas,
  financeErrorMessage,
  parcelaDoTotal,
  totalPorParcela,
  valorExibido,
  type Contrato,
  recusaDoValor,
  UNIDADES_DO_VALOR,
  type UnidadeDoValor,
} from '@/lib/finance-form';
import { Segmented } from '@/components/ui/segmented';
import { QuantityField } from '@/components/ui/quantity-field';
import { estadoDaLinha } from '@/lib/settle-labels';
import { useToast } from '@/components/ui/toast';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';
import { useVoltarQuandoFechar } from '@/hooks/use-voltar-quando-fechar';
import { nextPendingInstallment } from '@/lib/installment-progress';
import { accountLabel } from '@/lib/accounts';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * Parceladas — "o que eu já comprometi nos próximos meses, e quanto falta para acabar?".
 *
 * Leitura pura: não se cria plano por aqui (parcelamento nasce da compra) e não se apaga
 * (apagar o plano faz cascade nas dez linhas do extrato).
 *
 * **A soma das parcelas bate com o total porque o resto da divisão inteira vai na última** —
 * por isso "por mês" é a parcela normal e a última pode ter alguns centavos a mais.
 */

const MESES_COMPROMETIDOS = 12;

/**
 * O formulário de REPARCELAR — a compra inteira, não uma parcela dela.
 *
 * ⚠️ `travadas` é `plano.locked`, **não** `plano.paid`. Elas divergem, e a primeira versão desta
 * tela usou a errada: no staging a compra "Carro Peças" mostrava `paid = 0`, a tela oferecia
 * trocar 3x por 4x e a RPC recusava com "já tem 1 parcela paga" — uma parcela dentro de fatura
 * fechada. Botão habilitado que o servidor rejeita é o espelho do botão desabilitado que não
 * explica: nos dois a pessoa não tem como saber o que fazer. A régua da tela é a MESMA do banco
 * (`private.parcela_travada`).
 */
interface FormPlano {
  id: string;
  description: string;
  merchant: string;
  category: string | null;
  accountId: string | null;
  totalCents: number;
  installments: number;
  /** `dd/mm/aaaa`, como a pessoa digita. */
  inicio: string;
  /** Parcelas que não mudam mais (pagas ou em fatura fechada) e quanto elas somam. */
  travadas: number;
  travadasPagas: number;
  travadoCents: number;
  /**
   * O que o número do Valor é (23/09/2026, *"tinha que ter a opção de colocar o valor de cada
   * parcela"*). O total continua sendo a verdade; a parcela digitada fica à parte para trocar
   * a unidade não mexer em centavo nenhum (`ValorDaCompra`).
   */
  unidade: UnidadeDoValor;
  parcelaCents: number | null;
  /** Como a compra abriu — é o que "cada parcela" mostra antes de qualquer edição. */
  original: { totalCents: number; installments: number; parcelaCents: number; accountId: string | null };
}

function formDoPlano(plano: InstallmentPlanSummary): FormPlano {
  return {
    id: plano.id,
    description: plano.description ?? '',
    merchant: plano.merchant ?? '',
    category: plano.category,
    accountId: plano.account_id,
    totalCents: plano.total_cents,
    installments: plano.installments,
    inicio: isoToBR(plano.first_occurred_at),
    travadas: plano.locked,
    travadasPagas: plano.locked_paid,
    travadoCents: plano.locked_cents,
    unidade: 'total',
    parcelaCents: null,
    original: {
      totalCents: plano.total_cents,
      installments: plano.installments,
      parcelaCents: plano.installment_cents,
      accountId: plano.account_id,
    },
  };
}

function contratoDo(form: FormPlano): Contrato {
  return { parcelas: form.installments, travadas: form.travadas, travadoCents: form.travadoCents };
}

/** "Cada parcela" hoje: a parcela real enquanto nada mudou; com N trocado, a divisão nova. */
function valorDoCampo(form: FormPlano): number {
  const c = contratoDo(form);
  const hoje =
    form.installments === form.original.installments
      ? form.original.parcelaCents
      : parcelaDoTotal(form.totalCents, c);
  return valorExibido(form, form.unidade, c, hoje, form.original.totalCents);
}

/**
 * POR QUE a compra travou, em vez de "já fechadas": parcela paga e fatura paga em parte pedem
 * saídas diferentes (22/09/2026 — a trava da wardogs tinha duas causas possíveis e a dica era a
 * mesma frase para as duas).
 */
function motivoDaTrava(travadas: number, pagas: number, total: number): string {
  const naFatura = travadas - pagas;
  if (naFatura === 0) return `${pagas} de ${total} já ${pagas === 1 ? 'paga' : 'pagas'}`;
  const fatura = `${naFatura} em fatura paga em parte ou adiada`;
  return pagas === 0 ? `${naFatura} de ${total} ${naFatura === 1 ? 'está' : 'estão'} em fatura paga em parte ou adiada` : `${pagas} já ${pagas === 1 ? 'paga' : 'pagas'} e ${fatura}`;
}

const ALTURA_BARRA = 88;
/** Largura fixa de cada mês na faixa rolável. */
const LARGURA_MES = 48;

/** Barra de um mês. Cresce da base com mola — valor que salta é bug visual. */
function Bar({
  ratio,
  index,
  destaque,
  passado,
}: {
  ratio: number;
  index: number;
  destaque: boolean;
  passado: boolean;
}) {
  const theme = useTheme();
  return (
    <BarTrack
      ratio={ratio}
      index={index}
      height={ALTURA_BARRA}
      // Parcela já paga fica mais fraca — mesma convenção da tendência da home: uma cor,
      // duas presenças, sem gastar uma segunda matiz.
      dim={passado}
      color={destaque ? theme.tintFill : theme.backgroundElement}
    />
  );
}

export default function InstallmentsScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const theme = useTheme();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const plans = useInstallmentPlans();
  const removePlan = useDeleteInstallmentPlan();
  const accounts = useAccounts();
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTerminadas, setVerTerminadas] = useState(false);
  const params = useLocalSearchParams<{ edit?: string }>();
  const editar = useUpdateInstallmentPlan();
  const [form, setForm] = useState<FormPlano | null>(null);
  /** Qual `?edit=` já foi consumido — sem isto, fechar o sheet reabriria no render seguinte. */
  const [edicaoAberta, setEdicaoAberta] = useState<string | null>(null);
  const volta = useVoltarQuandoFechar();
  // Congelado na montagem, como em `transactions.tsx`: todas as parcelas da tela são julgadas
  // pelo MESMO "hoje".
  const [hoje] = useState(() => localISODate());

  const contaPorId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const conta of accounts.data ?? []) mapa.set(conta.id, accountLabel(conta));
    return mapa;
  }, [accounts.data]);

  const lista = plans.data ?? [];
  const emAndamento = useMemo(
    () =>
      (plans.data ?? [])
        .filter((p) => p.active)
        .sort((a, b) => b.remaining_cents - a.remaining_cents),
    [plans.data],
  );
  const terminadas = useMemo(() => (plans.data ?? []).filter((p) => !p.active), [plans.data]);
  // Aos poucos (24/09/2026): as terminadas crescem para sempre.
  const janelas = useJanelasPorGrupo('');
  const jAndamento = janelas.janelaDe('andamento', emAndamento);
  const jTerminadas = janelas.janelaDe('terminadas', terminadas);

  /**
   * Parcelas por mês — TODAS, inclusive as já pagas e as de meses passados.
   *
   * Antes este mapa nascia com dois filtros (`status = pending` e `mes >= hoje`), e por isso a
   * faixa não tinha como mostrar passado nenhum: o dado saía antes de chegar no gráfico. O
   * recorte "só o que ainda vai sair" continua existindo, mas em `comprometido`, que é o número
   * que precisa dele.
   */
  const porMes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const plano of plans.data ?? []) {
      for (const parcela of plano.parcels) {
        const mes = parcela.occurred_at.slice(0, 7);
        mapa.set(mes, (mapa.get(mes) ?? 0) + parcela.amount_cents);
      }
    }
    return mapa;
  }, [plans.data]);

  const mesAtual = localISODate().slice(0, 7);

  // A faixa cobre o plano INTEIRO — da primeira parcela à última —, não seis meses para a
  // frente. O caso que originou a auditoria é exatamente este: compra em 8x lançada JÁ na 5ª
  // parcela, com quatro meses de passado que a tela não tinha como mostrar.
  const faixa = useMemo(() => {
    const meses = Array.from(porMes.keys()).sort();
    if (meses.length === 0) return [];
    const fim = meses[meses.length - 1];
    const out: { month: string; cents: number }[] = [];
    // Teto de segurança: `porMes` vem do banco e um `first_occurred_at` absurdo não pode
    // virar laço infinito.
    for (let mes = meses[0]; mes <= fim && out.length < 240; mes = shiftMonth(mes, 1)) {
      out.push({ month: mes, cents: porMes.get(mes) ?? 0 });
    }
    return out;
  }, [porMes]);

  // Abre no mês corrente, não no começo do histórico: a pergunta padrão é "quanto cai daqui
  // para a frente". `contentOffset` não é confiável nas duas plataformas — daí o `scrollTo`.
  const faixaRef = useRef<ScrollView>(null);
  const indexAtual = faixa.findIndex((f) => f.month >= mesAtual);

  /**
   * O que ainda vai SAIR do bolso nos próximos 12 meses.
   *
   * Lê as parcelas direto, e não o `porMes`, porque este número tem dois recortes que a faixa
   * não tem: só parcela `pending` (a já paga não é compromisso) e só do mês corrente para a
   * frente. Junto vem quantos meses da janela têm parcela — é o divisor da média, e contar mês
   * passado ali faria a média encolher sozinha.
   */
  const { comprometido, mesesNaJanela } = useMemo(() => {
    const fim = shiftMonth(mesAtual, MESES_COMPROMETIDOS - 1);
    const meses = new Set<string>();
    let total = 0;
    for (const plano of plans.data ?? []) {
      for (const parcela of plano.parcels) {
        if (parcela.status !== 'pending') continue;
        const mes = parcela.occurred_at.slice(0, 7);
        if (mes < mesAtual || mes > fim) continue;
        total += parcela.amount_cents;
        meses.add(mes);
      }
    }
    return { comprometido: total, mesesNaJanela: meses.size };
  }, [plans.data, mesAtual]);

  const ultimaParcela = useMemo(() => {
    let maior: string | null = null;
    for (const mes of porMes.keys()) if (!maior || mes > maior) maior = mes;
    return maior;
  }, [porMes]);

  const media = mesesNaJanela > 0 ? Math.round(comprometido / mesesNaJanela) : 0;
  const maiorDaFaixa = Math.max(...faixa.map((f) => f.cents), 0);
  // "Mês mais pesado" só ganha o accent quando existe UM. Com parcelas iguais — o caso comum,
  // porque parcela é o total dividido igual — três meses empatavam no máximo e os três saíam em
  // `tint`: três retângulos pretos colados viram um bloco, que era o achado cosmético parado
  // desde a Fase 1. Empate agora não destaca ninguém; o valor continua escrito embaixo.
  const maiorEhUnico = faixa.filter((f) => f.cents === maiorDaFaixa).length === 1;
  const temFaixa = maiorDaFaixa > 0;

  /** O menu da compra, UMA lista para o toque longo e o arrasto. */
  const acoesDaCompra = (plano: InstallmentPlanSummary): ItemAction[] => {
    const ordenadas = [...plano.parcels].sort((a, b) => (a.installment_no ?? 0) - (b.installment_no ?? 0));
    const primeira = ordenadas[0];
    return [
      {
        /**
         * ⚠️ **"Editar" aqui edita a COMPRA, não uma parcela** (15/09/2026).
         *
         * Até agora este item abria o formulário do LANÇAMENTO ancorado na primeira parcela em
         * aberto, e por isso quem queria corrigir a compra caía num campo "Valor" que mostrava
         * R$ 52,49 quando a compra foi de R$ 104,99. A queixa foi literal: *"eu queria colocar
         * o valor total de novo e parcelado em 2x mas ele veio com o valor 52,49 preenchido e
         * nao consigo mudar a parcela"*. Total e número de parcelas são do CONTRATO e agora
         * moram no sheet abaixo; corrigir uma parcela sozinha continua existindo, por
         * "Ver parcelas" → tocar na parcela → Editar, que é onde essa pergunta faz sentido.
         */
        label: 'Editar a compra',
        curto: 'Editar',
        icon: 'pencil' as const,
        arrasto: 'direita',
        onPress: () => setForm(formDoPlano(plano)),
      },
      {
        label: aberto === plano.id ? 'Esconder parcelas' : 'Ver parcelas',
        onPress: () => setAberto(aberto === plano.id ? null : plano.id),
      },
      ...(primeira
        ? [
            {
              label: 'Ver a primeira compra',
              onPress: () =>
                router.push({
                  pathname: '/finance/[txId]',
                  params: { txId: primeira.id, month: primeira.occurred_at.slice(0, 7) },
                }),
            },
          ]
        : []),
      ...(plano.account_id
        ? [{ label: 'Ver o cartão', onPress: () => router.push('/finance/cards') }]
        : []),
      {
        label: 'Apagar a compra inteira',
        curto: 'Apagar',
        icon: 'trash' as const,
        destructive: true,
        arrasto: 'esquerda',
        onPress: () => apagarPlano(plano),
      },
    ];
  };
  const acoes = (plano: InstallmentPlanSummary) => showItemActions(plano.title, acoesDaCompra(plano));

  /**
   * Apagar o plano some com TODAS as parcelas (cascade em `installment_plan_id`).
   *
   * Esta tela documentava a ausência como decisão — "não se apaga, porque apagar
   * o plano faz cascade nas dez linhas do extrato". A decisão mudou: o cascade é
   * exatamente o que se quer quando a compra foi cancelada ou lançada errada, e a
   * alternativa era apagar dez lançamentos um por um, navegando dez meses.
   *
   * Sem "Desfazer" (o cascade não volta), então a confirmação nomeia o estrago.
   */
  const apagarPlano = (plano: InstallmentPlanSummary) => {
    confirmDestructive(
      'Apagar a compra parcelada inteira?',
      'Apagar tudo',
      () =>
        removePlan.mutate(plano.id, {
          onSuccess: () => toast({ message: <>Apaguei <Forte>{plano.title}</Forte> e as parcelas.</>, tone: 'success' }),
          onError: () =>
            toast({ message: 'Não deu para apagar a compra. Tenta de novo.', tone: 'error' }),
        }),
      `Some as ${plano.installments} parcelas de ${plano.title}, ${formatBRL(plano.total_cents)} no total — de todos os meses. Isso não volta.`,
    );
  };

  /**
   * Abrir o editor vindo de outra tela (`/finance/installments?edit=<plano>`).
   *
   * Ajuste de estado NO RENDER, não em efeito: o plano chega DEPOIS do primeiro render (a query
   * ainda carregava), então nenhum inicializador de `useState` o alcança — e `setState` dentro
   * de `useEffect` é o que o React Compiler recusa. Mesmo padrão (e mesmo motivo) do `?edit=`
   * da tela de recorrentes.
   */
  if (params.edit && params.edit !== edicaoAberta && form === null) {
    const alvo = lista.find((p) => p.id === params.edit);
    if (alvo) {
      setEdicaoAberta(params.edit);
      setForm(formDoPlano(alvo));
      // Quem chegou por `?edit=` veio de outra tela, e é para lá que fechar devolve.
      volta.marcar();
    }
  }

  // Com parcela paga, o que resta editar é o dinheiro em aberto e o nome — a regra do nicho
  // (o OnBalance trava o número de parcelas depois do primeiro pagamento). Quem RECUSA é a
  // RPC; aqui a tela só evita oferecer o que vai voltar como erro.
  const travado = (form?.travadas ?? 0) > 0;
  const tituloOk = (form?.description.trim().length ?? 0) > 0;
  const emAberto = form ? Math.max(0, form.installments - form.travadas) : 0;
  const restante = form ? form.totalCents - form.travadoCents : 0;
  const totalOk = Boolean(
    form && form.totalCents >= form.installments && (!travado || restante >= emAberto),
  );
  // Conta obrigatória: sem ela o `set_invoice` apaga o `invoice_id` das N parcelas e a compra
  // de cartão vira despesa solta. O banco recusa; a tela evita chegar lá.
  // A compra que NASCEU sem conta continua editável sem uma (o banco já aceita): exigir a conta
  // ali travava o Salvar para quem não tem conta nenhuma cadastrada.
  const contaOk = Boolean(form?.accountId || !form?.original.accountId);
  const podeSalvar = Boolean(form && tituloOk && totalOk && contaOk && isValidBRDate(form.inicio));
  // ⚠️ `faixaDeParcelas` é a régua (`finance-form.ts`): sem "À vista" com parcela travada,
  // porque a RPC recusaria.
  const faixaParcelas = faixaDeParcelas(form?.travadas ?? 0);

  const salvarPlano = () => {
    if (!form || !podeSalvar) return;
    const nome = form.description.trim();
    const payload = () => ({
      planId: form.id,
      totalCents: form.totalCents,
      installments: form.installments,
      firstOccurredAt: brToISO(form.inicio),
      description: nome,
      merchant: form.merchant.trim() || null,
      category: form.category,
      accountId: form.accountId,
    });
    const acoes = {
      onSuccess: () => {
        volta.aoFechar(() => setForm(null));
        toast({
          message:
            form.installments === 1
              ? `Desfiz o parcelamento: sobrou um lançamento de ${formatBRL(form.totalCents)}.`
              : `${nome}: ${form.installments}x de ${formatBRL(Math.floor(form.totalCents / form.installments))}.`,
          tone: 'success',
        });
      },
      // A RPC recusa com a frase pronta (P0001) — "não deu para salvar" esconderia
      // justamente o motivo, que é o que a pessoa precisa para decidir o que fazer.
      onError: (error: unknown) =>
        toast({
          message: financeErrorMessage(error, 'Não deu para editar a compra. Tenta de novo.'),
          tone: 'error',
        }),
    };

    /**
     * ⚠️ **Desfazer o parcelamento APAGA as outras parcelas**, e o cascade não volta. A régua é
     * a de `design.md §6`: confirmação destrutiva NOMEIA o estrago. A parcela 1 sobrevive com o
     * total — é a mesma linha, com o mesmo `id`.
     */
    if (form.installments === 1) {
      const original = lista.find((p) => p.id === form.id)?.installments ?? 0;
      const somem = Math.max(original - 1, 0);
      confirmDestructive(
        'Desfazer o parcelamento?',
        'Desfazer',
        () => editar.mutate(payload(), acoes),
        somem === 1
          ? `A outra parcela some e sobra um lançamento de ${formatBRL(form.totalCents)} em ${form.inicio}. Isso não volta.`
          : `As outras ${somem} parcelas somem e sobra um lançamento de ${formatBRL(form.totalCents)} em ${form.inicio}. Isso não volta.`,
      );
      return;
    }
    editar.mutate(payload(), acoes);
  };

  const bloco = (plano: InstallmentPlanSummary, index: number) => {
    const conta = plano.account_id ? contaPorId.get(plano.account_id) : null;
    const expandido = aberto === plano.id;
    const parcelas = [...plano.parcels].sort(
      (a, b) => (a.installment_no ?? 0) - (b.installment_no ?? 0),
    );
    const atual = nextPendingInstallment(parcelas, plano.installments);
    /**
     * As parcelas em duas metades (24/09/2026), como a linha do tempo da dívida: o que falta a
     * partir da próxima, e o que já foi pago do mais recente para o mais antigo — aos poucos.
     */
    const aSeguir = parcelas.filter((p) => p.status !== 'cleared');
    const pagas = parcelas.filter((p) => p.status === 'cleared').reverse();
    const jSeguir = janelas.janelaDe(`${plano.id}:seguir`, aSeguir);
    const jPagas = janelas.janelaDe(`${plano.id}:pagas`, pagas);
    const linhaDaParcela = (parcela: (typeof parcelas)[number]) => {
              /*
                A parcela de cartão fica `pending` até a fatura ser paga: chamar de "prevista" a
                parcela do mês passado é a mesma mentira que a lista de Lançamentos contava.

                ⚠️ `InstallmentParcel` não tem `due_at`, e o tipo de `estadoDaLinha` o exige desde
                a Tarefa 2 — escrito assim de propósito: parcela de compra é sempre despesa. A
                consequência é real: uma parcela sem cartão e com data passada agora lê
                "atrasada", onde antes lia "prevista". É o certo — ninguém a pagou.
              */
              const estado = estadoDaLinha({ ...parcela, kind: 'expense', due_at: null }, hoje);
              const rotulo =
                parcela.status === 'cleared' ? 'paga'
                : estado === 'atrasado' ? 'atrasada'
                : estado === 'previsto' ? 'prevista'
                : 'na fatura';
              return (
                <Pressable
                  key={parcela.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Parcela ${parcela.installment_no ?? ''} de ${plano.installments}, ${formatBRL(parcela.amount_cents)}, ${rotulo}, ${formatDateBR(parcela.occurred_at)}`}
                  onPress={() =>
                    router.push({
                      pathname: '/finance/[txId]',
                      params: { txId: parcela.id, month: parcela.occurred_at.slice(0, 7) },
                    })
                  }>
                  {({ pressed }) => (
                    <View
                      style={[
                        styles.parcela,
                        { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
                      ]}>
                      <ThemedText type="small" style={tabular}>
                        {parcela.installment_no ?? '—'}/{plano.installments} ·{' '}
                        {formatDateBR(parcela.occurred_at)}
                      </ThemedText>
                      <View style={styles.parcelaValor}>
                        <ThemedText
                          type="small"
                          themeColor={parcela.status === 'cleared' ? 'success' : 'textSecondary'}>
                          {rotulo}
                        </ThemedText>
                        <Money cents={parcela.amount_cents} variant="subhead" />
                      </View>
                    </View>
                  )}
                </Pressable>
              );
    };
    const resumo = plano.active
      ? `${atual} de ${plano.installments} · ${brl(plano.installment_cents)}/mês`
      : `${plano.installments} de ${plano.installments} · quitada`;

    return (
      <Animated.View
        key={plano.id}
        layout={transicaoDeLayout}
        entering={FadeInDown.duration(Motion.duration.base).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap),
        )}>
        <Deslizavel titulo={plano.title} acoes={acoesDaCompra(plano)}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: expandido }}
          accessibilityLabel={`${plano.title}, parcela ${atual} de ${plano.installments}, ${formatBRL(plano.installment_cents)} por mês${plano.active ? `, faltam ${formatBRL(plano.remaining_cents)}` : ', quitada'}`}
          onPress={() => setAberto(expandido ? null : plano.id)}
          onLongPress={() => acoes(plano)}>
          {({ pressed }) => (
            <View
              style={[
                styles.plano,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <View style={styles.planoTopo}>
                <ThemedText type="default" style={styles.planoNome}>
                  {plano.title}
                </ThemedText>
                <View style={styles.planoValor}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {plano.active ? 'falta' : 'total'}
                  </ThemedText>
                  <Money
                    cents={plano.active ? plano.remaining_cents : plano.total_cents}
                    variant="ticker"
                  />
                </View>
              </View>
              <ProgressBar
                value={plano.paid}
                max={plano.installments}
                tone={plano.active ? 'tint' : 'success'}
              />
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {/* O nome do cartão não parte ao meio ("Nubank / Cartão"): espaço inseparável dentro dele. */}
                {[resumo, conta?.replace(/ /g, '\u00A0'), plano.category].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
          )}
        </Pressable>
        </Deslizavel>

        {expandido ? (
          <Animated.View
            layout={transicaoDeLayout}
            entering={FadeInDown.duration(Motion.duration.base)}
            style={styles.parcelas}>
            {aSeguir.length > 0 ? (
              <ThemedText type="meta" themeColor="textSecondary" style={styles.subtituloParcelas}>
                A seguir
              </ThemedText>
            ) : null}
            {jSeguir.visiveis.map(linhaDaParcela)}
            <VerMais restantes={jSeguir.restantes} onPress={() => janelas.verMais(`${plano.id}:seguir`)} />
            {pagas.length > 0 ? (
              <ThemedText type="meta" themeColor="textSecondary" style={styles.subtituloParcelas}>
                Pagas
              </ThemedText>
            ) : null}
            {jPagas.visiveis.map(linhaDaParcela)}
            <VerMais restantes={jPagas.restantes} onPress={() => janelas.verMais(`${plano.id}:pagas`)} />
          </Animated.View>
        ) : null}
      </Animated.View>
    );
  };

  const loading = plans.isLoading ? (
    <>
      <Skeleton height={132} radius={Radius.lg} />
      <Skeleton height={ALTURA_BARRA + Space.xxl} radius={Radius.md} />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;

  const erro = plans.isError ? (
    <Section title="Parceladas">
      <Row
        title="Não deu para carregar suas compras parceladas"
        subtitle="Toque para tentar de novo"
        icon="exclamationmark.triangle"
        onPress={() => plans.refetch()}
      />
    </Section>
  ) : null;

  const destaque = !plans.isError && lista.length > 0 ? (
    <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
      <Card style={styles.hero}>
        <HeroLabel>Comprometido nos próximos 12 meses</HeroLabel>
        <Money cents={comprometido} variant="money" />
        <ThemedText type="small" themeColor="textSecondary" style={tabular}>
          {comprometido > 0
            ? `${brl(media)}/mês${ultimaParcela ? ` · até ${monthShort(ultimaParcela, true)}` : ''}`
            : 'Nada parcelado em aberto.'}
        </ThemedText>
      </Card>
    </Animated.View>
  ) : null;

  const faixaMensal = temFaixa ? (
    <Card style={styles.faixa}>
      <ThemedText type="smallBold">Quanto cai por mês</ThemedText>
      <ScrollView keyboardShouldPersistTaps="handled"
        ref={faixaRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={() =>
          faixaRef.current?.scrollTo({
            x: Math.max(0, (indexAtual - 1) * (LARGURA_MES + Space.sm)),
            animated: false,
          })
        }
        contentContainerStyle={styles.bars}>
        {faixa.map((mes, index) => (
          <Pressable
            key={mes.month}
            accessibilityRole="button"
            accessibilityLabel={`${monthLabel(mes.month)}, ${formatBRL(mes.cents)} em parcelas${mes.month < mesAtual ? ', já passou' : ''}`}
            style={styles.barSlot}
            onPress={() =>
              router.push({ pathname: '/finance/transactions', params: { month: mes.month } })
            }>
            <View style={styles.barTrack}>
              <Bar
                ratio={maiorDaFaixa > 0 ? mes.cents / maiorDaFaixa : 0}
                index={index}
                destaque={maiorEhUnico && mes.cents === maiorDaFaixa && mes.cents > 0}
                passado={mes.month < mesAtual}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {monthShort(mes.month)}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <ThemedText type="small" themeColor="textSecondary" style={tabular}>
        {`Mês mais pesado: ${brl(maiorDaFaixa)}`}
      </ThemedText>
    </Card>
  ) : null;

  const listaParcelas = (
    <>
      {emAndamento.length > 0 ? (
        <View style={styles.lista}>
          <Section title="Em andamento">{jAndamento.visiveis.map(bloco)}</Section>
          <VerMais restantes={jAndamento.restantes} onPress={() => janelas.verMais('andamento')} />
        </View>
      ) : null}
      {terminadas.length > 0 ? (
        <Section title="Terminadas">
          <Row
            title={verTerminadas ? 'Esconder terminadas' : `Ver ${terminadas.length} terminadas`}
            icon={verTerminadas ? 'chevron.up' : 'checkmark.circle'}
            chevron={false}
            onPress={() => setVerTerminadas(!verTerminadas)}
          />
          {verTerminadas ? jTerminadas.visiveis.map(bloco) : null}
        </Section>
      ) : null}
      {terminadas.length > 0 && verTerminadas ? (
        <VerMais restantes={jTerminadas.restantes} onPress={() => janelas.verMais('terminadas')} />
      ) : null}
      {/* Só terminadas: elas vêm primeiro e o vazio vira uma linha embaixo (24/09/2026). */}
      {!plans.isLoading && !plans.isError && lista.length > 0 && emAndamento.length === 0 ? (
        <EmptyState icon="creditcard" title="Nenhuma compra em andamento" compacto />
      ) : null}
      {!plans.isLoading && !plans.isError && lista.length === 0 ? (
        <EmptyState
          icon="creditcard"
          title="Nenhuma compra parcelada"
          hint={'Quando você lançar uma compra em 10x,\nela aparece aqui com quanto falta.'}
        />
      ) : null}
    </>
  );

  const parcelList = <View style={styles.paneBody}>{loading}{erro}{listaParcelas}</View>;
  const parcelContext = <View style={styles.paneBody}>{destaque}{faixaMensal}</View>;
  const compactBody = <>{loading}{erro}{destaque}{faixaMensal}{listaParcelas}</>;
  const tabletBody = (
    <AdaptivePanes
      main={parcelList}
      support={destaque || faixaMensal ? parcelContext : undefined}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="installments-tablet-workspace"
    />
  );

  return (
    <Screen grouped wide={tablet} onRefresh={() => Promise.all([plans.refetch(), accounts.refetch()])}>
      {/* Sem headerRight de propósito: parcelamento nasce da compra, não desta tela. */}
      <Stack.Screen options={{ title: 'Parceladas' }} />

      {tablet ? tabletBody : compactBody}

      {/*
        **Reparcelar.** A ordem é a do formulário de EVENTO (`frontend.md`): o campo que NOMEIA
        vem primeiro, depois o dinheiro, depois como ele se divide, depois quando. O que está
        travado continua VISÍVEL — sumir com a conta e a data esconderia o dado de quem só
        queria conferir.
      */}
      <Sheet visible={form !== null} onClose={() => volta.aoFechar(() => setForm(null))}>
        <TaskHeader
          title="Editar a compra"
          onClose={() => volta.aoFechar(() => setForm(null))}
          action={
            <Button
              label="Salvar"
              size="sm"
              loading={editar.isPending}
              disabled={!podeSalvar || editar.isPending}
              onPress={salvarPlano}
            />
          }
        />
        {form ? (
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Field
              label="Título"
              error={tituloOk ? undefined : 'Escreva um título para esta compra'}>
              <TextField
                value={form.description}
                onChangeText={(description) => setForm({ ...form, description })}
                placeholder="Ex.: Fone de ouvido"
                accessibilityLabel="Título da compra"
                invalid={!tituloOk}
              />
            </Field>

            <Field label="Estabelecimento">
              <TextField
                value={form.merchant}
                onChangeText={(merchant) => setForm({ ...form, merchant })}
                placeholder="Ex.: Padaria do Zé"
                accessibilityLabel="Estabelecimento"
              />
            </Field>

            <Field
              label="Valor"
              error={totalOk ? undefined : recusaDoValor(form.travadas)}
              hint={
                form.unidade === 'parcela'
                  ? `${travado ? `Vale para as ${emAberto} em aberto` : `${form.installments}x`} · total ${formatBRL(form.totalCents)}`
                  : travado
                    ? `${formatBRL(form.travadoCents)} já fechado`
                    : undefined
              }>
              {/* Sempre na tela: sumir no "À vista" subiria o formulário embaixo do "−". */}
              <Segmented
                options={UNIDADES_DO_VALOR}
                value={form.unidade}
                onChange={(unidade) => setForm({ ...form, unidade })}
              />
              <MoneyField
                valueCents={valorDoCampo(form)}
                onChangeCents={(v) =>
                  setForm({ ...form, ...digitarValor(v, form.unidade, contratoDo(form)) })
                }
                invalid={!totalOk}
                accessibilityLabel={
                  form.unidade === 'parcela' ? 'Valor de cada parcela' : 'Valor total da compra'
                }
              />
            </Field>

            <Field label="Categoria">
              <CategoryPicker
                value={form.category}
                onChange={(category) => setForm({ ...form, category })}
              />
            </Field>

            <Field label="Conta" error={contaOk ? undefined : 'Escolha a conta desta compra'}>
              {travado ? (
                <TextField
                  editable={false}
                  value={(form.accountId ? contaPorId.get(form.accountId) : null) ?? 'Sem conta'}
                  accessibilityLabel="Conta da compra"
                />
              ) : (
                <AccountPicker
                  accounts={accounts.data ?? []}
                  value={form.accountId}
                  onChange={(accountId: string | null) => setForm({ ...form, accountId })}
                  placeholder="Escolher a conta da compra"
                />
              )}
            </Field>

            <Field
              label="Parcelas"
              hint={
                travado
                  ? `${motivoDaTrava(form.travadas, form.travadasPagas, form.installments)} — número, data e conta não mudam.`
                  : form.installments === 1
                    ? undefined
                    : `${form.installments}x de ${formatBRL(Math.floor(form.totalCents / form.installments))}`
              }>
              {travado ? (
                <TextField
                  editable={false}
                  value={`${form.installments}x`}
                  accessibilityLabel="Número de parcelas"
                />
              ) : (
                <QuantityField
                  value={form.installments}
                  min={faixaParcelas.min}
                  max={faixaParcelas.max}
                  accessibilityLabel="Número de parcelas"
                  onChange={(n) =>
                    setForm({
                      ...form,
                      installments: n,
                      // Quem digitou "cada parcela" continua com aquela parcela: o total segue o N.
                      totalCents:
                        form.parcelaCents !== null
                          ? totalPorParcela(form.parcelaCents, { ...contratoDo(form), parcelas: n })
                          : form.totalCents,
                    })
                  }
                />
              )}
            </Field>

            <Field label="Data da primeira parcela">
              {travado ? (
                <TextField
                  editable={false}
                  value={form.inicio}
                  accessibilityLabel="Data da primeira parcela"
                />
              ) : (
                <DatePickerField
                  value={form.inicio}
                  onChange={(inicio) => setForm({ ...form, inicio })}
                  accessibilityLabel="Data da primeira parcela"
                  invalid={!isValidBRDate(form.inicio)}
                />
              )}
            </Field>
          </ScrollView>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lista: { gap: Space.md },
  // Alinhado ao texto das parcelas (o mesmo recuo de `parcela`).
  // "A seguir"/"Pagas" a `Space.md` do texto da primeira parcela (a linha já traz `sm` em cima) e
  // mais longe do grupo de cima que do próprio (§2, 25/09/2026).
  subtituloParcelas: { paddingTop: Space.md, paddingBottom: Space.xs, paddingHorizontal: Space.xl },
  paneBody: {
    gap: Space.xl,
    minWidth: 0,
  },
  hero: {
    gap: Space.sm,
  },
  faixa: {
    gap: Space.md,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.sm,
  },
  barSlot: {
    width: LARGURA_MES,
    alignItems: 'center',
    gap: Space.xs,
  },
  barTrack: {
    width: '100%',
    height: ALTURA_BARRA,
    justifyContent: 'flex-end',
  },
  plano: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  planoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  planoNome: {
    flex: 1,
  },
  planoValor: {
    alignItems: 'flex-end',
  },
  parcelas: {
    paddingBottom: Space.sm,
  },
  parcela: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.sm,
  },
  parcelaValor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
});
