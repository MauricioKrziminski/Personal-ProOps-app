import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { TextField } from '@/components/ui/field';
import { CURVED_BAR_SPACE } from '@/components/ui/curved-tab-bar';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
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
 * `KeyboardStickyView` e não `KeyboardAvoidingView`: é a mesma peça que a barra
 * de blocos da nota usa, e foi conferida levantando esta barra no emulador.
 *
 * **A barra subir não basta.** A lista não encolhe junto, então as mensagens
 * recém-enviadas ficavam ATRÁS dela — quem devolve a altura do teclado é o
 * rodapé do `contentContainerStyle` em `ConversationScreen`. As duas metades
 * são necessárias; nenhuma sozinha resolve.
 *
 * O respiro de baixo é reservado com o teclado FECHADO (no Android a
 * `CurvedTabBar` é absoluta e passaria por cima do campo) e devolvido com ele
 * ABERTO pelo `offset.opened` — senão sobraria uma faixa vazia entre o campo e
 * o teclado, do tamanho exato de uma tab bar que nem está visível.
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


  const reservado =
    insets.bottom + (Platform.OS === 'android' ? CURVED_BAR_SPACE : 0);
  const pode = canSubmitMessage(value, { sending, awaitingAction });
  const restantes = MAX_MESSAGE_LENGTH - value.trim().length;

  return (
    <KeyboardStickyView offset={{ opened: reservado }}>
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
    </KeyboardStickyView>
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
