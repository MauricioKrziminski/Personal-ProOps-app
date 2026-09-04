import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConversationRow } from '@/components/agent/conversation-row';
import { RenameConversationSheet } from '@/components/agent/rename-conversation-sheet';
import { ThemedText } from '@/components/themed-text';
import { AppHeader, HeaderIconButton, useAppHeaderHeight } from '@/components/ui/app-header';
import { CURVED_BAR_SPACE } from '@/components/ui/curved-tab-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Radius, Space } from '@/design/tokens';
import {
  useAgentConversations,
  useDeleteAgentConversation,
  useRenameAgentConversation,
} from '@/hooks/use-agent-chat';
import { useTheme } from '@/hooks/use-theme';
import type { AgentConversation } from '@/lib/agent-api';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

/**
 * Três coisas que a pessoa pode pedir, escritas como ela pediria.
 *
 * O empty state precisa de uma dica ACIONÁVEL (`design.md` §7), e num chat a
 * dica é a frase pronta: a tela em branco com um cursor piscando é onde o
 * usuário trava. Cada uma abre `new` com o texto no campo — nenhuma cria linha
 * no servidor, porque abrir e voltar não pode deixar conversa vazia na lista.
 */
const PROMPTS = [
  'Quanto gastei este mês?',
  'Registre R$ 45 no mercado',
  'O que vence esta semana?',
] as const;

export default function AgentScreen() {
  const theme = useTheme();
  const toast = useToast();
  const headerHeight = useAppHeaderHeight();

  const lista = useAgentConversations();
  const renomear = useRenameAgentConversation();
  const excluir = useDeleteAgentConversation();

  const [renomeando, setRenomeando] = useState<AgentConversation | null>(null);

  const conversas = useMemo(
    () => lista.data?.pages.flatMap((p) => p.items) ?? [],
    [lista.data],
  );

  const abrir = useCallback((id: string) => router.push(`/agent/${id}`), []);

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
          label: 'Excluir',
          icon: 'trash',
          destructive: true,
          onPress: () =>
            confirmDestructive(
              'Excluir conversa?',
              'Excluir',
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

  return (
    <Screen scroll={false} grouped topBar={<AppHeader title="Agente" action={<NovaConversa />} />}>
      {lista.isPending ? (
        <View style={[styles.lista, { paddingTop: headerHeight }]}>
          {/* Seis esqueletos com a FORMA da linha, não um spinner: a tela que
              aparece precisa ser a que vai ficar. */}
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={64} radius={Radius.md} />
          ))}
        </View>
      ) : lista.isError ? (
        <View style={{ paddingTop: headerHeight }}>
          <EmptyState
            icon="exclamationmark.triangle"
            title="Não consegui carregar suas conversas"
            hint="Confere a conexão e tenta de novo."
            action={{ label: 'Tentar novamente', onPress: () => lista.refetch() }}
          />
        </View>
      ) : conversas.length === 0 ? (
        <View style={{ paddingTop: headerHeight }}>
          <EmptyState
            title="Comece uma conversa"
            hint="Peça o que quiser em português — eu anoto, lanço e respondo."
          />
          <View style={styles.prompts}>
            {PROMPTS.map((p) => (
              <Pressable
                key={p}
                onPress={() => router.push(`/agent/new?prompt=${encodeURIComponent(p)}`)}
                accessibilityRole="button"
                accessibilityLabel={p}
                style={({ pressed }) => [
                  styles.prompt,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                    borderColor: theme.cardBorder,
                  },
                ]}>
                <ThemedText type="default" numberOfLines={2}>
                  {p}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlashList
          data={conversas}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ConversationRow
              id={item.id}
              title={item.title}
              updatedAt={item.last_message_at}
              onOpen={abrir}
              onLongPress={pedirAcao}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separador} />}
          contentContainerStyle={{
            paddingTop: headerHeight + Space.md,
            paddingHorizontal: Space.lg,
            paddingBottom: CURVED_BAR_SPACE,
          }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            // `isFetchingNextPage` no guarda: sem ele o `onEndReached` dispara
            // várias vezes durante a mesma rolagem e busca a mesma página em
            // paralelo, duplicando linhas na tela.
            if (lista.hasNextPage && !lista.isFetchingNextPage) lista.fetchNextPage();
          }}
        />
      )}

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
  lista: { paddingHorizontal: Space.lg, gap: Space.sm },
  separador: { height: Space.sm },
  prompts: { paddingHorizontal: Space.lg, gap: Space.sm },
  prompt: {
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
