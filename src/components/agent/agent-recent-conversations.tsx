import { router } from 'expo-router';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { ConversationRow } from '@/components/agent/conversation-row';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { readingPaneWidths } from '@/design/adaptive-window';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useAgentConversations } from '@/hooks/use-agent-chat';
import { useTheme } from '@/hooks/use-theme';

/** Poucas de propósito: a entrada da aba é para começar; o histórico inteiro está a um toque. */
export const RECENTES = 3;

/**
 * As últimas conversas na entrada da aba Agente, com "Ver todas" levando ao histórico.
 *
 * Lê a MESMA consulta da tela de histórico (`useAgentConversations`), então não custa uma ida a
 * mais ao servidor e as duas nunca discordam. Sem conversa o bloco não existe — a pessoa nova vê
 * só o compositor e os atalhos. Em janela larga a lateral (`ConversationSidebar`) já lista tudo,
 * e repetir a lista ao lado dela seria o mesmo dado duas vezes na tela.
 */
export const AgentRecentConversations = memo(function AgentRecentConversations() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const lista = useAgentConversations();
  const abrir = useCallback((id: string) => router.push(`/agent/${id}`), []);

  if (readingPaneWidths(width).twoPane) return null;
  const recentes = lista.data?.pages[0]?.items.slice(0, RECENTES) ?? [];
  // Afirmar "não há conversa" exige a consulta ter dado certo (frontend.md): desligada ou com
  // erro, `!isLoading` também é verdade.
  if (lista.isSuccess && recentes.length === 0) return null;
  /*
    ⚠️ **Carregando, o bloco não existe — nem rótulo, nem esqueleto** (25/09/2026). Era "Recentes"
    sobre três esqueletos, e quem não tinha conversa via o bloco carregar e sumir (*"texto nunca
    deve aparecer em skeleton"*). Esqueleto promete conteúdo, e aqui ele pode não vir. O bloco
    mora no FIM da entrada, abaixo do compositor e dos atalhos: chegar depois não empurra nada.
    Vale também para a consulta DESLIGADA (agente fora deste build), que fica `isPending` para sempre.
  */
  if (lista.isPending) return null;

  return (
    <Animated.View entering={FadeIn.duration(Motion.duration.base).reduceMotion(ReduceMotion.System)} style={styles.root}>
      <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
        Recentes
      </ThemedText>
      {lista.isError ? (
        // A seção que falha diz que falhou (design.md §7) — sem travar o compositor acima.
        <View style={styles.erro}>
          <ThemedText type="small" themeColor="textSecondary">
            Não consegui carregar suas conversas.
          </ThemedText>
          <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => void lista.refetch()} />
        </View>
      ) : (
        <Card style={styles.card}>
          {recentes.map((c) => (
            <ConversationRow
              key={c.id}
              id={c.id}
              title={c.title}
              preview={c.preview ?? null}
              updatedAt={c.last_message_at}
              onOpen={abrir}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver todas as conversas"
            onPress={() => router.push('/agent/history')}
            style={({ pressed }) => [
              styles.verTodas,
              { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
            ]}>
            <ThemedText type="smallBold">Ver todas</ThemedText>
            <Icon name="chevron.right" size="sm" color="textSecondary" />
          </Pressable>
        </Card>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Space.md },
  // Lista de linhas: quem separa uma conversa da outra é a própria linha, não o respiro do card.
  card: { paddingVertical: Space.xs, paddingHorizontal: Space.sm, gap: 0 },
  erro: { gap: Space.md, alignItems: 'flex-start' },
  verTodas: {
    minHeight: HitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.sm,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
});
