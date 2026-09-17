import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, useReducedMotion } from 'react-native-reanimated';

import { MessageBubble } from '@/components/feed/message-bubble';
import { RecordCard } from '@/components/feed/record-card';
import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Destino, ParDaConversa } from '@/lib/activity-feed';

/**
 * A Conversa: cada fala da pessoa com o que ela virou encaixado embaixo.
 *
 * ⚠️ **O encaixe só toca para fala que CHEGOU depois da montagem.** As chaves da primeira pintura
 * ficam guardadas; abrir a aba não pode fazer todos os pares pularem (a lição do alfinete de Notas,
 * design.md §5). Um par novo monta com a chave nova — e só ele anima.
 */
export function ConversationFeed({
  pares,
  onOpenRecord,
  onOpenConversation,
}: {
  pares: readonly ParDaConversa[];
  onOpenRecord: (d: Destino) => void;
  onOpenConversation: (sessao: string) => void;
}) {
  const [daAbertura] = useState(() => new Set(pares.map((p) => p.chave)));
  return (
    <View style={styles.lista}>
      {pares.map((p, i) => (
        <Fragment key={p.chave}>
          {p.dia !== 'hoje' && p.dia !== pares[i - 1]?.dia ? (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.dia}>
              {p.dia}
            </ThemedText>
          ) : null}
          <Par
            par={p}
            novo={!daAbertura.has(p.chave)}
            onOpenRecord={onOpenRecord}
            onOpenConversation={onOpenConversation}
          />
        </Fragment>
      ))}
    </View>
  );
}

function Par({
  par,
  novo,
  onOpenRecord,
  onOpenConversation,
}: {
  par: ParDaConversa;
  novo: boolean;
  onOpenRecord: (d: Destino) => void;
  onOpenConversation: (sessao: string) => void;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const anima = novo && !reduzido;

  // Um háptico por chegada, no quadro em que ela aparece (§6).
  useEffect(() => {
    if (novo) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [novo]);

  const sessao = par.sessao;
  return (
    <View style={styles.par}>
      <Animated.View entering={anima ? FadeInDown.duration(Motion.duration.slow).easing(Motion.easing.out) : undefined}>
        <MessageBubble
          texto={par.texto}
          entrada={par.entrada}
          canal={par.canal}
          hora={par.hora}
          onPress={sessao ? () => onOpenConversation(sessao) : undefined}
        />
      </Animated.View>
      <Animated.View
        entering={anima ? FadeIn.delay(160).duration(Motion.duration.fast) : undefined}
        style={[styles.fio, { backgroundColor: theme.rail }]}
      />
      <View style={styles.cards}>
        {par.cards.map((c, i) => {
          const destino = c.destino;
          return (
            <Animated.View
              key={c.chave}
              entering={
                anima
                  ? FadeInUp.delay(220 + Math.min(i * Motion.stagger.step, Motion.stagger.cap))
                      .duration(Motion.duration.slow)
                      .easing(Motion.easing.out)
                  : undefined
              }>
              <RecordCard card={c} onPress={destino ? () => onOpenRecord(destino) : undefined} />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lista: { gap: Space.xl },
  dia: { alignSelf: 'center' },
  par: { gap: 0 },
  // O fio sai de baixo do balão, do lado da cauda, e encosta no card.
  fio: { alignSelf: 'flex-end', width: 2, height: Space.md, marginRight: Space.xl, borderRadius: Radius.pill },
  cards: { gap: Space.sm },
});
