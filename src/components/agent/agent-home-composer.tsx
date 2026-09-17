import { router } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useCreateAgentConversation } from '@/hooks/use-agent-chat';
import { useTheme } from '@/hooks/use-theme';
import { AgentApiError, AgentAuthExpiredError } from '@/lib/agent-api';
import {
  MAX_MESSAGE_LENGTH,
  canSubmitMessage,
  conversationRoute,
  firstMessageAttempt,
} from '@/lib/agent-chat';

/**
 * Envia a primeira mensagem sem criar uma conversa vazia. O UUID fica guardado
 * até a resposta: um retry depois de falha de rede não duplica o lançamento.
 */
export const AgentHomeComposer = memo(function AgentHomeComposer() {
  const theme = useTheme();
  const toast = useToast();
  const { mutate: criar, isPending } = useCreateAgentConversation();
  const [texto, setTexto] = useState('');
  const tentativa = useRef<ReturnType<typeof firstMessageAttempt> | null>(null);
  const podeEnviar = canSubmitMessage(texto, { sending: isPending });

  const enviar = useCallback(() => {
    if (!canSubmitMessage(texto, { sending: isPending })) return;
    const proxima = firstMessageAttempt(texto, tentativa.current);
    tentativa.current = proxima;

    criar(
      proxima,
      {
        onSuccess: (turno) => {
          tentativa.current = null;
          setTexto('');
          router.push(conversationRoute(turno.conversation.id));
        },
        onError: (error) => {
          if (error instanceof AgentAuthExpiredError) return;
          if (error instanceof AgentApiError && error.policy?.paywall) {
            router.push('/paywall');
            return;
          }
          toast({ message: 'Não consegui enviar. Seu texto está aqui para tentar de novo.', tone: 'error' });
        },
      },
    );
  }, [texto, isPending, criar, toast]);

  return (
    <View style={styles.root}>
      <ThemedText type="smallBold">Sua mensagem</ThemedText>
      <View style={styles.composer}>
        <TextField
          value={texto}
          onChangeText={setTexto}
          multiline
          editable={!isPending}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Pergunte ou peça algo"
          accessibilityLabel="Mensagem para o agente"
          accessibilityHint="Descreva uma tarefa ou faça uma pergunta"
          style={styles.field}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar mensagem ao agente"
          accessibilityState={{ disabled: !podeEnviar, busy: isPending }}
          disabled={!podeEnviar}
          onPress={enviar}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: podeEnviar ? theme.tintFill : theme.backgroundElement,
              opacity: pressed && podeEnviar ? 0.78 : 1,
            },
          ]}>
          {isPending ? (
            <ActivityIndicator color={theme.onTint} size="small" />
          ) : (
            <Icon name="arrow.up" size="sm" color={podeEnviar ? 'onTint' : 'textSecondary'} />
          )}
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Space.sm },
  composer: { position: 'relative' },
  field: {
    minHeight: 96,
    maxHeight: 150,
    paddingRight: HitTarget + Space.xl,
    paddingBottom: HitTarget + Space.md,
    textAlignVertical: 'top',
    fontSize: Type.body.fontSize,
  },
  send: {
    position: 'absolute',
    right: Space.md,
    bottom: Space.md,
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
