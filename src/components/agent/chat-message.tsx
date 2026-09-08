import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { parseInlineBold } from '@/lib/agent-chat';

interface Props {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Um balão da conversa.
 *
 * **Só o que a pessoa escreveu vira balão.** A resposta do agente é texto
 * corrido à esquerda, como no Things e no Apple Mail: encaixotar os dois lados
 * transformaria a tela numa pilha de cards e faria a resposta — que é a parte
 * que se lê — competir por atenção com a pergunta, que a pessoa já conhece.
 * `design.md` §1: "todo o resto é opaco, hierarquia por elevação e espaço".
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
            { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
          ],
        ]}>
        <ThemedText type="default" selectable>
          {/*
            O motor é compartilhado com o WhatsApp e escreve `*R$ 45,00*`. Sem
            esta tradução o app mostraria o asterisco em volta de todo valor.
            Peso é FAMÍLIA, nunca `fontWeight` (`design.md` §3): fonte custom no
            Android ignora `fontWeight` e cai no regular com bold sintético.
          */}
          {parseInlineBold(content).map((t, i) => (
            <Text key={i} style={t.bold ? styles.forte : undefined}>
              {t.text}
            </Text>
          ))}
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
  corpo: { maxWidth: '86%', flexShrink: 1 },
  forte: { fontFamily: Fonts.semibold },
  balao: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
