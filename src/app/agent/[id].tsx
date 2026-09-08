import { useLocalSearchParams } from 'expo-router';

import { ConversationScreen } from '@/components/agent/conversation-screen';
import { useAgentConversations } from '@/hooks/use-agent-chat';

/**
 * Uma conversa existente.
 *
 * O título sai da LISTA já em cache — a rota de mensagens não devolve o nome da
 * conversa, e uma requisição a mais só para escrever o header faria a barra
 * piscar de vazia para preenchida em toda abertura.
 */
export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lista = useAgentConversations();
  const titulo = lista.data?.pages
    .flatMap((p) => p.items)
    .find((c) => c.id === id)?.title;

  return <ConversationScreen conversationId={id} title={titulo} />;
}
