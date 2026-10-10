import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/design/tokens';
import { useFaixas } from '@/hooks/use-app-config';
import { useTheme } from '@/hooks/use-theme';
import type { NivelDoAviso } from '@/lib/app-config';

/**
 * As faixas do topo da Hoje: o aviso do dono (`app_config.notice_*`) e "versão nova". Dispensável,
 * exceto o crítico. Sem nada a dizer, não desenha nada.
 */
export function FaixasDeAviso() {
  const { aviso, versao, dispensarAviso, dispensarVersao } = useFaixas();
  return (
    <>
      {aviso ? (
        <Faixa
          nivel={aviso.nivel}
          titulo={aviso.titulo}
          corpo={aviso.corpo}
          onFechar={aviso.nivel === 'critical' ? undefined : dispensarAviso}
        />
      ) : null}
      {versao ? (
        <Faixa
          nivel="info"
          titulo="Versão nova disponível"
          corpo={versao.ultima}
          onAbrir={versao.url ? () => { void Linking.openURL(versao.url!).catch(() => {}); } : undefined}
          onFechar={dispensarVersao}
        />
      ) : null}
    </>
  );
}

function Faixa({
  nivel,
  titulo,
  corpo,
  onFechar,
  onAbrir,
}: {
  nivel: NivelDoAviso;
  titulo: string;
  corpo: string;
  onFechar?: () => void;
  onAbrir?: () => void;
}) {
  const theme = useTheme();
  const fundo = nivel === 'critical' ? theme.dangerSoft : nivel === 'warning' ? theme.warningSoft : theme.surface;
  const cor = nivel === 'critical' ? 'danger' : nivel === 'warning' ? 'warning' : 'textSecondary';
  const icone = nivel === 'info' ? 'info.circle' : 'exclamationmark.triangle';
  return (
    <View style={[styles.faixa, { backgroundColor: fundo, borderColor: theme.cardBorder }]} accessibilityRole="alert">
      <Icon name={icone} size="sm" color={cor} />
      <Pressable style={styles.texto} disabled={!onAbrir} onPress={onAbrir} accessibilityRole={onAbrir ? 'link' : undefined}>
        {titulo ? <ThemedText type="smallBold">{titulo}</ThemedText> : null}
        {corpo ? <ThemedText type="footnote" themeColor="textSecondary">{corpo}</ThemedText> : null}
      </Pressable>
      {onFechar ? (
        <Pressable onPress={onFechar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dispensar aviso">
          <Icon name="xmark" size="sm" color="textSecondary" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  texto: { flex: 1, minWidth: 0, gap: Space.half },
});
