import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConversationRow } from '@/components/agent/conversation-row';
import { ThemedText } from '@/components/themed-text';
import { BlockHeader } from '@/components/ui/block-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Space } from '@/design/tokens';
import { useAgentConversations } from '@/hooks/use-agent-chat';
import type { AgentConversation } from '@/lib/agent-api';

/** The same cached conversation index stays visible beside a thread on a wide tablet. */
export function ConversationSidebar({ selectedId }: { selectedId?: string }) {
  const query = useAgentConversations();
  const conversations = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const open = useCallback((id: string) => {
    if (id !== selectedId) router.replace(`/agent/${id}`);
  }, [selectedId]);
  const renderConversation = useCallback(
    ({ item }: { item: AgentConversation }) => (
      <ConversationRow
        id={item.id}
        title={item.title}
        preview={item.preview ?? null}
        updatedAt={item.last_message_at}
        selected={item.id === selectedId}
        onOpen={open}
      />
    ),
    [open, selectedId],
  );

  return (
    <FlashList
      style={styles.list}
      data={conversations}
      keyExtractor={(item) => item.id}
      renderItem={renderConversation}
      ListHeaderComponent={
        <View style={styles.header}>
          <BlockHeader title="Conversas" count={conversations.length} />
          {selectedId ? (
            <Button label="Nova conversa" icon="plus" variant="secondary" onPress={() => router.push('/agent/new')} />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        query.isPending ? (
          <View style={styles.empty}><Skeleton height={64} /><Skeleton height={64} /></View>
        ) : query.isError ? (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary">Não consegui carregar suas conversas.</ThemedText>
            <Button label="Tentar de novo" variant="secondary" onPress={() => void query.refetch()} />
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Comece uma conversa para vê-la aqui.
          </ThemedText>
        )
      }
      contentContainerStyle={styles.content}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { padding: Space.lg, paddingBottom: Space.xxxl },
  header: { gap: Space.lg, paddingBottom: Space.md },
  empty: { gap: Space.md, paddingVertical: Space.lg },
});
