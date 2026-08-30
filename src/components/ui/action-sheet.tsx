import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { registerAndroidSheet, showItemActions, type ItemAction } from '@/lib/item-actions';

interface SheetState {
  title: string;
  message?: string;
  actions: ItemAction[];
}

/**
 * Menu de ações do Android.
 *
 * Existe porque `Alert` do Android **corta silenciosamente a partir do terceiro botão** — um menu
 * com quatro opções perde a última, que costuma ser justamente a destrutiva. Um menu com uma
 * pasta por linha (mover nota) estoura sempre.
 *
 * No iOS nada disto renderiza: lá o `showItemActions` usa `ActionSheetIOS` nativo.
 */
export function AndroidActionSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<SheetState | null>(null);

  useEffect(() => registerAndroidSheet(setSheet), []);

  const close = () => setSheet(null);

  return (
    <Modal
      visible={!!sheet}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}>
      <Pressable
        accessibilityLabel="Fechar"
        style={[styles.scrim, { backgroundColor: theme.overlay }]}
        onPress={close}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: theme.surfaceRaised, paddingBottom: insets.bottom + Space.md },
        ]}>
        {sheet?.title ? (
          <ThemedText type="smallBold" style={styles.title} numberOfLines={2}>
            {sheet.title}
          </ThemedText>
        ) : null}
        {sheet?.message ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.title}>
            {sheet.message}
          </ThemedText>
        ) : null}

        <ScrollView bounces={false} style={styles.list}>
          {(sheet?.actions ?? []).map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!action.disabled }}
              disabled={action.disabled}
              onPress={() => {
                close();
                // Submenu abre um segundo sheet; entrada normal executa. O `close()` antes é o
                // que deixa o segundo entrar sem os dois empilhados na tela.
                if (action.actions?.length) showItemActions(action.label, action.actions);
                else action.onPress?.();
              }}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <ThemedText
                type="default"
                themeColor={
                  action.disabled ? 'textSecondary' : action.destructive ? 'danger' : 'text'
                }
                style={styles.optionLabel}>
                {action.actions?.length ? `${action.label}…` : action.label}
              </ThemedText>
              {/* Estado ligado é ÍCONE, não glyph de texto (`design.md` §4). */}
              {action.selected ? <Icon name="checkmark" size="sm" color="tint" /> : null}
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={close}
          style={({ pressed }) => [
            styles.option,
            { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
          ]}>
          <ThemedText type="default" themeColor="textSecondary">
            Cancelar
          </ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderCurve: 'continuous',
    paddingTop: Space.lg,
  },
  title: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.sm,
  },
  list: {
    maxHeight: 320,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
    minHeight: 52,
  },
  /** O rótulo empurra o check para a direita. */
  optionLabel: {
    flex: 1,
  },
});
