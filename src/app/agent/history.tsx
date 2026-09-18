import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/agent/conversation-row';
import { AgentHistoryHeader } from '@/components/agent/agent-history-header';
import { RenameConversationSheet } from '@/components/agent/rename-conversation-sheet';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';
import {
  useAgentConversations,
  useDeleteAgentConversation,
  useRenameAgentConversation,
} from '@/hooks/use-agent-chat';
import type { AgentConversation } from '@/lib/agent-api';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

export default function AgentHistoryScreen() {
  const toast = useToast();
  const insets = useSafeAreaInsets();

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
  const nova = useCallback(() => router.replace('/agent/new'), []);

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
    <Screen scroll={false} grouped>
      <FlashList
        data={conversas}
        keyExtractor={(c) => c.id}
        renderItem={renderConversa}
        ListHeaderComponent={
          <View style={styles.header}>
            <AgentHistoryHeader onNew={nova} />
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
            <EmptyState
              icon="bubble.left.and.bubble.right"
              title="Nenhuma conversa ainda"
              hint="Quando você conversar com o agente, o histórico aparece aqui."
            />
          )
        }
        contentContainerStyle={{
          paddingTop: Space.sm,
          paddingHorizontal: Space.lg,
          paddingBottom: insets.bottom + Space.xxl,
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
  return (
    <View style={styles.retry}>
      <ThemedText type="small" themeColor="textSecondary">
        Não consegui carregar suas conversas.
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: Space.xl },
  loading: { gap: Space.sm },
  retry: { gap: Space.md, paddingVertical: Space.md, alignItems: 'flex-start' },
});
