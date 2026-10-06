import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack } from 'expo-router';

import { SecaoDeArquivados } from '@/components/ui/secao-de-arquivados';
import { useBRL, useConceal } from '@/components/ui/conceal';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { AccountPicker } from '@/components/finance/account-picker';
import { SelectField } from '@/components/ui/select-field';
import { GoalPlanningSummary, GoalPlanSheet, useGoalPlanEditor } from '@/components/finance/goal-planning';
import { GoalContributionCaption } from '@/components/finance/goal-contribution-fields';
import { useMonthRuler } from '@/components/finance/month-ruler';
import { AnelDaMeta, AparenciaDaMeta, MarcosDaMeta, type Travessia, type UnidadeDoMarco } from '@/components/finance/goal-identity';
import type { NoteColorName } from '@/constants/theme';
import { useGoalMilestones } from '@/hooks/use-goal-milestones';
import {
  centavosDaLinha, linhasDosMarcos, recusaDosMarcos, sugestaoDeMarcos, textoDoProximoMarco, type LinhaDeMarco,
} from '@/lib/goal-milestones';
import { useGoalHorizonPlanning } from '@/hooks/use-goal-horizon';
import { useGoalLinkCandidates, useGoalMoneyCommand, useGoalMoneyState } from '@/hooks/use-goal-money';
import {
  efeitoDaMovimentacao, entradaDaMovimentacao, mensagemDaMovimentacao, naturezaDaMovimentacao, validarMovimentacao,
  type GoalMoneyDraft, type GoalMoneyMovement,
} from '@/lib/goal-money';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Deslizavel, fecharDeslizavelAberto } from '@/components/ui/deslizavel';
import { PressableScale } from '@/components/motion/pressable-scale';
import { VerMais } from '@/components/ui/ver-mais';
import { useAosPoucos, useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useArquivados,
  useArchiveGoal,
  useEditGoalContribution,
  useGoalContributions,
  useAccounts,
  useGoalDeposit,
  useGoals,
  useSaveGoal,
  type Goal,
  type GoalContribution,
} from '@/hooks/use-finance';
import { Segmented } from '@/components/ui/segmented';
import { SwitchRow } from '@/components/ui/switch-row';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate, mesCurto } from '@/lib/dates';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { financeErrorMessage } from '@/lib/finance-form';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * Metas — "quanto falta, e em quanto tempo eu chego?".
 *
 * A segunda metade da pergunta é a que faltava: `deadline` existe no schema desde sempre e não
 * tinha input nenhum, então a tela mostrava um percentual e parava por aí.
 *
 * Regras do domínio que a tela respeita:
 * - `saved_cents` é **derivado** da soma de `goal_contributions`. Aporte só pela RPC
 *   `goal_deposit` — nunca `+=` no cliente (dois aparelhos lançando junto perdiam aporte).
 * - **Aporte não vira `transactions`**: é dinheiro mudando de lugar, não gasto. Lançar como
 *   despesa inflaria o mês e faria orçamento e projeção mentirem. A tela diz isso em uma linha.
 * - Valor **negativo é retirada** e o banco já aceita (`check (amount_cents <> 0)`); a UI é a peça
 *   que faltava, e sem ela o jeito de corrigir um aporte era apagar a meta inteira.
 */

interface FormState {
  id?: string;
  name: string;
  targetCents: number;
  /** dd/mm/aaaa; vazio = sem prazo. */
  deadline: string;
  icon: string | null;
  color: NoteColorName | null;
  /** F19: marcos do formulário (centavos, ou % que recalcula com o alvo). */
  marcos: LinhaDeMarco[];
  unidadeDoMarco: UnidadeDoMarco;
  /** Os marcos já tinham chegado QUANDO o formulário abriu. Sem isso ele não os mostra nem os envia. */
  marcosCarregados: boolean;
}

const formVazio = (): FormState => ({
  name: '', targetCents: 0, deadline: '', icon: null, color: null, marcos: sugestaoDeMarcos(), unidadeDoMarco: 'pct', marcosCarregados: true,
});

/** `2026-12-31` → `dezembro de 2026`. */
/** `2027-09-30` → `set/2027`: curto para a linha do card caber inteira a 384dp × fonte 1,3. */
function mesDoPrazo(deadlineISO: string): string {
  return `${mesCurto(deadlineISO)}/${deadlineISO.slice(0, 4)}`;
}

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

export default function GoalsScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { concealed } = useConceal();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const goals = useGoals();
  const planRuler = useMonthRuler('metas', 'civil');
  const planning = useGoalHorizonPlanning(365, planRuler.view, 'month');
  const planEditor = useGoalPlanEditor(365, planRuler.view);
  const save = useSaveGoal();
  const deposit = useGoalDeposit();
  const movimento = useGoalMoneyCommand();
  const contas = (useAccounts().data ?? []).filter((a) => a.type !== 'credit_card');
  const editarAporte = useEditGoalContribution();
  const archive = useArchiveGoal();

  const [form, setForm] = useState<FormState | null>(null);
  const [aporteSelecionado, setAporte] = useState<Goal | null>(null);
  const [aporteCents, setAporteCents] = useState(0);
  const [aporteNota, setAporteNota] = useState('');
  /** Quando (26/09/2026): era sempre hoje. */
  const [aporteData, setAporteData] = useState(() => isoToBR(localISODate()));
  /**
   * F11: ONDE está o dinheiro. `via` troca de significado com a direção (guardar: já está na conta |
   * transferir; retirar: liberar | transferir de volta); `conta` é onde fica separado (o DESTINO ao
   * guardar por transferência, a ORIGEM ao retirar) e `outra` a outra ponta da transferência.
   */
  const [aporteDirecao, setAporteDirecao] = useState<'guardar' | 'retirar'>('guardar');
  const [aporteVia, setAporteVia] = useState<'conta' | 'transferir'>('conta');
  const [aporteConta, setAporteConta] = useState<string | null>(null);
  const [aporteOutra, setAporteOutra] = useState<string | null>(null);
  const [aporteVincular, setAporteVincular] = useState<string | null>(null);
  /**
   * O aporte do extrato em edição (26/09/2026, "tudo que se cria se edita"): era só "Desfazer",
   * que lançava um estorno ao lado. A edição abre DENTRO da folha do extrato — uma folha sobre a
   * outra é janela dentro de janela no Android.
   */
  const [aporteEmEdicao, setAporteEmEdicao] = useState<{
    id: string; tipo: 'guardou' | 'retirou'; cents: number; nota: string; data: string;
  } | null>(null);
  const [extratoSelecionado, setExtrato] = useState<Goal | null>(null);
  const [concluidasAbertas, setConcluidasAbertas] = useState(false);
  /** F19: o último aporte/alocação CONFIRMADO — o único gatilho de celebração de marco. */
  const [travessia, setTravessia] = useState<Travessia | null>(null);
  const marcosQuery = useGoalMilestones();
  const marcosPorMeta = marcosQuery.isError ? undefined : marcosQuery.data;
  const marcosDe = (id: string): number[] | undefined => (marcosPorMeta ? marcosPorMeta[id] ?? [] : undefined);

  const aporte = goals.isError ? null : (goals.data?.find((goal) => goal.id === aporteSelecionado?.id) ?? null);
  const extrato = goals.isError ? null : (goals.data?.find((goal) => goal.id === extratoSelecionado?.id) ?? null);

  // Lazy de propósito: com 8 metas na tela isso é a diferença entre 1 e 9 requisições.
  const contribuicoes = useGoalContributions(extrato?.id);
  // Estado do dinheiro da meta aberta (folha ou extrato). Até 100 movimentações para dar natureza
  // às linhas do extrato; aporte mais antigo aparece como aporte comum.
  const dinheiroId = aporte?.id ?? extrato?.id;
  const dinheiro = useGoalMoneyState(dinheiroId, 100);
  const estadoDoDinheiro = dinheiro.data?.goal_id === dinheiroId ? dinheiro.data : undefined;
  const candidatas = useGoalLinkCandidates(aporte?.id, aporte !== null && aporteDirecao === 'guardar' && aporteVia === 'transferir');

  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const lista = goals.isError ? [] : (goals.data ?? []);
  // Com meta arquivada, o vazio deixa de ser a única coisa da tela e vira linha compacta.
  const temArquivada = (useArquivados('goals').data ?? []).length > 0;
  const abertas = lista.filter((g) => Number(g.saved_cents) < Number(g.target_cents));
  const concluidas = lista.filter((g) => Number(g.saved_cents) >= Number(g.target_cents));
  // Aos poucos, como toda lista do app (24/09/2026).
  const janelas = useJanelasPorGrupo('');
  const jAbertas = janelas.janelaDe('abertas', abertas);
  const jConcluidas = janelas.janelaDe('concluidas', concluidas);
  const guardado = lista.reduce((s, g) => s + Number(g.saved_cents), 0);
  const alvo = lista.reduce((s, g) => s + Number(g.target_cents), 0);

  const abrirNova = () => setForm(formVazio());
  const abrirEdicao = (g: Goal) =>
    setForm({
      id: g.id,
      name: g.name,
      targetCents: Number(g.target_cents),
      deadline: g.deadline ? isoToBR(g.deadline) : '',
      icon: g.icon,
      color: g.color as NoteColorName | null,
      marcos: linhasDosMarcos(marcosDe(g.id) ?? []),
      unidadeDoMarco: 'valor',
      marcosCarregados: marcosDe(g.id) !== undefined,
    });

  const abrirAporte = (g: Goal) => {
    setAporteDirecao('guardar');
    setAporteVia('conta');
    setAporteConta(null);
    setAporteOutra(null);
    setAporteVincular(null);
    setAporteCents(0);
    setAporteNota('');
    setAporteData(isoToBR(localISODate()));
    setAporte(g);
  };

  const abrirEdicaoDoAporte = (c: GoalContribution) =>
    setAporteEmEdicao({
      id: c.id,
      tipo: Number(c.amount_cents) < 0 ? 'retirou' : 'guardou',
      cents: Math.abs(Number(c.amount_cents)),
      nota: c.note ?? '',
      data: isoToBR(c.occurred_at),
    });

  const salvarAporte = () => {
    const e = aporteEmEdicao;
    if (!e || e.cents <= 0 || !isValidBRDate(e.data)) return;
    editarAporte.mutate(
      { id: e.id, amountCents: e.tipo === 'retirou' ? -e.cents : e.cents, occurredAt: brToISO(e.data), note: e.nota.trim() || null },
      {
        onSuccess: () => {
          toast({ message: 'Aporte corrigido.', tone: 'success' });
          setAporteEmEdicao(null);
        },
        // o banco diz o motivo (retirar mais que o guardado); a folha fica aberta com o valor
        onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para corrigir o aporte.'), tone: 'error' }),
      },
    );
  };

  const prazoOk = form ? form.deadline === '' || isValidBRDate(form.deadline) : false;
  // Editando com os marcos ainda sem chegar NA ABERTURA, o formulário não os mostra NEM os envia:
  // mandar a lista vazia apagaria os que existem (e a consulta chegar depois não muda a lista
  // que a pessoa já está editando).
  const marcosProntos = form?.marcosCarregados ?? false;
  const centsDosMarcos = form ? form.marcos.map((l) => centavosDaLinha(l, form.targetCents)).filter((c) => c > 0) : [];
  const recusaDosMarcosMsg = form && marcosProntos
    ? recusaDosMarcos(
        centsDosMarcos.filter((c) => !(form.id ? marcosDe(form.id) ?? [] : []).includes(c)),
        centsDosMarcos,
        form.targetCents,
      )
    : null;
  const podeSalvar = Boolean(form && form.name.trim().length >= 2 && form.targetCents > 0 && prazoOk && !recusaDosMarcosMsg);

  const salvar = () => {
    if (!form || !podeSalvar) return;
    save.mutate(
      {
        id: form.id,
        name: form.name.trim(),
        target_cents: form.targetCents,
        deadline: form.deadline ? brToISO(form.deadline) : null,
        icon: form.icon,
        color: form.color,
        marcos: marcosProntos ? centsDosMarcos : undefined,
      },
      {
        onSuccess: () => {
          toast({ message: form.id ? 'Meta atualizada.' : 'Meta criada.', tone: 'success' });
          setForm(null);
        },
        // o unique é (workspace_id, name): o motivo quase sempre é nome repetido
        onError: () =>
          toast({ message: 'Não deu para salvar. Já existe uma meta com esse nome?', tone: 'error' }),
      }
    );
  };

  const hoje = localISODate();
  const rascunho: GoalMoneyDraft = {
    direcao: aporteDirecao, via: aporteVia, contaId: aporteConta, outraContaId: aporteOutra, vincularId: aporteVincular,
    cents: aporteCents, data: isValidBRDate(aporteData) ? brToISO(aporteData) : '', nota: aporteNota,
  };
  // Retirar mais do que está guardado (ou separado na conta) o banco recusa; aqui o botão desliga antes.
  const validacao = aporte
    ? validarMovimentacao(rascunho, estadoDoDinheiro, Number(aporte.saved_cents), hoje, brl)
    : { pronto: false, motivo: null };
  const efeito = aporte ? efeitoDaMovimentacao(estadoDoDinheiro, rascunho, hoje) : [];
  const ficaNegativa = efeito.find((l) => l.rotulo === 'Saldo' && l.depois < 0);
  const vinculada = aporteVia === 'transferir' && aporteDirecao === 'guardar' && aporteVincular !== null;

  const mudarDirecao = (direcao: 'guardar' | 'retirar') => {
    setAporteDirecao(direcao);
    setAporteVia('conta');
    setAporteConta(null);
    setAporteOutra(null);
    setAporteVincular(null);
  };
  const mudarVia = (via: 'conta' | 'transferir') => {
    setAporteVia(via);
    setAporteConta(null);
    setAporteOutra(null);
    setAporteVincular(null);
  };

  const salvarMovimentacao = () => {
    if (!aporte || !validacao.pronto) return;
    const antes = Number(aporte.saved_cents);
    const sinal = aporteDirecao === 'guardar' ? 1 : -1;
    movimento.mutate(entradaDaMovimentacao(aporte.id, rascunho), {
      onSuccess: (r) => {
        const depois = Number(r?.saved_cents ?? antes + sinal * aporteCents);
        setTravessia({ goalId: aporte.id, token: Date.now(), antes, depois });
        const bateu = depois >= Number(aporte.target_cents) && antes < Number(aporte.target_cents);
        toast({
          message: bateu ? `${aporte.name} bateu a meta.` : sinal > 0 ? `Guardado em ${aporte.name}.` : `Retirado de ${aporte.name}.`,
          tone: 'success',
        });
        setAporte(null);
      },
      // o sheet FICA aberto com o valor: fechar num erro faz o usuário achar que guardou
      onError: (error) => toast({
        message: mensagemDaMovimentacao(error, sinal > 0 ? 'Não deu para guardar.' : 'Não deu para retirar.', brl), tone: 'error',
      }),
    });
  };

  /** Desfaz a movimentação inteira: aporte, separação e a transferência que ELA criou. */
  const desfazerMovimentacao = (goal: Goal, m: GoalMoneyMovement) =>
    confirmDestructive(
      'Desfazer esta movimentação?',
      'Desfazer',
      () =>
        movimento.mutate(
          { op: 'undo', movement_id: m.id, expected_revision: m.revision },
          {
            onSuccess: () => toast({ message: 'Movimentação desfeita.', tone: 'success' }),
            onError: (error) => toast({ message: mensagemDaMovimentacao(error, 'Não deu para desfazer.', brl), tone: 'error' }),
          }
        ),
      `${naturezaDaMovimentacao(m)}. ${m.created_transfer ? 'A transferência criada por ela também é apagada.' : 'Nenhum lançamento é apagado.'} ${m.kind === 'release' || m.kind === 'transfer_out' ? `${goal.name} volta a ter ${brl(m.amount_cents)}.` : `${goal.name} perde ${brl(m.amount_cents)}.`}`
    );

  const desfazerAporte = (goal: Goal, amountCents: number) =>
    confirmDestructive(
      'Desfazer este aporte?',
      'Desfazer',
      () =>
        deposit.mutate(
          { goal, amountCents: -amountCents, note: 'estorno' },
          {
            onSuccess: () => toast({ message: 'Depósito desfeito.', tone: 'success' }),
            onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }),
          }
        ),
      `${formatBRL(amountCents)} sai da meta ${goal.name}.`
    );

  const arquivar = (g: Goal) =>
    confirmDestructive(
      `Arquivar a meta ${g.name}?`,
      'Arquivar',
      () =>
        archive.mutate(g.id, {
          onSuccess: () => toast({ message: <>Meta <Forte>{g.name}</Forte> arquivada.</>, tone: 'success' }),
          onError: () => toast({ message: <>Não deu para arquivar <Forte>{g.name}</Forte>.</>, tone: 'error' }),
        }),
      'A meta sai da lista. O que você guardou fica no histórico.'
    );

  /** O menu da meta, UMA lista para o toque longo e o arrasto. */
  const acoesDaMeta = (g: Goal): ItemAction[] => [
    { label: 'Guardar', icon: 'plus.circle', arrasto: 'direita', onPress: () => abrirAporte(g) },
    { label: 'Editar', onPress: () => abrirEdicao(g) },
    { label: 'Ver extrato', onPress: () => setExtrato(g) },
    { label: 'Simular com outras metas', onPress: () => planEditor.open({ ws: g.workspace_id, goalId: g.id }) },
    { label: 'Arquivar', icon: 'archivebox', arrasto: 'esquerda', onPress: () => arquivar(g) },
  ];
  const acoes = (g: Goal) => showItemActions(g.name, acoesDaMeta(g));

  const cartaoMeta = (g: Goal, index: number) => {
    const saved = Number(g.saved_cents);
    const target = Number(g.target_cents);
    const falta = Math.max(0, target - saved);
    const pct = target > 0 ? Math.min(1, saved / target) : 0;
    const concluida = falta === 0;
    const proximoMarco = textoDoProximoMarco(saved, target, marcosDe(g.id), brl);
    const planned = !planning.isError && !concluida
      ? planning.data?.horizons.find(entry => entry.item.goal_id === g.id && entry.item.included) : undefined;

    return (
      <Animated.View
        key={g.id}
        layout={transicaoDeLayout}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Deslizavel titulo={g.name} acoes={acoesDaMeta(g)} forma="card">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${g.name}, ${brl(saved)} de ${brl(target)}, ${Math.round(pct * 100)} por cento${concluida ? ', concluída' : `, faltam ${brl(falta)}`}`}
          onPress={() => abrirAporte(g)}
          onLongPress={() => acoes(g)}>
          <Card style={styles.meta}>
            <View style={styles.metaTopo}>
              <AnelDaMeta
                goalId={g.id}
                saved={saved}
                target={target}
                marcos={marcosDe(g.id)}
                icon={g.icon}
                color={g.color}
                concluida={concluida}
                travessia={travessia}
                label={`${Math.round(pct * 100)} por cento`}
              />
              <View style={styles.metaTexto}>
                <View style={styles.metaTitulo}>
                  <ThemedText type="default" style={styles.metaNome}>
                    {g.name}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    themeColor={concluida ? 'success' : 'textSecondary'}
                    // Número com "%" não encolhe: com fonte grande ele partia em "0" / "%".
                    style={[tabular, { flexShrink: 0 }]}>
                    {Math.round(pct * 100)}%
                  </ThemedText>
                </View>

                {/* UMA frase, com o valor dentro: em peças soltas num `flexWrap` cada uma quebrava
                    sozinha e o `Money` encolhia para caber, desalinhando a linha (23/09/2026). */}
                <ThemedText type="small" themeColor="textSecondary">
                  <Money cents={saved} variant="subhead" /> de{' '}
                  <Money cents={target} variant="subhead" tone="textSecondary" />
                  {/* "faltam" saiu da linha: o anel e o % já dizem, e ele empurrava o valor para baixo. */}
                  {concluida ? (
                    <ThemedText type="small" themeColor="success">
                      {' '}· concluída
                    </ThemedText>
                  ) : null}
                </ThemedText>
                {proximoMarco && !concealed ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {proximoMarco}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            {planned ? <GoalContributionCaption entry={planned} />
              : g.deadline && !concluida && !concealed ? <ThemedText type="footnote" themeColor="textSecondary">
              Prazo: {mesDoPrazo(g.deadline)}
            </ThemedText> : null}

            {!concluida ? (
              <Button label="Guardar" size="sm" variant="secondary" onPress={() => abrirAporte(g)} />
            ) : null}
          </Card>
        </PressableScale>
        </Deslizavel>
      </Animated.View>
    );
  };

  /**
   * Extrato agrupado por mês: com o total do mês no cabeçalho. Aos poucos (24/09/2026): os aportes
   * aparecem um passo por vez, mas o total de cada mês é o do mês INTEIRO — um mês cortado pela
   * janela não pode dizer que guardou menos do que guardou.
   */
  const aportes = useAosPoucos(contribuicoes.data ?? [], extrato?.id ?? '');
  const mesesDoExtrato = () => {
    const totais = new Map<string, number>();
    for (const c of contribuicoes.data ?? []) {
      const chave = c.occurred_at.slice(0, 7);
      totais.set(chave, (totais.get(chave) ?? 0) + Number(c.amount_cents));
    }
    const grupos = new Map<string, { total: number; itens: typeof aportes.visiveis }>();
    for (const c of aportes.visiveis) {
      const chave = c.occurred_at.slice(0, 7);
      const atual = grupos.get(chave) ?? { total: totais.get(chave) ?? 0, itens: [] };
      atual.itens.push(c);
      grupos.set(chave, atual);
    }
    return [...grupos.entries()];
  };

  const loading = goals.isLoading ? (
    <>
      <Skeleton height={120} radius={Radius.lg} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;

  const goalSummary = (
    <View style={styles.paneBody}>
      {goals.isError ? (
        <ErrorBand message="Não deu para carregar suas metas." onRetry={goals.refetch} />
      ) : lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Guardado</HeroLabel>
            <Money cents={guardado} variant="money" />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              de <Money cents={alvo} variant="subhead" tone="textSecondary" /> em {lista.length}{' '}
              {lista.length === 1 ? 'meta' : 'metas'}
            </ThemedText>
          </Card>
        </Animated.View>
      ) : null}
      {lista.length > 0 && !goals.isError ? <GoalPlanningSummary query={planning} editor={planEditor} /> : null}
    </View>
  );

  const goalListContent = (
    <View style={styles.paneBody}>
      {jAbertas.visiveis.map(cartaoMeta)}
      <VerMais restantes={jAbertas.restantes} onPress={() => janelas.verMais('abertas')} />
      {concluidas.length > 0 ? (
        <View style={styles.secao}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: concluidasAbertas }}
            accessibilityLabel={`Concluídas, ${concluidas.length}`}
            onPress={() => setConcluidasAbertas((v) => !v)}>
            <SectionHead
              title={`Concluídas (${concluidas.length})`}
              action={
                <Icon
                  name={concluidasAbertas ? 'chevron.up' : 'chevron.down'}
                  size="sm"
                  color="textSecondary"
                />
              }
            />
          </Pressable>
          {concluidasAbertas ? jConcluidas.visiveis.map(cartaoMeta) : null}
          {concluidasAbertas ? (
            <VerMais restantes={jConcluidas.restantes} onPress={() => janelas.verMais('concluidas')} />
          ) : null}
        </View>
      ) : null}
      {/* Só concluídas: elas vêm primeiro e o vazio vira uma linha embaixo (24/09/2026). */}
      {!goals.isLoading && !goals.isError && lista.length > 0 && abertas.length === 0 ? (
        <EmptyState
          icon="target"
          title="Nenhuma meta em andamento"
          hint="Toca em + para começar a próxima."
          action={{ label: 'Nova meta', onPress: abrirNova }}
          compacto
        />
      ) : null}
      {!goals.isLoading ? (
        <SecaoDeArquivados
          tabela="goals"
          titulo="Arquivadas"
          subtitulo={() => 'meta arquivada'}
          trailing={(g) => <Money cents={Number(g.saved_cents ?? 0)} variant="subhead" tone="textSecondary" />}
        />
      ) : null}
      {!goals.isLoading && !goals.isError && lista.length === 0 ? (
        <EmptyState
          compacto={temArquivada}
          icon="target"
          title="Nenhuma meta ainda"
          hint={'Manda no WhatsApp: *quero juntar 3000 pra viagem até dezembro*\n— ou toca em + para criar aqui.'}
          action={{ label: 'Nova meta', onPress: abrirNova }}
        />
      ) : null}
    </View>
  );

  const goalList = (
    <View style={styles.paneBody}>
      {loading}
      {goalListContent}
    </View>
  );

  const compactBody = (
    <>
      {loading}
      {goalSummary}
      {goalListContent}
    </>
  );

  const tabletBody = (
    <AdaptivePanes
      main={goalList}
      support={goals.isError || lista.length > 0 ? goalSummary : undefined}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="goals-tablet-workspace"
    />
  );

  return (
    <Screen grouped wide={tablet} onRefresh={() => Promise.all([goals.refetch(), planning.refetch(), extrato?.id ? contribuicoes.refetch() : Promise.resolve()])}>
      <Stack.Screen
        options={{
          title: 'Metas',
        }}
      />

      <HeaderActions actions={[{ label: 'Nova meta', icon: 'plus', onPress: abrirNova }]} />

      {tablet ? tabletBody : compactBody}
      <GoalPlanSheet editor={planEditor} onViewChange={planRuler.setView} />

      {/* Aportar — detent pequeno: um valor, uma nota, dois botões de intenção. */}
      <Sheet visible={aporte !== null} onClose={() => setAporte(null)}>
          <TaskHeader
            title={aporte?.name ?? 'Meta'}
            onClose={() => setAporte(null)}
          />

          {aporte ? (
            <SheetScroll contentContainerStyle={styles.sheetBody}>
              <Segmented
                options={[
                  { value: 'guardar', label: 'Guardar' },
                  { value: 'retirar', label: 'Retirar' },
                ]}
                value={aporteDirecao}
                onChange={mudarDirecao}
              />
              {/* Chave, não um segundo seletor de abas logo abaixo do primeiro (06/10/2026):
                  desligada, o dinheiro já está na conta (ou é só liberado); ligada, ele se move. */}
              <SwitchRow
                label={aporteDirecao === 'guardar' ? 'Transferir de outra conta' : 'Transferir de volta para uma conta'}
                value={aporteVia === 'transferir'}
                onValueChange={(ligada) => mudarVia(ligada ? 'transferir' : 'conta')}
              />

              {vinculada ? null : (
                <Field label="Valor" obrigatorio>
                  <MoneyField valueCents={aporteCents} onChangeCents={setAporteCents} autoFocus />
                </Field>
              )}

              {aporteVia === 'conta' ? (
                <Field label="Conta" obrigatorio={aporteDirecao === 'guardar'}>
                  <AccountPicker
                    accounts={contas}
                    value={aporteConta}
                    onChange={setAporteConta}
                    emptyLabel={aporteDirecao === 'retirar' ? 'Sem origem' : undefined}
                    placeholder="Escolher a conta"
                  />
                </Field>
              ) : (
                <>
                  {aporteDirecao === 'guardar' ? (
                    <Field label="Transferência já lançada">
                      <SelectField
                        value={aporteVincular}
                        onChange={setAporteVincular}
                        placeholder="Escolher uma transferência"
                        options={[
                          { id: null, label: 'Criar uma nova', icon: 'plus' },
                          ...(candidatas.data ?? []).map((t) => ({
                            id: t.id,
                            label: `${brl(t.amount_cents)} · ${t.from_name ?? 'conta removida'} para ${t.to_name ?? 'conta removida'}`,
                            meta: isoToBR(t.occurred_on),
                          })),
                        ]}
                      />
                    </Field>
                  ) : null}
                  {vinculada ? null : (
                    <>
                      <Field label="Da conta" obrigatorio>
                        <AccountPicker
                          accounts={contas}
                          value={aporteDirecao === 'guardar' ? aporteOutra : aporteConta}
                          onChange={aporteDirecao === 'guardar' ? setAporteOutra : setAporteConta}
                          placeholder="Escolher a origem"
                        />
                      </Field>
                      <Field label="Para a conta" obrigatorio>
                        <AccountPicker
                          accounts={contas}
                          value={aporteDirecao === 'guardar' ? aporteConta : aporteOutra}
                          onChange={aporteDirecao === 'guardar' ? setAporteConta : setAporteOutra}
                          placeholder="Escolher o destino"
                        />
                      </Field>
                    </>
                  )}
                </>
              )}

              {vinculada ? null : (
                <>
                  <Field label="Quando">
                    <DatePickerField
                      value={aporteData}
                      onChange={setAporteData}
                      max={aporteVia === 'transferir' ? undefined : localISODate()}
                      accessibilityLabel="Data do aporte"
                    />
                  </Field>
                </>
              )}

              <Field label="Nota">
                <TextField
                  value={aporteNota}
                  onChangeText={setAporteNota}
                  placeholder="Ex.: sobra do salário"
                  returnKeyType="done"
                />
              </Field>

              {validacao.motivo ? (
                <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
                  {validacao.motivo}
                </ThemedText>
              ) : null}

              {efeito.length > 0 ? (
                <Card style={styles.efeito}>
                  {efeito.map((linha) => (
                    <ThemedText key={`${linha.contaId}-${linha.rotulo}`} type="small" themeColor="textSecondary">
                      {`${linha.conta} · ${linha.rotulo}: ${brl(linha.antes)} → ${brl(linha.depois)}`}
                    </ThemedText>
                  ))}
                  {ficaNegativa ? (
                    <ThemedText type="small" themeColor="danger">
                      {`${ficaNegativa.conta} fica com saldo negativo.`}
                    </ThemedText>
                  ) : null}
                </Card>
              ) : null}

              <View style={styles.acoesAporte}>
                {aporteDirecao === 'guardar' ? (
                  <Button
                    label="Guardar"
                    block
                    loading={movimento.isPending}
                    disabled={!validacao.pronto}
                    onPress={salvarMovimentacao}
                  />
                ) : (
                  <Button
                    label="Retirar"
                    block
                    loading={movimento.isPending}
                    disabled={!validacao.pronto}
                    onPress={salvarMovimentacao}
                  />
                )}
              </View>

              <ThemedText type="small" themeColor="textSecondary">
                Não conta como gasto
              </ThemedText>
            </SheetScroll>
          ) : null}
      </Sheet>

      {/* Extrato — sheet próprio, lista completa (não o acordeão truncado em 8 linhas). */}
      <Sheet visible={extrato !== null} onClose={() => { setAporteEmEdicao(null); setExtrato(null); }}>
          <TaskHeader
            title={aporteEmEdicao ? 'Editar aporte' : extrato ? `Extrato de ${extrato.name}` : 'Extrato'}
            // Editando, o ✕ volta ao extrato; na lista, fecha a folha.
            onClose={() => (aporteEmEdicao ? setAporteEmEdicao(null) : setExtrato(null))}
            action={
              aporteEmEdicao ? (
                <Button
                  label="Salvar"
                  size="sm"
                  loading={editarAporte.isPending}
                  disabled={aporteEmEdicao.cents <= 0 || !isValidBRDate(aporteEmEdicao.data)}
                  onPress={salvarAporte}
                />
              ) : undefined
            }
          />

          {aporteEmEdicao ? (
            <SheetScroll contentContainerStyle={styles.sheetBody}>
              <Field label="Tipo">
                <Segmented
                  options={[
                    { value: 'guardou', label: 'Guardei' },
                    { value: 'retirou', label: 'Retirei' },
                  ]}
                  value={aporteEmEdicao.tipo}
                  onChange={(tipo) => setAporteEmEdicao({ ...aporteEmEdicao, tipo })}
                />
              </Field>
              <Field label="Valor" obrigatorio>
                <MoneyField valueCents={aporteEmEdicao.cents} onChangeCents={(cents) => setAporteEmEdicao({ ...aporteEmEdicao, cents })} />
              </Field>
              <Field label="Nota">
                <TextField value={aporteEmEdicao.nota} onChangeText={(nota) => setAporteEmEdicao({ ...aporteEmEdicao, nota })} placeholder="Ex.: sobra do salário" />
              </Field>
              <Field label="Quando">
                <DatePickerField
                  value={aporteEmEdicao.data}
                  onChange={(data) => setAporteEmEdicao({ ...aporteEmEdicao, data })}
                  max={localISODate()}
                  accessibilityLabel="Data do aporte"
                />
              </Field>
            </SheetScroll>
          ) : (
          <SheetScroll
            contentContainerStyle={styles.sheetBody}
            // Rolar o extrato fecha o aporte arrastado que estiver aberto (Deslizavel).
            onScrollBeginDrag={fecharDeslizavelAberto}>
            {contribuicoes.isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : null}

            {contribuicoes.isError ? (
              <ErrorBand
                message="Não deu para carregar os aportes desta meta."
                onRetry={contribuicoes.refetch}
              />
            ) : null}

            {mesesDoExtrato().map(([mes, grupo]) => (
              <Section
                key={mes}
                title={`${new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · ${brl(grupo.total)}`}>
                {(grupo.itens ?? []).map((c) => {
                  // Editar à direita, Apagar à esquerda; o toque longo lê a mesma lista.
                  const mov = estadoDoDinheiro?.movements.find((x) => x.contribution_id === c.id);
                  const acoesDoAporte: ItemAction[] = extrato && mov
                    ? [{ label: 'Desfazer a movimentação', curto: 'Desfazer', icon: 'arrow.uturn.backward', destructive: true, arrasto: 'esquerda', onPress: () => desfazerMovimentacao(extrato, mov) }]
                    : extrato
                    ? [
                        { label: 'Editar', icon: 'pencil', arrasto: 'direita', onPress: () => abrirEdicaoDoAporte(c) },
                        { label: 'Apagar o aporte', curto: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => desfazerAporte(extrato, Number(c.amount_cents)) },
                      ]
                    : [];
                  return (
                  <Deslizavel key={c.id} titulo={isoToBR(c.occurred_at)} acoes={acoesDoAporte}>
                  <Row
                    title={isoToBR(c.occurred_at)}
                    subtitle={mov ? [naturezaDaMovimentacao(mov), c.note].filter(Boolean).join(' · ') : (c.note ?? undefined)}
                    chevron={false}
                    accessibilityLabel={`${isoToBR(c.occurred_at)}, ${Number(c.amount_cents) < 0 ? 'retirada' : 'depósito'} de ${brl(Math.abs(Number(c.amount_cents)))}`}
                    onLongPress={acoesDoAporte.length ? () => showItemActions(isoToBR(c.occurred_at), acoesDoAporte) : undefined}
                    trailing={
                      <Money cents={Number(c.amount_cents)} variant="ticker" tone="auto" signed />
                    }
                  />
                  </Deslizavel>
                  );
                })}
              </Section>
            ))}
            <VerMais restantes={aportes.restantes} onPress={aportes.verMais} />

            {!contribuicoes.isLoading &&
            !contribuicoes.isError &&
            (contribuicoes.data ?? []).length === 0 ? (
              <EmptyState
                icon="tray"
                title="Você ainda não guardou nada"
                hint="O primeiro pode ser agora."
                action={{
                  label: 'Guardar',
                  onPress: () => {
                    const meta = extrato;
                    setExtrato(null);
                    if (meta) abrirAporte(meta);
                  },
                }}
              />
            ) : null}
          </SheetScroll>
          )}
      </Sheet>

      {/* Criar / editar */}
      <Sheet visible={form !== null} onClose={() => setForm(null)}>
          <TaskHeader
            title={form?.id ? 'Editar meta' : 'Nova meta'}
            onClose={() => setForm(null)}
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
            <SheetScroll contentContainerStyle={styles.sheetBody}>
              <Field label="Nome" obrigatorio>
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Ex.: Viagem de férias"
                  autoFocus
                />
              </Field>

              <Field label="Quanto quer juntar" obrigatorio>
                <MoneyField
                  valueCents={form.targetCents}
                  onChangeCents={(targetCents) => setForm({ ...form, targetCents })}
                />
              </Field>

              <Field
                label="Prazo"
                hint="Mostra quanto guardar por mês"
                error={form.deadline && !prazoOk ? 'Data inválida (dd/mm/aaaa)' : undefined}>
                <DatePickerField
                  value={form.deadline}
                  onChange={(deadline) => setForm({ ...form, deadline })}
                  placeholder="Escolher prazo"
                  accessibilityLabel="Prazo da meta"
                  invalid={Boolean(form.deadline) && !prazoOk}
                />
              </Field>

              {marcosProntos ? (
                <>
                  <MarcosDaMeta
                    linhas={form.marcos}
                    targetCents={form.targetCents}
                    unidade={form.unidadeDoMarco}
                    onUnidade={(unidadeDoMarco) => setForm({ ...form, unidadeDoMarco })}
                    onChange={(marcos) => setForm({ ...form, marcos })}
                  />
                  {recusaDosMarcosMsg ? (
                    <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
                      {recusaDosMarcosMsg}
                    </ThemedText>
                  ) : null}
                </>
              ) : null}

              <AparenciaDaMeta
                icon={form.icon}
                color={form.color}
                onIcon={(icon) => setForm({ ...form, icon })}
                onColor={(color) => setForm({ ...form, color })}
              />
            </SheetScroll>
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
  secao: {
    gap: Space.md,
  },
  meta: {
    gap: Space.sm,
    alignItems: 'stretch',
  },
  metaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  metaTexto: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
  },
  metaTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  metaNome: {
    flexShrink: 1,
  },
  valores: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  acoesAporte: {
    gap: Space.md,
  },
  efeito: {
    gap: Space.xs,
    alignItems: 'stretch',
  },
});
