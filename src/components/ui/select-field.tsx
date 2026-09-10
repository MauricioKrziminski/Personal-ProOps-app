import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Icon, type IconName } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { Elevation, Motion, Radius, Space, Type } from '@/design/tokens';

export type SelectOption = {
  /** `null` é a opção "nenhum" — ela existe se você a incluir na lista. */
  id: string | null;
  label: string;
  /** Segunda linha: o que DISTINGUE esta opção das outras. */
  meta?: string;
  icon?: IconName;
  /** Cabeçalho que precede esta opção. Repetido em opções seguidas, desenha uma vez. */
  group?: string;
  /**
   * A opção não representa uma entidade (é "nenhum", "todos"): o glifo dela não
   * acende no accent quando escolhida. Sem isso, "Não informar" selecionado
   * vira o elemento mais gritante da tela — e ele é a AUSÊNCIA de escolha.
   */
  neutral?: boolean;
};

/**
 * Escolher UM item de uma lista curta, dentro de um formulário.
 *
 * ## Por que colapsado
 *
 * A primeira versão nascia aberta, e com seis contas ela ocupava meia tela antes
 * de o usuário pedir qualquer coisa — a queixa foi literal: *"ele aberto já logo
 * de cara assim, nao é muito clean"*. Campo de formulário mostra o VALOR; a
 * lista é o que aparece quando você vai trocá-lo.
 *
 * ## Por que abre no lugar, e não num sheet
 *
 * `formSheet` seria o mecanismo natural para "escolha curta" (§8 do design), mas
 * **quatro dos formulários que usam este campo já vivem dentro de um `Sheet`** —
 * recorrentes, dívidas (×3), regras e importação. `Modal` dentro de `Modal` no
 * Android é uma janela dentro de outra, com o teclado e o botão voltar
 * disputando qual delas fecha. Abrir no lugar não tem esse problema e mantém o
 * resto do formulário à vista, que é o que a pessoa está preenchendo.
 *
 * ## Um campo, todas as telas
 *
 * O padrão anterior era `<Row title={x.name}/>` em quatro telas e `<Chip/>` em
 * outras quatro — o mesmo campo com duas caras e oito implementações. Componente
 * novo que precise escolher item de lista curta usa este; não recrie.
 */
export function SelectField({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: readonly SelectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** O que o campo diz quando nada foi escolhido. */
  placeholder: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const [aberto, setAberto] = useState(false);

  const escolhida = options.find((o) => o.id === value);

  function alternar() {
    Haptics.selectionAsync();
    setAberto((a) => !a);
  }

  function escolher(id: string | null) {
    if (id !== value) Haptics.selectionAsync();
    onChange(id);
    setAberto(false);
  }

  const ladrilho = (icone: IconName | undefined, aceso: boolean) =>
    icone ? (
      /* O contorno não é enfeite: no escuro `backgroundElement` (#201F21) e
         `surface` (#1B1B1D) distam 5 pontos, e sem o fio o ladrilho não tem onde
         terminar. Mesma razão do contorno de todo card do app. */
      <View
        style={[
          styles.ladrilho,
          {
            backgroundColor: aceso ? theme.tint : theme.backgroundElement,
            borderColor: aceso ? 'transparent' : theme.cardBorder,
          },
        ]}>
        <Icon name={icone} size="sm" color={aceso ? 'onTint' : 'textSecondary'} />
      </View>
    ) : null;

  return (
    <Animated.View layout={LinearTransition.duration(Motion.duration.base)}>
      <View
        style={[
          styles.moldura,
          {
            backgroundColor: theme.surface,
            borderColor: theme.cardBorder,
            boxShadow: Elevation[scheme].raised,
          },
        ]}>
        {/* --- o valor, que é o estado normal do campo ---
             Ele SOME enquanto a lista está aberta. Mantê-lo visível duplicava a
             opção escolhida: o valor em cima e a mesma linha marcada logo abaixo,
             uma colada na outra — com "Não informar" (que é o padrão e a primeira
             opção) isso lia como defeito, não como campo. Fechar é escolher, e a
             linha marcada mostra o que fechar sem mudar nada. */}
        {!aberto ? (
        <Pressable
          onPress={alternar}
          accessibilityRole="button"
          accessibilityState={{ expanded: aberto }}
          accessibilityLabel={escolhida ? escolhida.label : placeholder}
          accessibilityHint="Toque para escolher">
          {({ pressed }) => (
            <View
              style={[
                styles.linha,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              {ladrilho(escolhida?.icon ?? 'circle', false)}
              <View style={styles.textos}>
                <ThemedText themeColor={escolhida ? 'text' : 'textSecondary'}>
                  {escolhida ? escolhida.label : placeholder}
                </ThemedText>
                {escolhida?.meta ? (
                  <ThemedText type="caption" themeColor="textSecondary">
                    {escolhida.meta}
                  </ThemedText>
                ) : null}
              </View>
              <Icon name="chevron.down" size="sm" color="textSecondary" />
            </View>
          )}
        </Pressable>
        ) : null}

        {/* --- a lista, só enquanto ele está escolhendo --- */}
        {aberto ? (
          <Animated.View
            entering={FadeIn.duration(Motion.duration.fast)}
            accessibilityRole="radiogroup">
            {options.map((o, i) => {
              const marcada = o.id === value;
              const aceso = marcada && !o.neutral;
              const grupoNovo = o.group && o.group !== options[i - 1]?.group;
              return (
                <Fragment key={o.id ?? '__nenhum__'}>
                  {grupoNovo ? (
                    <View style={styles.cabecalho}>
                      <ThemedText type="caption" themeColor="textSecondary" style={styles.etiqueta}>
                        {o.group}
                      </ThemedText>
                    </View>
                  ) : i > 0 ? (
                    <View style={[styles.divisor, { backgroundColor: theme.separator }]} />
                  ) : null}
                  <Pressable
                    onPress={() => escolher(o.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: marcada }}
                    accessibilityLabel={o.meta ? `${o.label}, ${o.meta}` : o.label}>
                    {({ pressed }) => (
                      <View
                        style={[
                          styles.linha,
                          {
                            backgroundColor: marcada
                              ? theme.accentSoft
                              : pressed
                                ? theme.backgroundSelected
                                : 'transparent',
                          },
                        ]}>
                        {ladrilho(o.icon, aceso)}
                        <View style={styles.textos}>
                          <ThemedText>{o.label}</ThemedText>
                          {o.meta ? (
                            <ThemedText type="caption" themeColor="textSecondary">
                              {o.meta}
                            </ThemedText>
                          ) : null}
                        </View>
                        {/* Só a escolhida desenha algo: um círculo vazio em cada
                            linha é ruído, a ausência já diz "não é esta". */}
                        {marcada ? (
                          <View style={[styles.marca, { backgroundColor: theme.tint }]}>
                            <Icon name="checkmark" size="xs" color="onTint" />
                          </View>
                        ) : null}
                      </View>
                    )}
                  </Pressable>
                </Fragment>
              );
            })}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  moldura: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56,
  },
  /** Caixa de GEOMETRIA: o ícone não cresce com a fonte, o texto ao lado sim. */
  ladrilho: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: { flex: 1, gap: Space.half },
  marca: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Separa o VALOR da lista: vai de ponta a ponta, porque separa duas coisas diferentes. */
  divisorCheio: { height: StyleSheet.hairlineWidth },
  /** Entre opções: começa depois do ladrilho, para agrupar em vez de fatiar. */
  divisor: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg + 36 + Space.md,
  },
  cabecalho: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.xs,
  },
  etiqueta: Type.meta,
});
