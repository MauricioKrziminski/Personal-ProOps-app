import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { SUGGESTED_CATEGORIES } from '@/lib/categories';
import {
  useAccounts,
  useApproveImportItems,
  useDiscardImportItems,
  useImportItems,
  useImportStatement,
  useUpdateImportItem,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** Só o que dá para parsear no servidor. PDF e foto entram pelo WhatsApp. */
const ACCEPTED = [
  'application/x-ofx',
  'application/vnd.intu.qfx',
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'text/plain',
  '*/*',
];

export default function ImportScreen() {
  const theme = useTheme();
  const { data: accounts } = useAccounts();
  const importar = useImportStatement();
  const [batchId, setBatchId] = useState<string | undefined>();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  const { data: items, isLoading, isError, refetch } = useImportItems(batchId);
  const aprovar = useApproveImportItems();
  const descartar = useDiscardImportItems();
  const atualizar = useUpdateImportItem();

  const pendentes = (items ?? []).filter((i) => i.status === 'pending' || i.status === 'duplicate');
  const totalPendente = pendentes.reduce(
    (soma, i) => soma + (i.kind === 'expense' ? i.amount_cents : 0),
    0,
  );

  const escolherArquivo = async () => {
    const escolha = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (escolha.canceled) return;

    const arquivo = escolha.assets[0];
    const ehOfx = /\.(ofx|qfx)$/i.test(arquivo.name);
    try {
      // SDK 57: leitura por `new File(uri).text()` (readAsStringAsync é legado)
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
      Alert.alert(
        'Não deu para importar',
        'Confira se o arquivo é um extrato OFX ou CSV do seu banco.\n\n' + String(err),
      );
    }
  };

  const aprovarTodos = () => {
    const ids = pendentes.filter((i) => i.status === 'pending').map((i) => i.id);
    if (!ids.length) return;
    Alert.alert('Confirmar importação', `Lançar ${ids.length} itens no seu financeiro?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          aprovar.mutate(ids);
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {!batchId && (
            <GlassCard style={styles.intro}>
              <ThemedText style={styles.emoji}>📥</ThemedText>
              <ThemedText type="smallBold">Traga o extrato do seu banco</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Exporte o extrato em <ThemedText type="smallBold">OFX</ThemedText> ou{' '}
                <ThemedText type="smallBold">CSV</ThemedText> no app do banco e escolha o arquivo
                aqui. Eu categorizo tudo e você confere antes de entrar.
                {'\n\n'}
                Foto de cupom e PDF de fatura? Manda direto no WhatsApp.
              </ThemedText>

              {(accounts ?? []).length > 0 && (
                <>
                  <ThemedText type="smallBold">Lançar na conta</ThemedText>
                  <View style={styles.chipRow}>
                    {(accounts ?? []).map((conta) => (
                      <Chip
                        key={conta.id}
                        label={conta.name}
                        selected={accountId === conta.id}
                        onPress={() => setAccountId(accountId === conta.id ? null : conta.id)}
                      />
                    ))}
                  </View>
                </>
              )}

              <Pressable
                onPress={escolherArquivo}
                disabled={importar.isPending}
                style={({ pressed }) => [
                  styles.submit,
                  {
                    backgroundColor: theme.tint,
                    opacity: pressed || importar.isPending ? 0.7 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {importar.isPending ? 'Lendo o arquivo…' : 'Escolher arquivo'}
                </ThemedText>
              </Pressable>
            </GlassCard>
          )}

          {batchId && (
            <>
              {isError && <ErrorCard onRetry={refetch} />}
              {isLoading && !isError && <LoadingCard />}

              {pendentes.length > 0 && (
                <GlassCard style={styles.resumo}>
                  <ThemedText type="smallBold">
                    {pendentes.length} lançamentos para revisar
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Gastos somando {formatBRL(totalPendente)}. Toque num item para trocar a
                    categoria; segure para descartar.
                  </ThemedText>
                  <Pressable
                    onPress={aprovarTodos}
                    disabled={aprovar.isPending}
                    style={({ pressed }) => [
                      styles.submit,
                      { backgroundColor: theme.tint, opacity: pressed || aprovar.isPending ? 0.7 : 1 },
                    ]}>
                    <ThemedText type="smallBold" style={styles.buttonLabel}>
                      {aprovar.isPending ? 'Importando…' : 'Confirmar todos'}
                    </ThemedText>
                  </Pressable>
                </GlassCard>
              )}

              {(items ?? []).map((item, index) => (
                <Animated.View
                  key={item.id}
                  entering={FadeInDown.duration(400).delay(Math.min(index * 30, 400))}>
                  <Pressable
                    onPress={() => setEditando(editando === item.id ? null : item.id)}
                    onLongPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      descartar.mutate([item.id]);
                    }}>
                    <GlassCard style={styles.item}>
                      <View style={styles.itemLinha}>
                        <View style={styles.itemTexto}>
                          <ThemedText type="small" numberOfLines={1}>
                            {item.status === 'duplicate' ? '⚠️ ' : ''}
                            {item.status === 'approved' ? '✅ ' : ''}
                            {item.status === 'discarded' ? '🚫 ' : ''}
                            {item.description ?? 'Sem descrição'}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {formatDateBR(item.occurred_at)}
                            {item.suggested_category ? ` · #${item.suggested_category}` : ' · sem categoria'}
                            {item.status === 'duplicate' ? ' · já existe no extrato' : ''}
                          </ThemedText>
                        </View>
                        <ThemedText
                          type="smallBold"
                          style={{ color: item.kind === 'income' ? theme.success : theme.danger }}>
                          {item.kind === 'income' ? '+' : '−'}
                          {formatBRL(item.amount_cents)}
                        </ThemedText>
                      </View>

                      {editando === item.id && (
                        <View style={styles.chipRow}>
                          {SUGGESTED_CATEGORIES.map((cat) => (
                            <Chip
                              key={cat}
                              label={cat}
                              selected={item.suggested_category === cat}
                              onPress={() => {
                                atualizar.mutate({
                                  id: item.id,
                                  category: item.suggested_category === cat ? null : cat,
                                });
                                setEditando(null);
                              }}
                            />
                          ))}
                        </View>
                      )}
                    </GlassCard>
                  </Pressable>
                </Animated.View>
              ))}

              {!isLoading && pendentes.length === 0 && (
                <GlassCard style={styles.intro}>
                  <ThemedText style={styles.emoji}>✅</ThemedText>
                  <ThemedText type="smallBold">Tudo revisado</ThemedText>
                  <Pressable
                    onPress={() => {
                      setBatchId(undefined);
                      setAccountId(null);
                    }}
                    style={({ pressed }) => [
                      styles.submit,
                      { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
                    ]}>
                    <ThemedText type="smallBold" style={styles.buttonLabel}>
                      Importar outro arquivo
                    </ThemedText>
                  </Pressable>
                </GlassCard>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    width: '100%',
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  intro: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.five,
  },
  resumo: {
    gap: Spacing.two,
  },
  emoji: {
    fontSize: 40,
  },
  centered: {
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  item: {
    gap: Spacing.two,
  },
  itemLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  itemTexto: {
    flex: 1,
    gap: Spacing.half,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  buttonLabel: {
    color: '#fff',
  },
});
