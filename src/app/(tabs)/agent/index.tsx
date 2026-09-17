import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConversationRow } from '@/components/agent/conversation-row';
import { AgentHomeHeader } from '@/components/agent/agent-home-header';
import { RenameConversationSheet } from '@/components/agent/rename-conversation-sheet';
import { ThemedText } from '@/components/themed-text';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { TAB_BAR_SPACE } from '@/components/ui/pill-tab-bar';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  useAgentConversations,
  useDeleteAgentConversation,
  useRenameAgentConversation,
} from '@/hooks/use-agent-chat';
import type { AgentConversation } from '@/lib/agent-api';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

export default function AgentScreen() {
  const toast = useToast();

  const lista = useAgentConversations();
  const { refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = lista;
  const renomear = useRenameAgentConversation();
  const excluir = useDeleteAgentConversation();

  const [renomeando, setRenomeando] = useState<AgentConversation | null>(null);
  const [puxando, setPuxando] = useState(false);

  const conversas = useMemo(
    () => lista.data?.pages.flatMap((p) => p.items) ?? [],
    [lista.data],
  );

  const abrir = useCallback((id: string) => router.push(`/agent/${id}`), []);
  const nova = useCallback(() => router.push('/agent/new'), []);
  const abrirPrompt = useCallback(
    (prompt: string) => router.push(`/agent/new?prompt=${encodeURIComponent(prompt)}`),
    [],
  );

  const pedirAcao = useCallback(
    (id: string) => {
      const conversa = conversas.find((c) => c.id === id);
      if (!conversa) return;
      showItemActions(conversa.title, [
        {
          label: 'Renomear',
          icon: 'pencil',
          onPress: () => setRenomeando(conversa),
        },
        {
          label: 'Apagar',
          icon: 'trash',
          destructive: true,
          onPress: () =>
            confirmDestructive(
              'Excluir conversa?',
              'Apagar',
              () =>
                excluir.mutate(conversa.id, {
                  onError: () =>
                    toast({ message: 'Não deu para excluir a conversa.', tone: 'error' }),
                }),
              // Dizer o que some, e não só "não dá para desfazer": o histórico e
              // as confirmações pendentes vão junto, e isso não é óbvio.
              'O histórico e as confirmações pendentes desta conversa serão apagados.',
            ),
        },
      ]);
    },
    [conversas, excluir, toast],
  );

  const renderConversa = useCallback(
    ({ item }: { item: AgentConversation }) => (
      <ConversationRow
        id={item.id}
        title={item.title}
        preview={item.preview ?? null}
        updatedAt={item.last_message_at}
        onOpen={abrir}
        onLongPress={pedirAcao}
      />
    ),
    [abrir, pedirAcao],
  );
  const atualizar = useCallback(() => {
    setPuxando(true);
    refetch().finally(() => setPuxando(false));
  }, [refetch]);
  const carregarMais = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <Screen scroll={false} grouped topBar={<AppHeader title="Agente" action={<NovaConversa />} />}>
      <FlashList
        data={conversas}
        keyExtractor={(c) => c.id}
        renderItem={renderConversa}
        ListHeaderComponent={
          <View style={styles.header}>
            <AgentHomeHeader onNew={nova} onPrompt={abrirPrompt} />
            <BlockHeader title="Suas conversas" count={conversas.length} />
          </View>
        }
        ListEmptyComponent={
          lista.isPending ? (
            <View style={styles.loading} accessibilityLabel="Carregando conversas">
              <Skeleton height={56} />
              <Skeleton height={56} />
            </View>
          ) : lista.isError ? (
            <RetryConversations onPress={() => void refetch()} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              Suas conversas vão aparecer aqui.
            </ThemedText>
          )
        }
        contentContainerStyle={{
          paddingTop: Space.sm,
          paddingHorizontal: Space.lg,
          paddingBottom: TAB_BAR_SPACE,
          width: '100%',
          maxWidth: MaxContentWidth,
          alignSelf: 'center',
        }}
        refreshing={puxando}
        onRefresh={atualizar}
        onEndReachedThreshold={0.5}
        onEndReached={carregarMais}
      />

      <RenameConversationSheet
        // Remonta a cada conversa: é o que faz o campo abrir com o título CERTO
        // em vez do da conversa anterior.
        key={renomeando?.id ?? 'nenhuma'}
        visible={renomeando !== null}
        initialTitle={renomeando?.title ?? ''}
        saving={renomear.isPending}
        onClose={() => setRenomeando(null)}
        onSave={(titulo) => {
          if (!renomeando) return;
          renomear.mutate(
            { id: renomeando.id, title: titulo },
            {
              onSuccess: () => setRenomeando(null),
              onError: () =>
                toast({ message: 'Não deu para renomear a conversa.', tone: 'error' }),
            },
          );
        }}
      />
    </Screen>
  );
}

function RetryConversations({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.retry}>
      <ThemedText type="small" themeColor="textSecondary">
        Não consegui carregar suas conversas.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.retryButton,
          { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <ThemedText type="smallBold">Tentar de novo</ThemedText>
      </Pressable>
    </View>
  );
}

function NovaConversa() {
  return (
    <HeaderIconButton
      icon="plus"
      label="Nova conversa"
      onPress={() => router.push('/agent/new')}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: Space.xxl, paddingBottom: Space.sm },
  loading: { gap: Space.sm },
  empty: { paddingVertical: Space.md },
  retry: { gap: Space.md, paddingVertical: Space.md, alignItems: 'flex-start' },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
});
