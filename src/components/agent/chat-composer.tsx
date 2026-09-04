import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/ui/field';
import { CURVED_BAR_SPACE } from '@/components/ui/curved-tab-bar';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { MAX_MESSAGE_LENGTH, canSubmitMessage } from '@/lib/agent-chat';

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  /** Um turno está rodando: o servidor serializa a conversa e recusaria o próximo. */
  sending?: boolean;
  /** Uma pergunta espera resposta nos botões. */
  awaitingAction?: boolean;
}

/** Cinco linhas de 24pt mais o respiro do campo — daí em diante o campo rola. */
const MAX_ALTURA = 24 * 5 + Space.md * 2;
/** O contador só aparece quando falta pouco. */
const AVISO = 200;

/**
 * A barra de escrita, presa acima do teclado.
 *
 * ⚠️ **Esta barra não sobe sozinha.** Quem cede a altura do teclado é a TELA,
 * num `paddingBottom` na raiz (`ConversationScreen`) — a coluna inteira encolhe,
 * então a lista encolhe junto e a barra acompanha.
 *
 * Foram tentados e devolvidos, os dois conferidos no emulador em 04/09/2026:
 * `KeyboardStickyView` (sobe só a barra, e as mensagens recém-enviadas ficam
 * atrás dela; aqui ele nem chegou a levantar, porque o `KeyboardProvider` roda
 * edge-to-edge e o `adjustResize` do manifest não redimensiona nesse modo) e
 * `KeyboardAvoidingView` (mesma ideia, uma camada a mais, mesmo resultado). Um
 * `paddingBottom` de um número que o próprio `useKeyboardState` dá é menos
 * código e não depende de nenhum dos dois se comportar.
 *
 * O respiro de baixo existe só com o teclado FECHADO: no Android a
 * `CurvedTabBar` é absoluta e passaria por cima do campo. Com o teclado aberto
 * ela está atrás dele, e manter o respiro deixaria uma faixa vazia do tamanho
 * de uma tab bar invisível.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSubmit,
  sending = false,
  awaitingAction = false,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [altura, setAltura] = useState(0);
  const tecladoAberto = useKeyboardHeight() > 0;

  const reservado = tecladoAberto
    ? 0
    : insets.bottom + (Platform.OS === 'android' ? CURVED_BAR_SPACE : 0);
  const pode = canSubmitMessage(value, { sending, awaitingAction });
  const restantes = MAX_MESSAGE_LENGTH - value.trim().length;

  return (
    <View
        style={[
          styles.barra,
          {
            paddingBottom: reservado + Space.sm,
            backgroundColor: theme.background,
            borderTopColor: theme.separator,
          },
        ]}>
        {restantes <= AVISO ? (
          <ThemedText
            type="caption"
            style={[tabular, { color: restantes < 0 ? theme.danger : theme.textSecondary }]}>
            {restantes} caracteres restantes
          </ThemedText>
        ) : null}

        <View style={styles.linha}>
          <TextField
            value={value}
            onChangeText={onChangeText}
            placeholder="Escreve o que precisa"
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            accessibilityLabel="Mensagem para o agente"
            onContentSizeChange={(e) => setAltura(e.nativeEvent.contentSize.height)}
            style={[styles.campo, { height: Math.min(Math.max(altura, HitTarget), MAX_ALTURA) }]}
          />

          <Pressable
            onPress={onSubmit}
            disabled={!pode}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensagem"
            accessibilityState={{ disabled: !pode }}
            style={({ pressed }) => [
              styles.enviar,
              {
                backgroundColor: pode ? theme.tint : theme.backgroundElement,
                opacity: pressed && pode ? 0.85 : 1,
              },
            ]}>
            <Icon
              name="arrow.up"
              size={20}
              color={pode ? 'onTint' : 'textSecondary'}
            />
          </Pressable>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  linha: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm },
  campo: {
    flex: 1,
    // O campo cresce até cinco linhas; a altura vem do conteúdo medido.
    paddingTop: Space.md,
    paddingBottom: Space.md,
    borderRadius: Radius.lg,
    textAlignVertical: 'top',
    fontSize: Type.body.fontSize,
  },
  /** 44pt exatos: é o alvo mínimo de toque, e o botão é redondo. */
  enviar: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
