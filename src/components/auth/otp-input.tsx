import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Chamado quando o sexto dígito entra — o usuário não deve precisar apertar nada. */
  onComplete: (code: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
}

/**
 * O campo de código de 6 dígitos.
 *
 * Antes era um `TextInput` comum com placeholder `000000`, e ele custava três coisas:
 *
 * 1. **Sem preenchimento automático no iOS.** O `autoComplete="sms-otp"` é Android-only; quem
 *    liga o "colar do teclado" do iPhone é `textContentType="oneTimeCode"`. Sem ele o usuário
 *    saía do app para ler o código — que é exatamente o momento em que um fluxo de OTP morre.
 * 2. **Sem auto-submit.** Digitar 6 dígitos e ainda ter que mirar num botão é um toque a mais
 *    num fluxo que tem exatamente um resultado possível.
 * 3. **Sem progresso.** Uma caixa com `123` não diz quantos faltam; seis caixas dizem.
 *
 * ## Um input, seis caixas
 *
 * As caixas são desenho. Quem recebe o texto é UM `TextInput` transparente esticado por cima
 * delas — é o que mantém seleção, teclado, colar e autofill nativos funcionando (um input por
 * caixa quebra os quatro, e ainda obriga a gerenciar foco na mão a cada `backspace`).
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid = false,
  autoFocus = false,
  editable = true,
}: OtpInputProps) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const digits = value.split('');
  const active = Math.min(value.length, LENGTH - 1);

  const caret = useSharedValue(1);
  useEffect(() => {
    caret.set(
      withRepeat(
        withSequence(
          withTiming(0, { duration: 520, easing: Motion.easing.inOut }),
          withTiming(1, { duration: 520, easing: Motion.easing.inOut })
        ),
        -1,
        true
      )
    );
  }, [caret]);
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.get() }));

  const handle = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, LENGTH);
    if (next === value) return;
    onChange(next);
    if (next.length === LENGTH) {
      // Um haptic, no encaixe — não um por dígito: o teclado já dá feedback de tecla.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onComplete(next);
    }
  };

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessibilityLabel="Código de 6 dígitos"
      accessibilityRole="none">
      <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: LENGTH }).map((_, i) => {
          const filled = i < value.length;
          const isActive = editable && i === active && value.length < LENGTH;
          return (
            <View
              key={i}
              style={[
                styles.box,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: invalid
                    ? theme.danger
                    : isActive
                      ? theme.text
                      : theme.separator,
                  borderWidth: isActive || invalid ? 2 : StyleSheet.hairlineWidth,
                },
              ]}>
              {filled ? (
                <ThemedText style={[Type.title2, tabular]}>{digits[i]}</ThemedText>
              ) : isActive ? (
                <Animated.View style={[styles.caret, caretStyle, { backgroundColor: theme.text }]} />
              ) : null}
            </View>
          );
        })}
      </View>

      <TextInput
        ref={input}
        value={value}
        onChangeText={handle}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        maxLength={LENGTH}
        // Os dois: `sms-otp` é o Android, `oneTimeCode` é o iOS. Ter só um deixa metade dos
        // usuários digitando à mão um código que o sistema já leu.
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        importantForAutofill="yes"
        caretHidden
        style={[styles.hidden, Platform.OS === 'android' && styles.hiddenAndroid]}
        accessibilityLabel="Código de 6 dígitos recebido no WhatsApp"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  box: {
    flex: 1,
    height: 56,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caret: {
    width: 2,
    height: 24,
    borderRadius: Radius.xs,
  },
  /**
   * Cobre as caixas inteiras para que o toque em qualquer uma foque o campo — e para que o
   * autofill do sistema tenha um alvo com área real (input de 0×0 é ignorado por ele).
   */
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
  /** No Android um input totalmente transparente perde o toque; 0.01 mantém a área ativa. */
  hiddenAndroid: {
    opacity: 0.01,
  },
});
