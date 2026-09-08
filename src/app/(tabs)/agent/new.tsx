import { useLocalSearchParams } from 'expo-router';

import { ConversationScreen } from '@/components/agent/conversation-screen';

/**
 * Conversa nova.
 *
 * A tela não grava NADA antes do primeiro envio: abrir e voltar não deixa
 * conversa vazia na lista, e é por isso que quem cria a conversa é a própria
 * primeira mensagem. `prompt` chega das frases prontas do estado vazio e só
 * semeia o campo — nem elas criam conversa sozinhas.
 */
export default function NewConversationScreen() {
  const { prompt } = useLocalSearchParams<{ prompt?: string }>();
  return <ConversationScreen initialText={prompt ?? ''} />;
}
