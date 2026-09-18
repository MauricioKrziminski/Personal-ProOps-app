import { useLocalSearchParams } from 'expo-router';

import { ConversationScreen } from '@/components/agent/conversation-screen';
import { ConversationWorkspace } from '@/components/agent/conversation-workspace';

/**
 * Conversa nova.
 *
 * A tela não grava NADA antes do primeiro envio: abrir e voltar não deixa
 * conversa vazia na lista, e é por isso que quem cria a conversa é a própria
 * primeira mensagem. `prompt`, quando fornecido por outro fluxo, só semeia o
 * campo — não cria uma conversa sozinho.
 */
export default function NewConversationScreen() {
  const { prompt } = useLocalSearchParams<{ prompt?: string }>();
  return (
    <ConversationWorkspace>
      <ConversationScreen initialText={prompt ?? ''} />
    </ConversationWorkspace>
  );
}
