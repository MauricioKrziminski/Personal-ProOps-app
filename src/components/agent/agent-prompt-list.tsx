import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { ATALHOS_DO_AGENTE } from '@/lib/agent-prompts';

interface Props {
  onSelect: (prompt: string) => void;
}

/** Sugestões da conversa nova; tocar preenche o compositor sem enviar. */
export const AgentPromptList = memo(function AgentPromptList({ onSelect }: Props) {
  const theme = useTheme();
  const vidro = supportsLiquidGlass();

  return (
    <View style={styles.root}>
      <ThemedText type="smallBold" themeColor="textSecondary">Atalhos</ThemedText>
      <View style={styles.list}>
        {ATALHOS_DO_AGENTE.map(({ label, prompt, icon }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`${label}. Preenche a mensagem com texto editável.`}
            onPress={() => onSelect(prompt)}
            style={({ pressed }) => [
              styles.prompt,
              {
                backgroundColor: vidro ? 'transparent' : pressed ? theme.backgroundSelected : theme.surface,
                borderColor: theme.cardBorder,
              },
            ]}>
            {vidro ? <GlassBackdrop fallbackColor={theme.surface} radius={Radius.pill} /> : null}
            <Icon name={icon} size="xs" color="textSecondary" />
            <ThemedText type="small" style={styles.text}>{label}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Space.md },
  list: { width: '100%', maxWidth: 450, flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  /*
    A largura é a do TEXTO, com piso de 40% (no máximo dois por linha) e crescendo para fechar a
    linha. Com `width: '48%'` fixo, a fonte grande partia a palavra ("Lembret/e", 29/09/2026);
    agora o que não cabe na metade desce e ocupa a linha dele.
  */
  prompt: {
    flexGrow: 1,
    flexBasis: 'auto',
    minWidth: '40%',
    maxWidth: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  text: { flexShrink: 1 },
});
