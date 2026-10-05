import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { GradeDeIcones } from '@/components/finance/categoria-sheet';
import { GradeDeCores } from '@/components/notes/color-picker';
import { Button } from '@/components/ui/button';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon, type IconName } from '@/components/ui/icon';
import { RingGauge } from '@/components/ui/ring-gauge';
import { Segmented } from '@/components/ui/segmented';
import { ThemedText } from '@/components/themed-text';
import type { NoteColorName } from '@/constants/theme';
import { noteInk } from '@/design/note-colors';
import { Motion, Radius, Space } from '@/design/tokens';
import { usePreferencia } from '@/hooks/use-preferencia';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { formatBRL, formatNumberBR } from '@/lib/dates';
import {
  ajustarMemoria, celebracao, centavosDaLinha, centavosParaPercentual, etapaDaMeta,
  type LinhaDeMarco,
} from '@/lib/goal-milestones';

/** O ícone de quem não escolheu nenhum. */
const ICONE_PADRAO: IconName = 'target';

/** Ícone e cor da meta: os MESMOS dois controles da categoria (grade do kit e paleta das notas). */
export function AparenciaDaMeta({ icon, color, onIcon, onColor }: {
  icon: string | null;
  color: NoteColorName | null;
  onIcon: (icon: string | null) => void;
  onColor: (color: NoteColorName | null) => void;
}) {
  return (
    <>
      <Field label="Ícone">
        <GradeDeIcones
          valor={(icon ?? ICONE_PADRAO) as IconName}
          cor={color}
          onPick={(i) => onIcon(String(i) === icon ? null : String(i))}
        />
      </Field>
      <Field label="Cor">
        <GradeDeCores value={color} onPick={onColor} />
      </Field>
    </>
  );
}

export type UnidadeDoMarco = 'valor' | 'pct';

/**
 * A lista editável de marcos. `Cada um | %` troca a RÉGUA do campo, não os valores: a linha digitada
 * em % guarda o texto e recalcula com o alvo; o que ficou acima do alvo (alvo reduzido) aparece
 * marcado, com Apagar.
 */
export function MarcosDaMeta({ linhas, targetCents, unidade, onUnidade, onChange }: {
  linhas: LinhaDeMarco[];
  targetCents: number;
  unidade: UnidadeDoMarco;
  onUnidade: (u: UnidadeDoMarco) => void;
  onChange: (linhas: LinhaDeMarco[]) => void;
}) {
  const mudar = (key: string, parte: Partial<LinhaDeMarco>) =>
    onChange(linhas.map((l) => (l.key === key ? { ...l, ...parte } : l)));
  const apagar = (key: string) => onChange(linhas.filter((l) => l.key !== key));
  const novo = () => onChange([...linhas, { key: `n${Date.now()}`, cents: 0, pct: unidade === 'pct' ? '' : null }]);
  return (
    <Field label="Marcos">
      <View style={styles.marcos}>
        <Segmented
          options={[{ value: 'valor', label: 'Cada um' }, { value: 'pct', label: '%' }]}
          value={unidade}
          onChange={onUnidade}
        />
        {linhas.map((l) => {
          const cents = centavosDaLinha(l, targetCents);
          const acima = cents > 0 && targetCents > 0 && cents >= targetCents;
          const pctTexto = l.pct ?? formatNumberBR(centavosParaPercentual(cents, targetCents));
          return (
            <View key={l.key} style={styles.linha}>
              <View style={styles.campo}>
                {unidade === 'valor' ? (
                  <MoneyField valueCents={cents} onChangeCents={(c) => mudar(l.key, { cents: c, pct: null })} />
                ) : (
                  <TextField
                    value={pctTexto === '0' && l.pct === null ? '' : pctTexto}
                    onChangeText={(t) => mudar(l.key, { pct: t })}
                    keyboardType="decimal-pad"
                    placeholder="Ex.: 25"
                    accessibilityLabel="Marco em porcentagem do alvo"
                  />
                )}
                <ThemedText type="footnote" themeColor={acima ? 'danger' : 'textSecondary'}>
                  {acima
                    ? 'Acima do alvo: não aparece na meta'
                    : unidade === 'valor'
                    ? `${formatNumberBR(centavosParaPercentual(cents, targetCents))}% do alvo`
                    : `= ${formatBRL(cents)}`}
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Apagar marco" hitSlop={8} onPress={() => apagar(l.key)}>
                <Icon name="trash" size="md" color="textSecondary" />
              </Pressable>
            </View>
          );
        })}
        <Button label="Adicionar marco" variant="secondary" size="sm" onPress={novo} />
      </View>
    </Field>
  );
}

const ACEITA_NUMERO = (v: string | number): v is number => typeof v === 'number';
/** O quanto a folha do aporte leva para sair de cima do anel. */
const DESCIDA_DA_FOLHA_MS = 450;

/** Uma travessia confirmada (aporte/alocação): é o ÚNICO gatilho de celebração. */
export interface Travessia {
  goalId: string;
  /** Muda a cada ação confirmada; a mesma travessia nunca é tratada duas vezes. */
  token: number;
  antes: number;
  depois: number;
}

/**
 * O anel da meta (ícone ao centro) e o momento de celebrar um marco. A memória do "já celebrado"
 * mora no aparelho, por usuário (`meta:<id>` → maior marco celebrado); abrir a tela, puxar para
 * atualizar e o Realtime NÃO celebram, só uma `travessia` — a memória aqui só sabe DESCER.
 * Escala curta no anel + háptico; com Reduzir movimento, só um fade do halo e o háptico.
 */
export function AnelDaMeta({ goalId, saved, target, marcos, icon, color, concluida, travessia, label }: {
  goalId: string;
  saved: number;
  target: number;
  /** undefined enquanto os marcos carregam: sem eles a memória não é tocada. */
  marcos: number[] | undefined;
  icon: string | null;
  color: string | null;
  concluida: boolean;
  travessia: Travessia | null;
  label: string;
}) {
  const scheme = useScheme();
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const tinta = noteInk(color as NoteColorName | null, scheme);
  const [gravado, setGravado] = usePreferencia(`meta:${goalId}`, 0, ACEITA_NUMERO);
  const escala = useSharedValue(1);
  const halo = useSharedValue(0);
  const estiloAnel = useAnimatedStyle(() => ({ transform: [{ scale: escala.get() }] }));
  const estiloHalo = useAnimatedStyle(() => ({ opacity: halo.get() }));
  const tratada = useRef<number | null>(null);
  const depoisDaFolha = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const maiorAtingido = marcos ? etapaDaMeta(saved, target, marcos).maiorAtingido : null;
  // Só `maiorAtingido` dispara, e o valor de partida é o GRAVADO na hora (forma funcional): com o
  // guardado ainda velho (o refetch vem depois do aporte), a celebração que acabou de gravar o marco
  // novo não pode ser desfeita por esta linha.
  useEffect(() => {
    if (maiorAtingido === null) return;
    setGravado((g) => ajustarMemoria(g, maiorAtingido));
  }, [maiorAtingido, setGravado]);

  useEffect(() => {
    if (!travessia || travessia.goalId !== goalId || tratada.current === travessia.token || !marcos) return;
    tratada.current = travessia.token;
    const c = celebracao(travessia.antes, travessia.depois, target, marcos, gravado);
    if (c.gravado !== gravado) setGravado(c.gravado);
    if (c.marco === null) return;
    // A travessia chega no sucesso do aporte, com a folha ainda descendo por cima do anel: tocada
    // ali, ninguém via (QA iOS e Android, 05/10/2026). Celebra depois que a folha sai. O timer não
    // é limpo quando o efeito roda de novo (o `setGravado` acima o faz rodar, e o token já tratado
    // o encerraria antes da hora) — só na desmontagem.
    // ponytail: tempo fixo da descida da folha; o `Modal` só avisa o fim no iOS (`onDismiss`).
    clearTimeout(depoisDaFolha.current);
    depoisDaFolha.current = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (reduzido) {
        halo.set(withSequence(withTiming(1, { duration: Motion.duration.fast }), withTiming(0, { duration: Motion.duration.slow })));
      } else {
        escala.set(withSequence(withSpring(1.14, Motion.spring.encaixe), withSpring(1, Motion.spring.encaixe)));
      }
    }, DESCIDA_DA_FOLHA_MS);
  }, [travessia, goalId, marcos, target, gravado, setGravado, reduzido, halo, escala]);
  useEffect(() => () => clearTimeout(depoisDaFolha.current), []);

  const nome = (icon ?? (concluida ? 'checkmark.seal.fill' : ICONE_PADRAO)) as IconName;
  return (
    <Animated.View style={estiloAnel}>
      <RingGauge
        value={target > 0 ? saved / target : 0}
        size={56}
        tone={concluida ? 'success' : 'tint'}
        cor={concluida ? undefined : (tinta ?? undefined)}
        accessibilityLabel={label}>
        <Icon name={nome} size="md" color={concluida ? 'success' : 'tint'} tint={concluida ? undefined : (tinta ?? undefined)} />
      </RingGauge>
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { borderColor: tinta ?? theme.tint }, estiloHalo]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  marcos: { gap: Space.md },
  linha: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  campo: { flex: 1, gap: Space.xs },
  halo: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: Radius.pill, borderWidth: 3 },
});
