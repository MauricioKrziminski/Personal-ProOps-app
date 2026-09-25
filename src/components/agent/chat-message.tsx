import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ComNegrito } from '@/components/ui/forte';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  role: 'user' | 'assistant';
  content: string;
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
export const ChatMessage = memo(function ChatMessage({ role, content }: Props) {
  const theme = useTheme();
  const meu = role === 'user';

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
          <ThemedText type="caption" themeColor="textSecondary" style={styles.remetente}>
            Agente
          </ThemedText>
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
  remetente: { marginBottom: Space.sm },
  balao: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
});
