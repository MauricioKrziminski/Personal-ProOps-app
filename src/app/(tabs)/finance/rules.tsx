import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ErrorCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type, tabular } from '@/design/tokens';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { SUGGESTED_CATEGORIES } from '@/lib/categories';
import {
  useAccounts,
  useDeleteRule,
  useRules,
  useSaveRule,
  type CategorizationRule,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** Postgres: violação de unique. Aqui só pode ser `(workspace_id, match_type, pattern)` da `0017`. */
const UNIQUE_VIOLATION = '23505';

function ehGatilhoRepetido(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

interface Rascunho {
  id?: string;
  pattern: string;
  category: string | null;
  accountId: string | null;
}

const VAZIO: Rascunho = { pattern: '', category: null, accountId: null };

/**
 * Regras de categoria — a resposta do produto à queixa nº1 contra os concorrentes:
 * *"categorizou errado e não dá para consertar"*.
 *
 * A regra do usuário **ganha da IA**, e a tela diz isso em texto: `_match_rule` roda depois do
 * parse no WhatsApp e antes do Gemini na importação. `hits` é a única métrica de valor aqui —
 * regra com zero acerto é lixo, e o usuário precisa ver isso para limpar.
 */
export default function RulesScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { data: rules, isLoading, isError, refetch, isRefetching } = useRules();
  const { data: accounts } = useAccounts();
  const save = useSaveRule();
  const remove = useDeleteRule();

  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const lista = rules ?? [];
  const totalHits = lista.reduce((soma, r) => soma + (r.hits ?? 0), 0);
  const ativas = lista.filter((r) => (r.hits ?? 0) > 0).length;
  const podeSalvar = (rascunho?.pattern.trim().length ?? 0) >= 2 && Boolean(rascunho?.category);

  const nomeConta = (id: string | null) =>
    id ? ((accounts ?? []).find((c) => c.id === id)?.name ?? 'conta') : null;

  const abrir = (rule?: CategorizationRule) => {
    setErroSalvar(null);
    setRascunho(
      rule
        ? {
            id: rule.id,
            pattern: rule.pattern,
            category: rule.category,
            accountId: rule.account_id,
          }
        : VAZIO
    );
  };

  const fechar = () => {
    setRascunho(null);
    setErroSalvar(null);
  };

  const salvar = () => {
    if (!rascunho || !podeSalvar) return;
    setErroSalvar(null);
    save.mutate(
      {
        id: rascunho.id,
        pattern: rascunho.pattern.trim(),
        category: rascunho.category!,
        accountId: rascunho.accountId,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          fechar();
        },
        onError: (err) => {
          // Erro adivinhado ("regra repetida?") é o app chutando. O motivo real é o unique da
          // `0017`, e dá para dizer QUAL regra já existe.
          if (ehGatilhoRepetido(err)) {
            const existente = lista.find(
              (r) => r.pattern.toLowerCase() === rascunho.pattern.trim().toLowerCase()
            );
            setErroSalvar(
              existente
                ? `Já existe uma regra para “${existente.pattern}” → ${existente.category ?? 'sem categoria'}. Edite ela em vez de criar outra.`
                : 'Já existe uma regra com esse gatilho.'
            );
            return;
          }
          setErroSalvar('Não deu para salvar. Tenta de novo.');
          toast({ message: 'Não deu para salvar a regra.', tone: 'error' });
        },
      }
    );
  };

  const apagar = (rule: CategorizationRule) =>
    confirmDestructive(
      `Parar de categorizar “${rule.pattern}” automaticamente?`,
      'Apagar regra',
      () =>
        remove.mutate(rule.id, {
          onSuccess: () => toast({ message: 'Regra apagada.', tone: 'success' }),
          // Hoje apagar falha em silêncio: a linha some da UI e volta na próxima query.
          onError: () => toast({ message: 'Não deu para apagar a regra.', tone: 'error' }),
        }),
      'Os lançamentos já categorizados continuam como estão.'
    );

  const acoes = (rule: CategorizationRule) =>
    showItemActions(`${rule.pattern} → ${rule.category ?? 'sem categoria'}`, [
      { label: 'Editar', onPress: () => abrir(rule) },
      { label: 'Apagar', destructive: true, onPress: () => apagar(rule) },
    ]);

  const legenda = (rule: CategorizationRule) => {
    const conta = nomeConta(rule.account_id);
    return [
      rule.hits > 0 ? `aplicada ${rule.hits}x` : 'ainda não pegou nada',
      conta ? `só em ${conta}` : null,
      rule.source === 'learned' ? 'aprendida' : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <Screen grouped onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen
        options={{
          title: 'Regras',
          headerLargeTitle: true,
          headerRight: () => (
            <Pressable accessibilityLabel="Nova regra" hitSlop={12} onPress={() => abrir()}>
              <Icon name="plus" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {/* Texto, não card: a explicação não pode competir de tamanho com o dado. */}
      <View style={styles.faixa}>
        <ThemedText type="small" themeColor="textSecondary">
          Sua regra ganha da IA. Vale no WhatsApp e na importação de extrato.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Dá para criar por mensagem: “sempre que eu falar ifood, põe em restaurante”.
        </ThemedText>
      </View>

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading && !isError ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela — e só quando existe número para mostrar. */}
      {totalHits > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="small" themeColor="textSecondary">
              O que suas regras já pouparam
            </ThemedText>
            <ThemedText style={[Type.title, tabular]}>{totalHits}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {totalHits === 1 ? 'lançamento categorizado' : 'lançamentos categorizados'} sem
              precisar da IA, por {ativas} {ativas === 1 ? 'regra' : 'regras'}.
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {lista.length > 0 ? (
        <Section title="Suas regras">
          {lista.map((rule, index) => (
            <Animated.View
              key={rule.id}
              layout={LinearTransition.duration(Motion.duration.base)}
              entering={FadeInDown.duration(Motion.duration.slow).delay(
                Math.min(index * Motion.stagger.step, Motion.stagger.cap)
              )}
            >
              <Row
                title={`${rule.pattern}  →  ${rule.category ?? 'sem categoria'}`}
                subtitle={legenda(rule)}
                icon="text.badge.checkmark"
                chevron={false}
                accessibilityLabel={`Quando contiver ${rule.pattern}, categorizar como ${rule.category ?? 'sem categoria'}, ${legenda(rule)}`}
                onPress={() => abrir(rule)}
                onLongPress={() => acoes(rule)}
              />
            </Animated.View>
          ))}
        </Section>
      ) : null}

      {!isLoading && !isError && lista.length === 0 ? (
        <EmptyState
          icon="text.badge.checkmark"
          title="Nenhuma regra ainda"
          hint={
            'Crie uma para o que a IA sempre erra — “posto” vira transporte.\nOu manda no WhatsApp: “sempre que eu falar ifood, põe em restaurante”.'
          }
          action={{ label: 'Nova regra', onPress: () => abrir() }}
        />
      ) : null}

      {/* Form sheet: o formulário deixa de empurrar a lista para baixo quando abre. */}
      <Modal
        visible={rascunho !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={fechar}
      >
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: theme.separator }]}>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={fechar}>
              <ThemedText type="default" themeColor="tint">
                Cancelar
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold">{rascunho?.id ? 'Editar regra' : 'Nova regra'}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !podeSalvar || save.isPending }}
              disabled={!podeSalvar || save.isPending}
              hitSlop={12}
              onPress={salvar}
            >
              <ThemedText
                type="smallBold"
                themeColor={podeSalvar && !save.isPending ? 'tint' : 'textSecondary'}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + Space.xxl }]}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              label="Quando o lançamento contiver"
              error={erroSalvar ?? undefined}
              hint="Trecho do texto, sem diferenciar maiúscula de minúscula."
            >
              <TextField
                value={rascunho?.pattern ?? ''}
                onChangeText={(pattern) =>
                  setRascunho((atual) => (atual ? { ...atual, pattern } : atual))
                }
                placeholder="ex.: ifood"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                invalid={Boolean(erroSalvar)}
              />
            </Field>

            <Field label="Categorizar como">
              <View style={styles.chips}>
                {SUGGESTED_CATEGORIES.map((cat) => (
                  <Chip
                    key={cat}
                    label={cat}
                    selected={rascunho?.category === cat}
                    onPress={() =>
                      setRascunho((atual) =>
                        atual
                          ? {
                              ...atual,
                              category: atual.category === cat ? null : cat,
                            }
                          : atual
                      )
                    }
                  />
                ))}
              </View>
            </Field>

            {(accounts ?? []).length > 0 ? (
              <Field
                label="Só nesta conta"
                hint="Opcional. Sem conta escolhida, a regra vale em todas."
              >
                <View style={styles.chips}>
                  {(accounts ?? []).map((conta) => (
                    <Chip
                      key={conta.id}
                      label={conta.name}
                      selected={rascunho?.accountId === conta.id}
                      onPress={() =>
                        setRascunho((atual) =>
                          atual
                            ? {
                                ...atual,
                                accountId: atual.accountId === conta.id ? null : conta.id,
                              }
                            : atual
                        )
                      }
                    />
                  ))}
                </View>
              </Field>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  faixa: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
  },
  hero: {
    gap: Space.xs,
  },
  sheet: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
});
