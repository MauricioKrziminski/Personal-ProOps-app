import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ComNegrito } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { Radius, Space } from '@/design/tokens';
import { useReportarResposta } from '@/hooks/use-agent-chat';
import { useTheme } from '@/hooks/use-theme';
import type { MotivoDoRelato } from '@/lib/agent-api';
import { showItemActions } from '@/lib/item-actions';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  /** Com os dois ids (mensagem do servidor, não `local:`), a resposta ganha o botão de reportar. */
  conversationId?: string;
  messageId?: string;
}

/**
 * Um balão da conversa.
 *
 * A fala da pessoa é tinta sólida; a resposta fica no papel, com uma assinatura
 * discreta de remetente. Isso separa as vozes sem empilhar cartões.
 *
 * `selectable`: um lançamento, um valor ou um nome de conta são coisas que se
 * copiam. Sem isso o texto do agente é a única parte do app da qual não dá para
 * tirar nada.
 *
 * Memoizado e recebendo só primitives: a lista rerenderiza a cada tecla do
 * composer, e sem isso toda a conversa remonta a cada letra digitada.
 */
export const ChatMessage = memo(function ChatMessage({ role, content, conversationId, messageId }: Props) {
  const theme = useTheme();
  const meu = role === 'user';
  const reportavel = !meu && !!conversationId && !!messageId && !messageId.startsWith('local:');

  return (
    <View style={[styles.linha, meu ? styles.direita : styles.esquerda]}>
      <View
        style={[
          styles.corpo,
          meu && [
            styles.balao,
            { backgroundColor: theme.bubble },
          ],
        ]}>
        {!meu ? (
          <View style={styles.cabecalho}>
            <ThemedText type="caption" themeColor="textSecondary">
              Agente
            </ThemedText>
            {reportavel ? (
              <ReportarResposta conversationId={conversationId} messageId={messageId} />
            ) : null}
          </View>
        ) : null}
        <ThemedText type="default" themeColor={meu ? 'onBubble' : 'text'} selectable>
          {/*
            O motor é compartilhado com o WhatsApp e escreve `*R$ 45,00*`. Sem
            esta tradução o app mostraria o asterisco em volta de todo valor.
            O negrito é o MESMO do resto do app (`ComNegrito`, `components/ui/forte.tsx`).
          */}
          <ComNegrito texto={content} />
        </ThemedText>
      </View>
    </View>
  );
});

/** Política de IA da loja: a pessoa reporta a resposta sem sair do app. */
function ReportarResposta({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const toast = useToast();
  const reportar = useReportarResposta(conversationId, messageId);
  const enviar = (reason: MotivoDoRelato) =>
    reportar.mutate(reason, {
      onSuccess: () => toast({ message: 'Obrigado. Vamos analisar essa resposta.', tone: 'success' }),
      onError: () => toast({ message: 'Não deu para enviar agora. Tente de novo.', tone: 'error' }),
    });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Reportar resposta"
      hitSlop={Space.lg}
      disabled={reportar.isPending}
      onPress={() =>
        showItemActions('Reportar resposta', [
          { label: 'Ofensiva ou inadequada', onPress: () => enviar('ofensiva') },
          { label: 'Informação errada', onPress: () => enviar('errada') },
          { label: 'Outro motivo', onPress: () => enviar('outra') },
        ])
      }>
      <Icon name="flag" size="xs" color="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row' },
  direita: { justifyContent: 'flex-end' },
  esquerda: { justifyContent: 'flex-start' },
  /*
    `maxWidth` em porcentagem, não em pontos: o balão precisa encolher junto com
    a tela. Sem teto, uma mensagem longa do usuário encosta nas duas bordas e a
    conversa perde o lado que diz quem falou.
  */
  corpo: { maxWidth: '88%', flexShrink: 1 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  balao: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
});
