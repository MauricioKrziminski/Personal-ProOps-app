import * as Haptics from 'expo-haptics';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  /** Rótulo de acessibilidade — o campo é só-ícone à esquerda, o placeholder some ao digitar. */
  accessibilityLabel?: string;
}

/**
 * O campo de busca do app, quando a busca **é a tela**.
 *
 * ## Por que existe, se `design.md` §8 diz que busca é nativa
 *
 * A regra continua valendo para busca que **filtra uma lista** — Notas e Lançamentos. Lá o
 * `<Stack.SearchBar>` paga o próprio preço: colapsa no scroll, integra com o large title do iOS
 * e é chrome, não conteúdo.
 *
 * Na tela `/search` a busca não filtra nada: ela É a tela. E aí o componente nativo cobra sem
 * entregar. No Android ele desenha uma laje cinza de **canto 0** — o único elemento do app fora
 * da escala `Radius`, encostado num input de raio 12 e numa fileira de chips em pílula. A API
 * não expõe forma: `barTintColor`, `textColor`, `hintTextColor` e `headerIconColor` mudam cor, e
 * é só. Não dá para consertar por prop; dá para consertar não usando.
 *
 * ## As escolhas
 *
 * - **Pílula, não `Radius.sm`.** Campo de busca é pílula nas duas plataformas (a search bar do
 *   Material 3 e a do iOS 26 são totalmente arredondadas). Não é divergência do `TextField`: é
 *   outro tipo de controle, com convenção própria — e aqui ele ainda rima com os chips logo
 *   abaixo, que são o filtro da mesma busca.
 * - **O "limpar" só aparece com texto.** Botão que não faz nada é ruído, e ele fica exatamente
 *   onde o X do nativo ficava, para quem já pegou o costume.
 * - **`selectionAsync` ao limpar**: é uma ação do usuário com resultado imediato na lista.
 */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField(
  { value, onChangeText, placeholder, autoFocus = false, accessibilityLabel },
  ref
) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundElement }]}>
      <Icon name="magnifyingglass" size="md" color="textSecondary" />

      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={[styles.input, Type.body, { color: theme.text }]}
      />

      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Limpar busca"
          hitSlop={Space.md}
          onPress={() => {
            Haptics.selectionAsync();
            onChangeText('');
          }}>
          <Icon name="xmark.circle" size="md" color="textSecondary" />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  input: {
    flex: 1,
    minHeight: HitTarget,
    // O padding vertical do RN no Android empurra o texto para cima dentro da pílula.
    paddingVertical: 0,
  },
});
