import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Fonts } from '@/constants/theme';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { ParDaConversa } from '@/lib/activity-feed';

/** Sem frase, o balão diz o TIPO do que chegou — nunca uma frase atribuída à pessoa. */
const SEM_TEXTO: Record<ParDaConversa['entrada'], string> = {
  text: 'mensagem',
  audio: 'áudio',
  image: 'foto',
  document: 'documento',
  click: 'toque num botão',
};

/** Acima disto o balão mostra a prévia e um "mais" que abre no lugar (prévia de corpo, §7). */
const LIMITE = 180;
const PREVIA = 160;

/**
 * A fala da pessoa: balão de tinta à direita, o texto REAL que ela mandou, e o carimbo do canal.
 */
export function MessageBubble({
  texto,
  entrada,
  canal,
  hora,
  onPress,
}: {
  texto: string | null;
  entrada: ParDaConversa['entrada'];
  canal: 'whatsapp' | 'app';
  hora: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const [aberto, setAberto] = useState(false);
  const longo = (texto?.length ?? 0) > LIMITE || (texto?.split('\n').length ?? 0) > 4;
  const mostrado =
    texto == null ? SEM_TEXTO[entrada] : !longo || aberto ? texto : `${texto.slice(0, PREVIA).trimEnd()}…`;
  const canalTexto = canal === 'whatsapp' ? 'WhatsApp' : 'App';

  return (
    <View style={styles.coluna}>
      <Pressable
        disabled={!onPress && !(longo && !aberto)}
        accessibilityRole={onPress || (longo && !aberto) ? 'button' : 'text'}
        accessibilityLabel={`Você, ${canalTexto}, ${hora}: ${texto ?? SEM_TEXTO[entrada]}`}
        accessibilityHint={longo && !aberto ? 'Mostra a mensagem inteira' : onPress ? 'Abre a conversa' : undefined}
        onPress={() => (longo && !aberto ? setAberto(true) : onPress?.())}
        style={({ pressed }) => [styles.balao, { backgroundColor: theme.bubble, opacity: pressed ? 0.85 : 1 }]}>
        {entrada === 'audio' ? (
          <View style={styles.audio}>
            <Icon name="waveform" size="xs" color="onBubble" />
            <ThemedText type="caption" themeColor="onBubble">
              áudio
            </ThemedText>
          </View>
        ) : null}
        <ThemedText type="default" themeColor="onBubble" style={[styles.texto, texto == null && styles.italico]}>
          {mostrado}
        </ThemedText>
        {longo && !aberto ? (
          <ThemedText type="caption" themeColor="onBubble" style={styles.mais}>
            mais
          </ThemedText>
        ) : null}
      </Pressable>
      <View style={styles.carimbo}>
        <Icon name={canal === 'whatsapp' ? 'bubble.left' : 'iphone'} size="xs" color="textSecondary" />
        <ThemedText type="caption" themeColor="textSecondary">
          {`${canalTexto} · ${hora}`}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  coluna: { alignItems: 'flex-end', gap: Space.xs },
  balao: {
    maxWidth: '86%',
    gap: Space.xs,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderBottomRightRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  // Dentro de container com `entering`: sem encolher, quebrando na largura do balão (§3).
  texto: { flexShrink: 0, maxWidth: '100%' },
  italico: { fontFamily: Fonts.italic },
  mais: { textDecorationLine: 'underline' },
  audio: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  carimbo: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingRight: Space.xs },
});
