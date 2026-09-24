import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack } from 'expo-router';

import { useBRL } from '@/components/ui/conceal';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { DatePickerField } from '@/components/finance/date-picker-field';
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
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useArchiveGoal,
  useGoalContributions,
  useGoalDeposit,
  useGoals,
  useSaveGoal,
  type Goal,
} from '@/hooks/use-finance';
import { brToISO, formatBRL, isValidBRDate, isoToBR, mesCurto } from '@/lib/dates';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
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
}

const FORM_VAZIO: FormState = { name: '', targetCents: 0, deadline: '' };

/** Meses inteiros de hoje até a data (mínimo 1: "este mês" ainda dá). */
function mesesAte(deadlineISO: string): number {
  const hoje = new Date();
  const [y, m] = deadlineISO.split('-').map(Number);
  return Math.max(1, (y - hoje.getFullYear()) * 12 + (m - 1 - hoje.getMonth()));
}

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
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const goals = useGoals();
  const save = useSaveGoal();
  const deposit = useGoalDeposit();
  const archive = useArchiveGoal();

  const [form, setForm] = useState<FormState | null>(null);
  const [aporteSelecionado, setAporte] = useState<Goal | null>(null);
  const [aporteCents, setAporteCents] = useState(0);
  const [aporteNota, setAporteNota] = useState('');
  const [extratoSelecionado, setExtrato] = useState<Goal | null>(null);
  const [concluidasAbertas, setConcluidasAbertas] = useState(false);

  const aporte = goals.isError ? null : (goals.data?.find((goal) => goal.id === aporteSelecionado?.id) ?? null);
  const extrato = goals.isError ? null : (goals.data?.find((goal) => goal.id === extratoSelecionado?.id) ?? null);

  // Lazy de propósito: com 8 metas na tela isso é a diferença entre 1 e 9 requisições.
  const contribuicoes = useGoalContributions(extrato?.id);

  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const lista = goals.isError ? [] : (goals.data ?? []);
  const abertas = lista.filter((g) => Number(g.saved_cents) < Number(g.target_cents));
  const concluidas = lista.filter((g) => Number(g.saved_cents) >= Number(g.target_cents));
  // Aos poucos, como toda lista do app (24/09/2026).
  const janelas = useJanelasPorGrupo('');
  const jAbertas = janelas.janelaDe('abertas', abertas);
  const jConcluidas = janelas.janelaDe('concluidas', concluidas);
  const guardado = lista.reduce((s, g) => s + Number(g.saved_cents), 0);
  const alvo = lista.reduce((s, g) => s + Number(g.target_cents), 0);

  const abrirNova = () => setForm({ ...FORM_VAZIO });
  const abrirEdicao = (g: Goal) =>
    setForm({
      id: g.id,
      name: g.name,
      targetCents: Number(g.target_cents),
      deadline: g.deadline ? isoToBR(g.deadline) : '',
    });

  const abrirAporte = (g: Goal) => {
    setAporteCents(0);
    setAporteNota('');
    setAporte(g);
  };

  const prazoOk = form ? form.deadline === '' || isValidBRDate(form.deadline) : false;
  const podeSalvar = Boolean(form && form.name.trim().length >= 2 && form.targetCents > 0 && prazoOk);

  const salvar = () => {
    if (!form || !podeSalvar) return;
    save.mutate(
      {
        id: form.id,
        name: form.name.trim(),
        target_cents: form.targetCents,
        deadline: form.deadline ? brToISO(form.deadline) : null,
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

  /**
   * Retirar mais do que está guardado: o banco somava o ledger com `greatest(sum, 0)` e o saldo
   * virava 0 sem aviso — o próximo "Guardar" sumia (22/09/2026). O banco agora recusa
   * (`20260922130000`); aqui o botão desliga antes e a dica diz até quanto dá.
   */
  const passaDoGuardado = aporte !== null && aporteCents > Number(aporte.saved_cents);

  const lancarAporte = (sinal: 1 | -1) => {
    if (!aporte || aporteCents <= 0) return;
    if (sinal < 0 && passaDoGuardado) return;
    const antes = Number(aporte.saved_cents);
    const depois = antes + sinal * aporteCents;
    deposit.mutate(
      { goal: aporte, amountCents: sinal * aporteCents, note: aporteNota.trim() || undefined },
      {
        onSuccess: () => {
          const bateu = depois >= Number(aporte.target_cents) && antes < Number(aporte.target_cents);
          toast({
            message: bateu
              ? `${aporte.name} bateu a meta.`
              : sinal > 0
                ? `Guardado em ${aporte.name}.`
                : `Retirado de ${aporte.name}.`,
            tone: 'success',
          });
          setAporte(null);
        },
        // o sheet FICA aberto com o valor: fechar num erro faz o usuário achar que guardou
        onError: () =>
          toast({ message: sinal > 0 ? 'Não deu para guardar.' : 'Não deu para retirar.', tone: 'error' }),
      }
    );
  };

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
      `${formatBRL(amountCents)} sai de «${goal.name}».`
    );

  const arquivar = (g: Goal) =>
    confirmDestructive(
      `Arquivar "${g.name}"?`,
      'Arquivar',
      () =>
        archive.mutate(g.id, {
          onSuccess: () => toast({ message: `${g.name} arquivada.`, tone: 'success' }),
          onError: () => toast({ message: `Não deu para arquivar ${g.name}.`, tone: 'error' }),
        }),
      'A meta sai da lista. O que você guardou fica no histórico.'
    );

  /** O menu da meta, UMA lista para o toque longo e o arrasto. */
  const acoesDaMeta = (g: Goal): ItemAction[] => [
    { label: 'Guardar', icon: 'plus.circle', arrasto: 'direita', onPress: () => abrirAporte(g) },
    { label: 'Editar', onPress: () => abrirEdicao(g) },
    { label: 'Ver extrato', onPress: () => setExtrato(g) },
    { label: 'Arquivar', icon: 'archivebox', arrasto: 'esquerda', onPress: () => arquivar(g) },
  ];
  const acoes = (g: Goal) => showItemActions(g.name, acoesDaMeta(g));

  const cartaoMeta = (g: Goal, index: number) => {
    const saved = Number(g.saved_cents);
    const target = Number(g.target_cents);
    const falta = Math.max(0, target - saved);
    const pct = target > 0 ? Math.min(1, saved / target) : 0;
    const concluida = falta === 0;
    const porMes = g.deadline && !concluida ? Math.ceil(falta / mesesAte(g.deadline)) : null;

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
          accessibilityLabel={`${g.name}, ${formatBRL(saved)} de ${formatBRL(target)}, ${Math.round(pct * 100)} por cento${concluida ? ', concluída' : `, faltam ${formatBRL(falta)}`}`}
          onPress={() => abrirAporte(g)}
          onLongPress={() => acoes(g)}>
          <Card style={styles.meta}>
            <View style={styles.metaTopo}>
              <View style={styles.metaTitulo}>
                <Icon
                  name={concluida ? 'checkmark.seal.fill' : 'target'}
                  size="md"
                  color={concluida ? 'success' : 'tint'}
                />
                <ThemedText type="default">
                  {g.name}
                </ThemedText>
              </View>
              <ThemedText
                type="smallBold"
                themeColor={concluida ? 'success' : 'textSecondary'}
                // Número com "%" não encolhe: com fonte grande ele partia em "0" / "%".
                style={[tabular, { flexShrink: 0 }]}>
                {Math.round(pct * 100)}%
              </ThemedText>
            </View>

            <ProgressBar value={saved} max={target} tone={concluida ? 'success' : 'tint'} />

            {/* UMA frase, com o valor dentro: em peças soltas num `flexWrap` cada uma quebrava
                sozinha e o `Money` encolhia para caber, desalinhando a linha (23/09/2026). */}
            <ThemedText type="small" themeColor="textSecondary">
              <Money cents={saved} variant="subhead" /> de{' '}
              <Money cents={target} variant="subhead" tone="textSecondary" />
              {/* "faltam" saiu da linha: a barra e o % já dizem, e ele empurrava o valor para baixo. */}
              {concluida ? (
                <ThemedText type="small" themeColor="success">
                  {' '}· concluída
                </ThemedText>
              ) : null}
            </ThemedText>

            {porMes && g.deadline ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                <Money cents={porMes} variant="footnote" tone="textSecondary" />/mês até{' '}
                {mesDoPrazo(g.deadline)}
              </ThemedText>
            ) : null}

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
      {!goals.isLoading && !goals.isError && lista.length === 0 ? (
        <EmptyState
          icon="target"
          title="Nenhuma meta ainda"
          hint={'Manda no WhatsApp: “quero juntar 3000 pra viagem até dezembro”\n— ou toca em + para criar aqui.'}
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
    <Screen grouped wide={tablet} onRefresh={() => Promise.all([goals.refetch(), extrato?.id ? contribuicoes.refetch() : Promise.resolve()])}>
      <Stack.Screen
        options={{
          title: 'Metas',
        }}
      />

      <HeaderActions actions={[{ label: 'Nova meta', icon: 'plus', onPress: abrirNova }]} />

      {tablet ? tabletBody : compactBody}

      {/* Aportar — detent pequeno: um valor, uma nota, dois botões de intenção. */}
      <Sheet visible={aporte !== null} onClose={() => setAporte(null)}>
          <TaskHeader
            title={aporte?.name ?? 'Meta'}
            onClose={() => setAporte(null)}
          />

          {aporte ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field
                label="Valor"
                hint={passaDoGuardado
                  ? `Retira até ${formatBRL(Number(aporte.saved_cents))}`
                  : undefined}>
                <MoneyField valueCents={aporteCents} onChangeCents={setAporteCents} autoFocus />
              </Field>

              <Field label="Nota">
                <TextField
                  value={aporteNota}
                  onChangeText={setAporteNota}
                  placeholder="de onde veio"
                  returnKeyType="done"
                />
              </Field>

              <View style={styles.acoesAporte}>
                <Button
                  label="Guardar"
                  block
                  loading={deposit.isPending}
                  disabled={aporteCents <= 0}
                  onPress={() => lancarAporte(1)}
                />
                <Button
                  label="Retirar"
                  variant="secondary"
                  block
                  loading={deposit.isPending}
                  disabled={aporteCents <= 0 || passaDoGuardado}
                  onPress={() => lancarAporte(-1)}
                />
              </View>

              <ThemedText type="small" themeColor="textSecondary">
                Não conta como gasto · data de hoje
              </ThemedText>
            </ScrollView>
          ) : null}
      </Sheet>

      {/* Extrato — sheet próprio, lista completa (não o acordeão truncado em 8 linhas). */}
      <Sheet visible={extrato !== null} onClose={() => setExtrato(null)}>
          <TaskHeader
            title={extrato ? `Extrato de ${extrato.name}` : 'Extrato'}
            onClose={() => setExtrato(null)}
          />

          <ScrollView
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
                  // O aporte só tem "Desfazer": ele vai à esquerda, e o toque longo lê a mesma lista.
                  const acoesDoAporte: ItemAction[] = extrato
                    ? [{ label: 'Desfazer', icon: 'arrow.uturn.backward', destructive: true, arrasto: 'esquerda', onPress: () => desfazerAporte(extrato, Number(c.amount_cents)) }]
                    : [];
                  return (
                  <Deslizavel key={c.id} titulo={isoToBR(c.occurred_at)} acoes={acoesDoAporte}>
                  <Row
                    title={isoToBR(c.occurred_at)}
                    subtitle={c.note ?? undefined}
                    chevron={false}
                    accessibilityLabel={`${isoToBR(c.occurred_at)}, ${Number(c.amount_cents) < 0 ? 'retirada' : 'depósito'} de ${formatBRL(Math.abs(Number(c.amount_cents)))}`}
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
          </ScrollView>
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
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Nome">
                <TextField
                  value={form.name}
                  onChangeText={(name) => setForm({ ...form, name })}
                  placeholder="Viagem"
                  autoFocus
                />
              </Field>

              <Field label="Quanto quer juntar">
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
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  metaTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
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
});
