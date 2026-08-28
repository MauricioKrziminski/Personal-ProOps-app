import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Stack } from 'expo-router';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
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
import { useTheme } from '@/hooks/use-theme';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

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
function mesDoPrazo(deadlineISO: string): string {
  const [y, m] = deadlineISO.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
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
  const theme = useTheme();
  const toast = useToast();
  const goals = useGoals();
  const save = useSaveGoal();
  const deposit = useGoalDeposit();
  const archive = useArchiveGoal();

  const [form, setForm] = useState<FormState | null>(null);
  const [aporte, setAporte] = useState<Goal | null>(null);
  const [aporteCents, setAporteCents] = useState(0);
  const [aporteNota, setAporteNota] = useState('');
  const [extrato, setExtrato] = useState<Goal | null>(null);
  const [concluidasAbertas, setConcluidasAbertas] = useState(false);

  // Lazy de propósito: com 8 metas na tela isso é a diferença entre 1 e 9 requisições.
  const contribuicoes = useGoalContributions(extrato?.id);

  const lista = goals.data ?? [];
  const abertas = lista.filter((g) => Number(g.saved_cents) < Number(g.target_cents));
  const concluidas = lista.filter((g) => Number(g.saved_cents) >= Number(g.target_cents));
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

  const lancarAporte = (sinal: 1 | -1) => {
    if (!aporte || aporteCents <= 0) return;
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
        onError: () => toast({ message: 'Não deu para registrar o aporte.', tone: 'error' }),
      }
    );
  };

  const desfazerAporte = (goal: Goal, amountCents: number) =>
    deposit.mutate(
      { goal, amountCents: -amountCents, note: 'estorno' },
      {
        onSuccess: () => toast({ message: 'Aporte desfeito.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para desfazer o aporte.', tone: 'error' }),
      }
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
      'A meta sai da lista. Os aportes ficam no histórico.'
    );

  const acoes = (g: Goal) =>
    showItemActions(g.name, [
      { label: 'Aportar', onPress: () => abrirAporte(g) },
      { label: 'Editar', onPress: () => abrirEdicao(g) },
      { label: 'Ver extrato', onPress: () => setExtrato(g) },
      { label: 'Arquivar', destructive: true, onPress: () => arquivar(g) },
    ]);

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
        layout={LinearTransition.duration(Motion.duration.base)}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Pressable
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
                <ThemedText type="default" numberOfLines={1}>
                  {g.name}
                </ThemedText>
              </View>
              <ThemedText
                type="smallBold"
                themeColor={concluida ? 'success' : 'textSecondary'}
                style={tabular}>
                {Math.round(pct * 100)}%
              </ThemedText>
            </View>

            <ProgressBar value={saved} max={target} tone={concluida ? 'success' : 'tint'} />

            <View style={styles.valores}>
              <Money cents={saved} variant="subhead" />
              <ThemedText type="small" themeColor="textSecondary">
                de
              </ThemedText>
              <Money cents={target} variant="subhead" tone="textSecondary" />
              {concluida ? (
                <ThemedText type="small" themeColor="success">
                  · concluída
                </ThemedText>
              ) : (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    · faltam
                  </ThemedText>
                  <Money cents={falta} variant="subhead" tone="textSecondary" />
                </>
              )}
            </View>

            {porMes && g.deadline ? (
              <View style={styles.valores}>
                <ThemedText type="footnote" themeColor="textSecondary">
                  precisa de
                </ThemedText>
                <Money cents={porMes} variant="footnote" tone="textSecondary" />
                <ThemedText type="footnote" themeColor="textSecondary">
                  por mês para chegar em {mesDoPrazo(g.deadline)}
                </ThemedText>
              </View>
            ) : null}

            {!concluida ? (
              <Button label="Aportar" size="sm" variant="secondary" onPress={() => abrirAporte(g)} />
            ) : null}
          </Card>
        </Pressable>
      </Animated.View>
    );
  };

  /** Extrato agrupado por mês: com o total do mês no cabeçalho. */
  const mesesDoExtrato = () => {
    const grupos = new Map<string, { total: number; itens: typeof contribuicoes.data }>();
    for (const c of contribuicoes.data ?? []) {
      const chave = c.occurred_at.slice(0, 7);
      const atual = grupos.get(chave) ?? { total: 0, itens: [] };
      atual.total += Number(c.amount_cents);
      atual.itens!.push(c);
      grupos.set(chave, atual);
    }
    return [...grupos.entries()];
  };

  return (
    <Screen grouped onRefresh={goals.refetch} refreshing={goals.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Metas',
          headerLargeTitle: true,
          headerRight: () => (
            <Pressable accessibilityLabel="Nova meta" hitSlop={12} onPress={abrirNova}>
              <Icon name="plus.circle.fill" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {goals.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: é o número que o usuário guarda na cabeça. */}
      {goals.isError ? (
        <ErrorBand message="Não deu para carregar suas metas." onRetry={goals.refetch} />
      ) : lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.heroLabel}>
              Guardado
            </ThemedText>
            <Money cents={guardado} variant="money" />
            <View style={styles.valores}>
              <ThemedText type="small" themeColor="textSecondary">
                de
              </ThemedText>
              <Money cents={alvo} variant="subhead" tone="textSecondary" />
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                em {lista.length} {lista.length === 1 ? 'meta' : 'metas'}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Aporte não entra como gasto do mês — o dinheiro só mudou de lugar.
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {abertas.map(cartaoMeta)}

      {concluidas.length > 0 ? (
        <View style={styles.secao}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: concluidasAbertas }}
            accessibilityLabel={`Concluídas, ${concluidas.length}`}
            onPress={() => setConcluidasAbertas((v) => !v)}
            style={styles.secaoCabecalho}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.secaoTitulo}>
              CONCLUÍDAS ({concluidas.length})
            </ThemedText>
            <Icon
              name={concluidasAbertas ? 'chevron.up' : 'chevron.down'}
              size="sm"
              color="textSecondary"
            />
          </Pressable>
          {concluidasAbertas ? concluidas.map(cartaoMeta) : null}
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

      {/* Aportar — detent pequeno: um valor, uma nota, dois botões de intenção. */}
      <Modal
        visible={aporte !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAporte(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setAporte(null)} />
            <ThemedText type="smallBold" numberOfLines={1}>
              {aporte?.name}
            </ThemedText>
            <View style={styles.sheetHeadSpacer} />
          </View>

          {aporte ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Valor">
                <MoneyField valueCents={aporteCents} onChangeCents={setAporteCents} autoFocus />
              </Field>

              <Field label="Nota" hint="Opcional — “13º”, “sobrou do mês”.">
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
                  disabled={aporteCents <= 0}
                  onPress={() => lancarAporte(-1)}
                />
              </View>

              <ThemedText type="small" themeColor="textSecondary">
                Aporte não entra como gasto do mês — o dinheiro só mudou de lugar. A data é hoje,{' '}
                {isoToBR(localISODate())}.
              </ThemedText>
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {/* Extrato — sheet próprio, lista completa (não o acordeão truncado em 8 linhas). */}
      <Modal
        visible={extrato !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setExtrato(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Fechar" variant="ghost" size="sm" onPress={() => setExtrato(null)} />
            <ThemedText type="smallBold" numberOfLines={1}>
              Extrato de {extrato?.name}
            </ThemedText>
            <View style={styles.sheetHeadSpacer} />
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
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
                title={`${new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · ${formatBRL(grupo.total)}`}>
                {(grupo.itens ?? []).map((c) => (
                  <Row
                    key={c.id}
                    title={isoToBR(c.occurred_at)}
                    subtitle={c.note ?? undefined}
                    chevron={false}
                    accessibilityLabel={`${isoToBR(c.occurred_at)}, ${Number(c.amount_cents) < 0 ? 'retirada' : 'aporte'} de ${formatBRL(Math.abs(Number(c.amount_cents)))}`}
                    onLongPress={() =>
                      extrato &&
                      showItemActions(isoToBR(c.occurred_at), [
                        {
                          label: 'Desfazer aporte',
                          destructive: true,
                          onPress: () => desfazerAporte(extrato, Number(c.amount_cents)),
                        },
                      ])
                    }
                    trailing={
                      <Money cents={Number(c.amount_cents)} variant="headline" tone="auto" signed />
                    }
                  />
                ))}
              </Section>
            ))}

            {!contribuicoes.isLoading &&
            !contribuicoes.isError &&
            (contribuicoes.data ?? []).length === 0 ? (
              <EmptyState
                icon="tray"
                title="Nenhum aporte ainda"
                hint="O primeiro pode ser agora."
                action={{
                  label: 'Aportar',
                  onPress: () => {
                    const meta = extrato;
                    setExtrato(null);
                    if (meta) abrirAporte(meta);
                  },
                }}
              />
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      {/* Criar / editar */}
      <Modal
        visible={form !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setForm(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setForm(null)} />
            <ThemedText type="smallBold">{form?.id ? 'Editar meta' : 'Nova meta'}</ThemedText>
            <Button
              label="Salvar"
              size="sm"
              loading={save.isPending}
              disabled={!podeSalvar}
              onPress={salvar}
            />
          </View>

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
                hint="Opcional. Com o prazo eu mostro quanto guardar por mês."
                error={form.deadline && !prazoOk ? 'Data inválida (dd/mm/aaaa)' : undefined}>
                <TextField
                  value={form.deadline}
                  onChangeText={(deadline) => setForm({ ...form, deadline })}
                  placeholder="31/12/2026"
                  keyboardType="number-pad"
                  invalid={Boolean(form.deadline) && !prazoOk}
                />
              </Field>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  heroLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  secao: {
    gap: Space.sm,
  },
  secaoCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: Space.lg,
  },
  secaoTitulo: {
    paddingHorizontal: Space.lg,
    letterSpacing: 0.6,
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
  sheet: {
    flex: 1,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  sheetHeadSpacer: {
    width: Space.xxl,
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
