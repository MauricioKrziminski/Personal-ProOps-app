import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { PressableScale } from '@/components/motion/pressable-scale';
import { Presenca } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, Motion, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { ATALHOS_DE_LANCAMENTO } from '@/lib/atalhos-de-lancamento';
import { TIPOS_DE_LANCAMENTO, type TipoDeLancamento } from '@/lib/lancar';

const APARENCIA: Record<TipoDeLancamento, { icon: IconName; descricao: string }> = {
  uma: { icon: ATALHOS_DE_LANCAMENTO.lancamento.icon, descricao: 'Um lançamento pontual' },
  recorrente: { icon: ATALHOS_DE_LANCAMENTO.recorrente.icon, descricao: 'Um valor que se repete' },
  financiamento: { icon: ATALHOS_DE_LANCAMENTO.financiamento.icon, descricao: 'Um compromisso em parcelas' },
};

/** O formato apresenta a escolha atual; as alternativas só ocupam espaço ao abrir. */
export function FormatoDoLancamento({ value, onChange }: {
  value: TipoDeLancamento;
  onChange: (tipo: TipoDeLancamento) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const reduzir = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const [aberto, setAberto] = useState(false);
  const escolhendo = useRef(false);
  const giro = useSharedValue(0);
  const estiloDoChevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${giro.get()}deg` }] }));
  useLayoutEffect(() => {
    giro.set(withSpring(aberto ? 180 : 0, {
      ...Motion.spring.morph, reduceMotion: ReduceMotion.System,
    }));
  }, [aberto, giro]);

  // Com fonte grande, o nome ganha a largura inteira, em vez de competir com dois círculos.
  const amplo = fontScale > 1.15 || width < 360;
  const atual = TIPOS_DE_LANCAMENTO.find((tipo) => tipo.value === value)!;
  const aparencia = APARENCIA[value];
  const textos = (
    <View style={amplo ? styles.textosAmplo : styles.textos}>
      <ThemedText style={[Type.title, styles.textoInteiro]}>{atual.label}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.textoInteiro}>
        {aparencia.descricao}
      </ThemedText>
    </View>
  );

  const alternar = () => {
    escolhendo.current = false;
    setAberto((a) => !a);
  };
  const escolher = (tipo: TipoDeLancamento) => {
    if (!aberto || escolhendo.current) return;
    escolhendo.current = true;
    setAberto(false);
    if (tipo !== value) {
      void Haptics.selectionAsync();
      onChange(tipo);
    }
  };

  return (
    <View style={styles.grupo}>
      <PressableScale
        haptic="selection"
        scaleTo={reduzir ? 1 : Motion.pressScale}
        onPress={alternar}
        accessibilityRole="button"
        accessibilityLabel={`Formato do lançamento, ${atual.label}`}
        accessibilityHint={aberto ? 'Toque para fechar as alternativas' : 'Toque para escolher Uma vez, Recorrente ou Financiamento'}
        accessibilityState={{ expanded: aberto }}
        style={styles.destaque}>
        <View style={styles.linhaDoDestaque}>
          <View style={[styles.circulo, { backgroundColor: theme.tintFill }]}>
            <Icon name={aparencia.icon} color="onTint" size="md" />
          </View>
          {amplo ? <View style={styles.espaco} /> : textos}
          <Animated.View style={[styles.affordance, { backgroundColor: theme.backgroundElement }, estiloDoChevron]}>
            <Icon name="chevron.down" color="textSecondary" size="sm" />
          </Animated.View>
        </View>
        {amplo ? textos : null}
      </PressableScale>

      <Presenca visivel={aberto} style={styles.respiroDasAlternativas}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Formato do lançamento"
          style={[styles.alternativas, {
            backgroundColor: theme.surface,
            borderColor: theme.cardBorder,
            boxShadow: Elevation[scheme].raised,
          }]}>
          {TIPOS_DE_LANCAMENTO.map((tipo, indice) => {
            const selecionada = tipo.value === value;
            const opcao = APARENCIA[tipo.value];
            return (
              <Fragment key={tipo.value}>
                {indice > 0 ? <View style={[styles.divisor, { backgroundColor: theme.separator }]} /> : null}
                <PressableScale
                  scaleTo={reduzir ? 1 : Motion.pressScale}
                  onPress={() => escolher(tipo.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${tipo.label}, ${opcao.descricao}`}
                  accessibilityHint={selecionada ? 'Toque para manter este formato e fechar' : 'Toque para mudar o formato, mantendo os campos preenchidos'}
                  accessibilityState={{ selected: selecionada }}>
                    <View style={styles.linhaDaOpcao}>
                      <Icon name={opcao.icon} color={selecionada ? 'text' : 'textSecondary'} size="md" />
                      <View style={styles.textos}>
                        <ThemedText type="headline" style={styles.textoInteiro}>{tipo.label}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.textoInteiro}>{opcao.descricao}</ThemedText>
                      </View>
                      {selecionada ? <Icon name="checkmark" size="sm" /> : null}
                    </View>
                </PressableScale>
              </Fragment>
            );
          })}
        </View>
      </Presenca>
      <View style={[styles.fio, { backgroundColor: theme.separator }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  grupo: {},
  respiroDasAlternativas: { paddingTop: Space.lg },
  destaque: { gap: Space.md, paddingVertical: Space.sm },
  linhaDoDestaque: { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  textos: { flex: 1, gap: Space.xs },
  textosAmplo: { gap: Space.xs },
  textoInteiro: { flexShrink: 0 },
  espaco: { flex: 1 },
  circulo: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  affordance: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  alternativas: { borderRadius: Radius.lg, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  linhaDaOpcao: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg, minHeight: 72 },
  divisor: { height: StyleSheet.hairlineWidth, marginLeft: Space.lg },
  fio: { height: StyleSheet.hairlineWidth, marginTop: Space.lg },
});
