import { router } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { Fonts } from '@/constants/theme';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

/**
 * As opções de `<Stack>` que vestem o header NATIVO com a fonte do app.
 *
 * Sem isto o título das telas empurradas (Lançamentos, Contas, Cartões, Gerenciar, Pastas…) sai
 * em SF Pro sobre um corpo em Hanken Grotesk — duas famílias na mesma tela, que é exatamente o
 * "quase nativo" que o design proíbe. `headerTitleStyle`/`headerLargeTitleStyle` viram
 * `titleFontFamily`/`largeTitleFontFamily` no `react-native-screens`.
 *
 * Vai no `screenOptions` de cada pilha, não tela a tela: uma tela nova nasce certa.
 */
export const stackHeaderFonts = {
  headerTitleStyle: { fontFamily: Fonts.semibold },
  headerLargeTitleStyle: { fontFamily: Fonts.bold },
} as const;

/** A altura da faixa, sem a safe area. O `h-14` do Stitch. */
export const APP_HEADER_BAR = 56;

/**
 * Quanto a barra ocupa no topo, safe area inclusa.
 *
 * A barra é **sobreposta** (ela desfoca o conteúdo que passa por baixo), então nada reserva esse
 * espaço sozinho: toda raiz de aba soma isto ao `paddingTop` do seu scroll.
 */
export function useAppHeaderHeight(): number {
  return useSafeAreaInsets().top + APP_HEADER_BAR;
}

interface AppHeaderProps {
  /**
   * O nome da tela. Vai para o leitor de tela e para o `accessibilityLabel` da barra — a faixa
   * do Stitch não escreve o título, ele é dito pelo conteúdo logo abaixo.
   */
  title: string;
  /**
   * Ponto de status ao lado da marca. Cor SEMÂNTICA e **estática**.
   *
   * No export ele é `animate-pulse`. Movimento permanente no canto do olho não tem propósito
   * (§5), some do radar em um dia e custa bateria — o ponto fica, a pulsação não.
   */
  status?: 'success' | 'warning' | 'danger';
  /** Controles à direita, antes do avatar (ex.: nova nota). */
  action?: React.ReactNode;
}

/**
 * A barra de topo das quatro raízes de aba — **a faixa de marca do Stitch**.
 *
 * ## Anatomia (medida do export, não estimada)
 *
 * `h-14` (56px) sobre a safe area, calha de 16, fundo do app a 85% com `backdrop-blur-xl` e um
 * fio de 1px embaixo. À esquerda: um quadrado de 28 com raio 8 carregando a marca, a palavra
 * "ProOps" em 16/700 e um ponto de 6px. À direita: o avatar de 32 em pílula.
 *
 * ## Por que ela voltou (03/09/2026)
 *
 * Uma versão anterior trocou esta faixa por uma etiqueta de contexto + display grande, com o
 * argumento de que a marca no topo gasta a faixa mais nobre da tela. O argumento continua de pé
 * em abstrato — mas o desenho é do dono do produto, as quatro telas do export têm esta barra, e
 * ela é o que dá continuidade entre as abas. Decisão dele, registrada aqui para a próxima sessão
 * não "corrigir" de novo.
 *
 * ## O avatar não tem iniciais
 *
 * O export escreve "GS". O schema guarda só `profiles.phone` — não há nome de onde tirar
 * iniciais, e inventá-las seria escrever um dado que não existe. Fica o ícone de pessoa.
 */
export function AppHeader({ title, status = 'success', action }: AppHeaderProps) {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={title}
      /*
        `box-none`: a faixa é SOBREPOSTA e cobre ~100px do topo da tela. Capturando toque na área
        inteira, ela engolia o começo de qualquer arraste que nascesse ali — a tela parecia
        "presa em cima" e não rolava. Só os `Pressable` de dentro é que recebem toque; o resto
        (desfoque, véu de cor, marca) é `none` e deixa o gesto passar para o scroll.
      */
      pointerEvents="box-none"
      style={[styles.bar, { paddingTop: insets.top, borderBottomColor: theme.cardBorder }]}>
      {/*
        Glass de CHROME, que é onde o material é permitido (§1). Não passa pelo `GlassCard`
        porque aquele primitivo é um card — raio, padding e sombra próprios; aqui a faixa é reta,
        encosta nas bordas e não tem elevação.
      */}
      <BlurView
        pointerEvents="none"
        intensity={Platform.OS === 'android' ? 0 : 40}
        tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={StyleSheet.absoluteFill}
      />
      {/*
        A camada de cor por cima do blur. No Android o `BlurView` é caro e impreciso, então lá ela
        é opaca (intensity 0 acima) — mesma decisão que a tab bar já toma por plataforma.
      */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.background, opacity: Platform.OS === 'android' ? 1 : 0.85 },
        ]}
      />

      <View pointerEvents="box-none" style={styles.row}>
        <View pointerEvents="none" style={styles.brand}>
          <View
            style={[
              styles.markBox,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder },
            ]}>
            <Mark size={16} color="text" />
          </View>
          <ThemedText type="caption" style={styles.wordmark}>
            ProOps
          </ThemedText>
          <View style={[styles.dot, { backgroundColor: theme[status] }]} />
        </View>

        <View pointerEvents="box-none" style={styles.right}>
          {action}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir perfil"
            hitSlop={Space.sm}
            onPress={() => router.push('/(tabs)/profile')}
            style={[
              styles.round,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder },
            ]}>
            <Icon name="person.crop.circle" size="md" color="textSecondary" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Botão só-ícone do slot `action` — mesma forma do avatar, para a fileira ficar par. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Space.sm}
      onPress={onPress}
      style={[
        styles.round,
        { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder },
      ]}>
      <Icon name={icon} size="md" color="text" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * Sobreposta, não em fluxo: o desfoque só significa alguma coisa se houver conteúdo passando
   * por baixo. Quem reserva a altura é a tela, por `useAppHeaderHeight()`.
   */
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    height: APP_HEADER_BAR,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  markBox: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 16/700 com tracking negativo — o único uso de `Type.wordmark` no app. */
  wordmark: Type.wordmark,
  dot: { width: 6, height: 6, borderRadius: Radius.pill },
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  round: {
    width: HitTarget - 12,
    height: HitTarget - 12,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
