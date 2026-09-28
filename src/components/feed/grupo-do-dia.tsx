import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { horaBR } from '@/lib/dates';

/**
 * A coluna da esquerda das linhas do dia: o selo do compromisso ou a hora do lembrete. Mesma
 * largura nos dois, para os títulos do "dia todo" e dos lembretes começarem no mesmo ponto — como
 * numa agenda. `minWidth`, não `width`: com fonte grande a hora cresce e empurra, nunca corta.
 */
export const COLUNA_DA_HORA = 56;

/**
 * O AGORA do dia, como a linha do calendário: um ponto, a hora e um fio de tinta (a cor de
 * ação do app é tinta — vermelho aqui leria como atraso).
 */
export function AgoraLinha({ agora }: { agora: number }) {
  const theme = useTheme();
  const hora = horaBR(new Date(agora).toISOString());
  return (
    <View accessible accessibilityLabel={`Agora, ${hora}`} style={styles.agora}>
      <View style={styles.agoraHora}>
        <ThemedText type="caption" style={tabular}>
          {hora}
        </ThemedText>
      </View>
      <View style={[styles.agoraPonto, { backgroundColor: theme.text }]} />
      <View style={[styles.agoraFio, { backgroundColor: theme.text }]} />
    </View>
  );
}

/** O dia dentro de um grupo (Próximos dias): "qua, 30 set" abrindo as linhas dele. */
export function RotuloNoGrupo({ texto }: { texto: string }) {
  return (
    <View accessibilityRole="header" style={styles.rotulo}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {texto}
      </ThemedText>
    </View>
  );
}

/**
 * Um grupo de linhas do dia: a superfície chapada com o fio de 1px (o mesmo desenho do `Section`,
 * §2), e o separador fino ENTRE as linhas.
 *
 * O separador não encosta no AGORA (ele já é um fio) nem vem logo depois de um rótulo de dia (o
 * rótulo abre o que vem embaixo dele).
 */
export function GrupoDoDia({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const itens = Children.toArray(children).filter(isValidElement);
  const semFioAntes = (i: number) =>
    i === 0 || itens[i].type === AgoraLinha || itens[i - 1].type === AgoraLinha || itens[i - 1].type === RotuloNoGrupo;

  return (
    <View style={[styles.grupo, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      {itens.map((item, i) => (
        <Fragment key={item.key ?? i}>
          {semFioAntes(i) ? null : <View style={[styles.fio, { backgroundColor: theme.separator }]} />}
          {item}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grupo: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: Space.xs,
  },
  fio: { height: StyleSheet.hairlineWidth, marginLeft: Space.lg + COLUNA_DA_HORA + Space.md },
  agora: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xs,
  },
  /** O ponto cai onde começam os títulos: a hora ocupa a mesma coluna das linhas. */
  agoraHora: { minWidth: COLUNA_DA_HORA + Space.md - 3, flexShrink: 0 },
  agoraPonto: { width: 7, height: 7, borderRadius: Radius.pill, flexShrink: 0 },
  agoraFio: { flex: 1, height: 1.5, borderRadius: Radius.pill },
  rotulo: { paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.xs },
});
