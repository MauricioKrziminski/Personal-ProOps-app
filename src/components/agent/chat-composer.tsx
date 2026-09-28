import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth } from '@/constants/theme';

import { TextField } from '@/components/ui/field';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
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
  audioState?: 'idle' | 'starting' | 'recording' | 'transcribing';
  audioReview?: boolean;
  onAudioPress?: () => void;
  onDiscardAudio?: () => void;
  /** Na entrada da aba, o campo pertence ao conteúdo em vez de virar outra dock. */
  inline?: boolean;
}

/** Cinco linhas de 24pt mais o respiro do campo — daí em diante o campo rola. */
const MAX_ALTURA = 24 * 5 + Space.md * 2;
/** O contador só aparece quando falta pouco. */
const AVISO = 200;

/**
 * O mesmo campo de escrita em duas posições: no corpo da conversa vazia e
 * preso acima do teclado quando a conversa já ocupa uma tela de detalhe.
 *
 * `KeyboardStickyView` e não `KeyboardAvoidingView`: é a mesma peça que a barra
 * de blocos da nota usa, e foi conferida levantando esta barra no emulador.
 *
 * O contêiner da lista em `ConversationScreen` reserva a mesma translação,
 * descontando a safe area devolvida por `offset.opened`. Assim sua janela
 * termina acima da barra inclusive quando o campo cresce para várias linhas.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSubmit,
  sending = false,
  awaitingAction = false,
  audioState = 'idle',
  audioReview = false,
  onAudioPress,
  onDiscardAudio,
  inline = false,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [altura, setAltura] = useState(0);

  const reservado = insets.bottom;
  const pode = canSubmitMessage(value, { sending, awaitingAction }) && audioState === 'idle';
  const podeEnviarPelaSeta = pode && !audioReview;
  const vidro = supportsLiquidGlass() && podeEnviarPelaSeta;
  const restantes = MAX_MESSAGE_LENGTH - value.trim().length;

  const conteudo = (
    <View
      style={[
        styles.barra,
        inline
          ? styles.inline
          : {
              paddingBottom: reservado + Space.sm,
              backgroundColor: theme.background,
              borderTopColor: theme.separator,
            },
      ]}>
      {restantes <= AVISO ? (
        <ThemedText
          type="caption"
          style={[styles.counter, tabular, { color: restantes < 0 ? theme.danger : theme.textSecondary }]}>
          {restantes} caracteres restantes
        </ThemedText>
      ) : null}

      {audioReview ? (
        <View style={[styles.revisao, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="footnote">Confira o que entendi do áudio. Corrija o texto antes de pedir ao agente.</ThemedText>
          <Pressable onPress={onDiscardAudio} accessibilityRole="button" accessibilityLabel="Descartar transcrição">
            <ThemedText type="footnote" themeColor="textSecondary">Descartar</ThemedText>
          </Pressable>
        </View>
      ) : awaitingAction ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          Pode corrigir ou complementar a resposta por texto ou áudio.
        </ThemedText>
      ) : null}

      <View style={[styles.linha, inline && styles.linhaInline]}>
        <TextField
          value={value}
          onChangeText={onChangeText}
          placeholder={awaitingAction ? 'Corrija ou complemente aqui' : 'Escreve o que precisa'}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          accessibilityLabel="Mensagem para o agente"
          onContentSizeChange={(e) => setAltura(e.nativeEvent.contentSize.height)}
          style={[
            styles.campo,
            { height: Math.min(Math.max(altura, inline ? HitTarget + Space.xl : HitTarget), MAX_ALTURA) },
          ]}
        />

        {onAudioPress ? (
          <Pressable
            onPress={onAudioPress}
            disabled={sending || audioState === 'starting' || audioState === 'transcribing'}
            accessibilityRole="button"
            accessibilityLabel={audioState === 'recording' ? 'Parar e transcrever áudio' : 'Gravar áudio'}
            accessibilityState={{ disabled: sending || audioState === 'starting' || audioState === 'transcribing' }}
            style={({ pressed }) => [styles.audio, {
              backgroundColor: audioState === 'recording' ? theme.danger : theme.backgroundElement,
              opacity: pressed ? 0.8 : 1,
            }]}>
            {audioState === 'starting' || audioState === 'transcribing' ? (
              <ThemedText type="caption" themeColor="textSecondary">…</ThemedText>
            ) : (
              <Icon name={audioState === 'recording' ? 'stop.fill' : 'mic'} size={20} color={audioState === 'recording' ? 'onTint' : 'text'} />
            )}
          </Pressable>
        ) : null}

        <Pressable
          onPress={onSubmit}
          disabled={!podeEnviarPelaSeta}
          accessibilityRole="button"
          accessibilityLabel="Enviar mensagem"
          accessibilityState={{ disabled: !podeEnviarPelaSeta }}
          style={({ pressed }) => [
            styles.enviar,
            {
              backgroundColor: vidro ? 'transparent' : podeEnviarPelaSeta ? theme.tintFill : theme.backgroundElement,
              opacity: pressed && podeEnviarPelaSeta ? 0.85 : 1,
            },
          ]}>
          {vidro ? (
            <GlassBackdrop fallbackColor={theme.tintFill} radius={Radius.pill} tintColor={theme.glassActionTint} />
          ) : null}
          <Icon
            name="arrow.up"
            size={20}
            color={podeEnviarPelaSeta ? 'onTint' : 'textSecondary'}
          />
        </Pressable>
      </View>
      {audioState === 'recording' ? (
        <ThemedText type="footnote" themeColor="danger">Gravando… Toque no botão vermelho para transcrever.</ThemedText>
      ) : audioState === 'transcribing' ? (
        <ThemedText type="footnote" themeColor="textSecondary">Transcrevendo áudio…</ThemedText>
      ) : null}
      {audioReview ? (
        <Pressable
          onPress={onSubmit}
          disabled={!pode}
          accessibilityRole="button"
          accessibilityLabel="Confirmar transcrição e pedir ao agente"
          accessibilityState={{ disabled: !pode }}
          style={[styles.confirmarAudio, { backgroundColor: pode ? theme.tintFill : theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={{ color: pode ? theme.onTint : theme.textSecondary }}>
            Confirmar texto e pedir ao agente
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );

  if (inline) return conteudo;
  return <KeyboardStickyView offset={{ opened: reservado }}>{conteudo}</KeyboardStickyView>;
}

const styles = StyleSheet.create({
  barra: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inline: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, borderTopWidth: 0 },
  linha: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm },
  linhaInline: { alignItems: 'center' },
  counter: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  revisao: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Space.sm, borderRadius: Radius.md, gap: Space.xs },
  audio: { width: HitTarget, height: HitTarget, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  confirmarAudio: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', minHeight: HitTarget, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.md },
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
