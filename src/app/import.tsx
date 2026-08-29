import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import { ErrorCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { Card } from '@/components/ui/card';
import { ThemedText } from '@/components/themed-text';
import { HeaderMenu } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import { formatDateBR } from '@/hooks/use-items';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { SUGGESTED_CATEGORIES } from '@/lib/categories';
import {
  useAccounts,
  useApproveImportItems,
  useDiscardImportItems,
  useImportItems,
  useImportStatement,
  useUpdateImportItem,
  type ImportItem,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/**
 * O MIME curinga está na lista de propósito: banco brasileiro manda MIME errado com frequência, e
 * barrar no picker deixaria o usuário sem conseguir escolher o próprio extrato. A barreira de
 * verdade é a mensagem de erro amigável do 422.
 */
const ACCEPTED = [
  'application/x-ofx',
  'application/vnd.intu.qfx',
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/plain',
  '*/*',
];

/** Teto do `import-statement` (`MAX_ITEMS`). O corte era silencioso; agora está escrito na tela. */
const MAX_ITENS = 500;

interface FalhaImport {
  titulo: string;
  detalhe: string;
}

/**
 * `functions.invoke` lança `FunctionsHttpError` em QUALQUER não-2xx, com `data` nulo — então a
 * mensagem gentil que a Edge Function escreveu (402 do plano, 422 do arquivo ilegível) nunca
 * chegava na tela: o usuário lia "Edge Function returned a non-2xx status code".
 *
 * O corpo real vem em `err.context`, que é a `Response`.
 */
async function traduzErro(err: unknown): Promise<FalhaImport> {
  const context = (err as { context?: Response } | null)?.context;
  if (!context || typeof context.status !== 'number') {
    return {
      titulo: 'Não deu para importar agora',
      detalhe: 'Pode ter sido a conexão. Tenta de novo em instantes.',
    };
  }

  let doServidor = '';
  try {
    const corpo = (await context.json()) as { error?: string } | null;
    doServidor = corpo?.error ?? '';
  } catch {
    // 500 nem sempre devolve JSON — segue com a mensagem por status.
  }

  if (context.status === 402) {
    return {
      titulo: 'Importar extrato é do plano Pro',
      detalhe: doServidor || 'No Free dá para registrar pelo WhatsApp à vontade.',
    };
  }
  if (context.status === 422) {
    return {
      titulo: 'Não achei lançamentos nesse arquivo',
      detalhe:
        doServidor ||
        'Ele é o extrato em OFX ou CSV, e não o comprovante em PDF? Foto e PDF entram pelo WhatsApp.',
    };
  }
  return {
    titulo: 'Não deu para importar agora',
    detalhe: doServidor || 'Tenta de novo em instantes.',
  };
}

/**
 * Importar extrato — o substituto do Open Finance.
 *
 * Duas etapas, cada uma uma tela inteira: escolher o arquivo, depois revisar o lote. **Duplicata
 * é marcação, não bloqueio** (dois cafés iguais no mesmo dia são legítimos): elas ficam numa
 * seção própria no topo e quem decide é o usuário.
 */
export default function ImportScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ batch?: string }>();

  const { data: accounts } = useAccounts();
  const importar = useImportStatement();
  const [batchId, setBatchId] = useState<string | undefined>(params.batch);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [falha, setFalha] = useState<FalhaImport | null>(null);
  const [editando, setEditando] = useState<ImportItem | null>(null);
  const [verRevisados, setVerRevisados] = useState(false);

  const { data: items, isLoading, isError, refetch, isRefetching } = useImportItems(batchId);
  const aprovar = useApproveImportItems();
  const descartar = useDiscardImportItems();
  const atualizar = useUpdateImportItem();

  const lista = items ?? [];
  const paraRevisar = lista.filter((i) => i.status === 'pending');
  const repetidos = lista.filter((i) => i.status === 'duplicate');
  const revisados = lista.filter((i) => i.status === 'approved' || i.status === 'discarded');

  // O número do botão é o número que vai entrar. O cabeçalho antigo contava as duplicatas e o
  // "confirmar todos" as ignorava: confirmar 12 importava 10 sem explicar os 2.
  const vaoEntrar = paraRevisar.length;
  const somaDespesas = paraRevisar.reduce(
    (soma, i) => soma + (i.kind === 'expense' ? i.amount_cents : 0),
    0
  );
  const porRegra = paraRevisar.filter((i) => i.suggested_category).length;
  const semCategoria = paraRevisar.filter((i) => !i.suggested_category).length;

  const escolherArquivo = async () => {
    setFalha(null);
    const escolha = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (escolha.canceled) return;

    const arquivo = escolha.assets[0];
    const ehOfx = /\.(ofx|qfx)$/i.test(arquivo.name);
    try {
      // SDK 57: leitura por `new File(uri).text()` (readAsStringAsync é legado).
      const conteudo = await new File(arquivo.uri).text();
      const resultado = await importar.mutateAsync({
        content: conteudo,
        source: ehOfx ? 'ofx' : 'csv',
        filename: arquivo.name,
        accountId,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBatchId(resultado.batch_id);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFalha(await traduzErro(err));
    }
  };

  const confirmarLote = () => {
    if (!vaoEntrar) return;
    const ids = paraRevisar.map((i) => i.id);
    confirmDestructive(
      `Lançar ${vaoEntrar} ${vaoEntrar === 1 ? 'item' : 'itens'} no seu financeiro?`,
      `Confirmar ${vaoEntrar}`,
      () =>
        aprovar.mutate(ids, {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast({
              message: `${vaoEntrar} ${vaoEntrar === 1 ? 'lançamento importado' : 'lançamentos importados'}.`,
              tone: 'success',
            });
          },
          onError: () => toast({ message: 'Não deu para importar o lote.', tone: 'error' }),
        }),
      repetidos.length
        ? `Os ${repetidos.length} possíveis repetidos ficam de fora — decida um por um.`
        : undefined
    );
  };

  const descartarItem = (item: ImportItem) =>
    descartar.mutate([item.id], {
      onSuccess: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        toast({ message: 'Item descartado.', tone: 'success' });
      },
      // Descartar mudava a UI sem tratar erro: o banco não mudava e ninguém ficava sabendo.
      onError: () => toast({ message: 'Não deu para descartar o item.', tone: 'error' }),
    });

  const trocarCategoria = (item: ImportItem, cat: string | null) => {
    setEditando(null);
    atualizar.mutate(
      { id: item.id, category: cat },
      {
        onError: () => toast({ message: 'Não deu para trocar a categoria.', tone: 'error' }),
      }
    );
  };

  const acoes = (item: ImportItem) =>
    showItemActions(item.description ?? 'Lançamento', [
      { label: 'Trocar categoria', onPress: () => setEditando(item) },
      {
        label: 'Descartar',
        destructive: true,
        onPress: () => descartarItem(item),
      },
    ]);

  const linha = (item: ImportItem, index: number) => (
    <Animated.View
      key={item.id}
      layout={LinearTransition.duration(Motion.duration.fast)}
      entering={FadeInDown.duration(Motion.duration.slow).delay(
        Math.min(index * 30, Motion.stagger.cap)
      )}
    >
      <Row
        title={item.description ?? 'Sem descrição'}
        subtitle={`${formatDateBR(item.occurred_at)} · ${item.suggested_category ?? 'sem categoria'}`}
        icon={item.status === 'duplicate' ? 'exclamationmark.triangle' : undefined}
        chevron={false}
        accessibilityLabel={`${item.description ?? 'Sem descrição'}, ${formatDateBR(item.occurred_at)}, ${item.suggested_category ?? 'sem categoria'}${item.status === 'duplicate' ? ', possível repetido' : ''}`}
        onPress={() => setEditando(item)}
        onLongPress={() => acoes(item)}
        trailing={
          <View style={styles.trailing}>
            <Money
              cents={item.kind === 'income' ? item.amount_cents : -item.amount_cents}
              variant="headline"
              tone="auto"
              signed
            />
            {!item.suggested_category ? (
              <ThemedText type="small" themeColor="warning">
                sem categoria
              </ThemedText>
            ) : null}
          </View>
        }
      />
    </Animated.View>
  );

  // ── Etapa 1: trazer o arquivo ────────────────────────────────────────────
  if (!batchId) {
    return (
      <Screen grouped>
        <Stack.Screen options={{ title: 'Importar extrato', headerLargeTitle: true }} />

        {/* O único destaque da etapa: a instrução é o conteúdo da tela. */}
        <Card style={styles.hero}>
          <Icon name="arrow.down.doc" size="xl" color="tint" />
          <ThemedText type="smallBold">Traga o extrato do seu banco</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
            Exporte em OFX ou CSV no app do banco. Eu categorizo tudo e você confere antes de
            entrar.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
            Foto de cupom e PDF de fatura? Manda direto no WhatsApp.
          </ThemedText>
        </Card>

        {falha ? (
          <View style={[styles.falha, { backgroundColor: theme.surface }]}>
            <ThemedText type="smallBold" themeColor="danger">
              {falha.titulo}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {falha.detalhe}
            </ThemedText>
          </View>
        ) : null}

        {(accounts ?? []).length > 0 ? (
          <View style={styles.bloco}>
            <SectionHead title="Lançar na conta" />
            <View style={styles.chips}>
              {(accounts ?? []).map((conta) => (
                <Chip
                  key={conta.id}
                  label={conta.name}
                  selected={accountId === conta.id}
                  onPress={() => setAccountId(accountId === conta.id ? null : conta.id)}
                />
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
              Opcional — sem conta escolhida o lançamento nasce sem conta.
            </ThemedText>
          </View>
        ) : null}

        {importar.isPending ? (
          <>
            <Skeleton height={20} width="70%" />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : null}

        <Button
          label={importar.isPending ? 'Lendo o arquivo…' : 'Escolher arquivo'}
          icon="doc.badge.plus"
          loading={importar.isPending}
          onPress={escolherArquivo}
          block
        />

        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          Até {MAX_ITENS} lançamentos por arquivo.
        </ThemedText>
      </Screen>
    );
  }

  // ── Etapa 2: revisar o lote ──────────────────────────────────────────────
  return (
    <Screen grouped onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen
        options={{
          title: vaoEntrar > 0 ? `Revisar ${vaoEntrar}` : 'Revisar lote',
          headerLargeTitle: true,
        }}
      />

      {/* Montado SEMPRE, com a lista condicional: `Stack.Screen` não desfaz `setOptions` no
          unmount, então `{cond ? <HeaderMenu/> : null}` deixaria o "…" no header do Android
          depois que o lote esvaziasse, apontando para ações de um lote que não existe mais. */}
      <HeaderMenu
        title="Lote de importação"
        actions={
          lista.length === 0
            ? []
            : [
                {
                  label: 'Sair e continuar depois',
                  icon: 'arrow.uturn.backward',
                  onPress: () => router.back(),
                },
                {
                  label: 'Descartar o lote',
                  icon: 'trash',
                  destructive: true,
                  onPress: () =>
                    confirmDestructive(
                      'Descartar tudo que ainda não foi confirmado?',
                      'Descartar lote',
                      () =>
                        descartar.mutate(
                          [...paraRevisar, ...repetidos].map((i) => i.id),
                          {
                            onSuccess: () =>
                              toast({ message: 'Lote descartado.', tone: 'success' }),
                            onError: () =>
                              toast({ message: 'Não deu para descartar o lote.', tone: 'error' }),
                          }
                        ),
                      'Nada entra no financeiro. Os já confirmados continuam lá.'
                    ),
                },
              ]
        }
      />

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading && !isError ? (
        <>
          <Skeleton height={140} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único destaque da etapa: o resumo do lote, com o número de verdade no botão. */}
      {vaoEntrar > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.resumo}>
            <HeroLabel>
              {vaoEntrar === 1 ? '1 lançamento entra' : `${vaoEntrar} lançamentos entram`}
            </HeroLabel>
            <Money cents={-somaDespesas} variant="money" />
            <ThemedText type="small" themeColor="textSecondary">
              {porRegra} com categoria · {semCategoria} sem
              {repetidos.length
                ? ` · ${repetidos.length} ${repetidos.length === 1 ? 'possível repetido de fora' : 'possíveis repetidos de fora'}`
                : ''}
            </ThemedText>
            <Button
              label={aprovar.isPending ? 'Importando…' : `Confirmar ${vaoEntrar}`}
              loading={aprovar.isPending}
              onPress={confirmarLote}
              block
            />
          </Card>
        </Animated.View>
      ) : null}

      {/* Primeiro na lista: é a única decisão que exige pensar. */}
      {repetidos.length > 0 ? (
        <View style={styles.bloco}>
          <Section title="Possíveis repetidos">{repetidos.map(linha)}</Section>
          <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
            Parecidos com algo que já está no seu financeiro. Dois cafés iguais no mesmo dia são
            legítimos — quem decide é você: toque para revisar, segure para descartar ou confirme um
            por um.
          </ThemedText>
          <Button
            label={`Importar os ${repetidos.length} assim mesmo`}
            variant="secondary"
            size="sm"
            onPress={() =>
              aprovar.mutate(
                repetidos.map((i) => i.id),
                {
                  onSuccess: () =>
                    toast({
                      message: 'Repetidos importados.',
                      tone: 'success',
                    }),
                  onError: () => toast({ message: 'Não deu para importar.', tone: 'error' }),
                }
              )
            }
          />
        </View>
      ) : null}

      {paraRevisar.length > 0 ? (
        <Section title="Para revisar">{paraRevisar.map(linha)}</Section>
      ) : null}

      {revisados.length > 0 ? (
        <View style={styles.bloco}>
          <Button
            label={`Já revisados (${revisados.length})`}
            icon={verRevisados ? 'chevron.up' : 'chevron.down'}
            variant="ghost"
            size="sm"
            onPress={() => setVerRevisados((v) => !v)}
          />
          {verRevisados ? (
            <Section>
              {revisados.map((item) => (
                <Row
                  key={item.id}
                  title={item.description ?? 'Sem descrição'}
                  subtitle={item.status === 'approved' ? 'importado' : 'descartado'}
                  icon={item.status === 'approved' ? 'checkmark.circle' : 'xmark.circle'}
                  chevron={false}
                  trailing={<Money cents={item.amount_cents} variant="headline" tone="plain" />}
                />
              ))}
            </Section>
          ) : null}
        </View>
      ) : null}

      {!isLoading && !isError && vaoEntrar === 0 && repetidos.length === 0 ? (
        <EmptyState
          icon="checkmark.circle"
          title="Tudo revisado"
          hint="O lote fica salvo — dá para voltar nele depois."
          action={{
            label: 'Importar outro arquivo',
            onPress: () => {
              setBatchId(undefined);
              setAccountId(null);
              setFalha(null);
            },
          }}
        />
      ) : null}

      {/* Trocar categoria: sheet, não accordion que empurra a lista. */}
      <Modal
        visible={editando !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditando(null)}
      >
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: theme.separator }]}>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={() => setEditando(null)}>
              <ThemedText type="default" themeColor="tint">
                Cancelar
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.sheetTitulo}>
              {editando?.description ?? 'Categoria'}
            </ThemedText>
            <View style={styles.sheetEspaco} />
          </View>

          <ScrollView
            contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + Space.xxl }]}
          >
            <View style={styles.chips}>
              {SUGGESTED_CATEGORIES.map((cat) => (
                <Chip
                  key={cat}
                  label={cat}
                  selected={editando?.suggested_category === cat}
                  onPress={() =>
                    editando &&
                    trocarCategoria(editando, editando.suggested_category === cat ? null : cat)
                  }
                />
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xl,
  },
  centro: {
    textAlign: 'center',
  },
  resumo: {
    gap: Space.md,
  },
  bloco: {
    gap: Space.md,
  },
  rodape: {
    ...Type.footnote,
    paddingHorizontal: Space.lg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  falha: {
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  trailing: {
    alignItems: 'flex-end',
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
  sheetTitulo: {
    flex: 1,
    textAlign: 'center',
  },
  sheetEspaco: {
    width: 60,
  },
  sheetBody: {
    gap: Space.xl,
    paddingVertical: Space.lg,
  },
});
