import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { notePalette } from '@/design/note-colors';
import { Radius, Space, tabular } from '@/design/tokens';
import { PaletaTingida, useScheme, useTheme } from '@/hooks/use-theme';
import type { NoteFolder } from '@/hooks/use-notes';
import { symbol } from '@/components/notes/note-actions';

/**
 * Altura do ladrilho — é dela que sai a aritmética exata do slot na grade.
 *
 * O número é a SOMA do desenho, não um palpite: 12 de respiro + 40 de ladrilho do ícone + 8 de
 * folga mínima + duas linhas de nome (21 cada) + 12 de respiro = 114. Duas linhas porque nome é
 * identificador e não trunca (§7) — a de duas palavras precisa caber sem estourar a borda.
 *
 * ⚠️ **Ela CRESCE com a fonte do sistema**, e é a mesma armadilha da face do cartão de crédito
 * (`design.md` §1): apertar o teto de escala até caber é desligar o Dynamic Type com outro nome.
 *
 * É FUNÇÃO e não constante porque quem posiciona os slots é a tela: o cartão e a grade precisam
 * do mesmo número, e um `* fontScale` escrito num dos dois lados é o defeito que não dá erro.
 */
export function folderTileHeight(fontScale: number): number {
  return Math.round(114 * Math.max(1, fontScale));
}

/**
 * O ladrilho de uma pasta na grade da home.
 *
 * ## Por que a pasta virou LUGAR e não continua um chip de filtro
 *
 * Como chip, ela era um recorte da mesma lista — e a tela abria com quatro fileiras de controle
 * antes da primeira nota. Como ladrilho, ela é um destino: tem ícone, cor, contagem e abre uma
 * tela própria. Os chips de PASTA saíram junto; os de TAG ficaram, porque tag é transversal e
 * recorta a tela inteira, incluindo as pastas.
 *
 * ## A cor pinta o ladrilho INTEIRO (25/09/2026)
 *
 * Era só o quadradinho do ícone, e não identificava nada de relance (a queixa do dono do produto
 * valeu para a nota e para a pasta). Hoje a pasta colorida é um ladrilho daquela cor, como o
 * cartão da nota, e o quadradinho do ícone é o tom forte da mesma cor (`notePalette`).
 *
 * ## Duas zonas, não três linhas empilhadas (14/09/2026)
 *
 * ⚠️ **O desenho anterior empilhava ícone, nome e contagem à ESQUERDA** e deixava 60% da largura
 * vazia — a queixa do dono do produto foi literal, *"está tudo grudado, tela feia"*. A causa não
 * era o espaçamento: era a contagem ser uma TERCEIRA linha, logo abaixo do nome, o que colava
 * dois textos de pesos parecidos e empurrava tudo para um canto.
 *
 * Agora são duas zonas. Em cima, a faixa de metadados — ladrilho do ícone à esquerda, alfinete e
 * contagem encostados à direita —, que é o que usa a largura. Embaixo, ancorado na base, o nome
 * sozinho, com a linha inteira para quebrar em duas se precisar. O ar no meio é o que sobra
 * entre as duas, e é ele que faz o ladrilho ler como destino em vez de linha de lista espremida.
 *
 * ⚠️ **A contagem é MONO** (`code`). Ela é o caso literal de §3 — "hora, contador, unidade" —, e
 * é o mono que a faz ler como dado em vez de um "1" órfão pendurado embaixo do nome.
 */

function FolderCardBase({
  folder,
  onPress,
  dragging,
}: {
  folder: NoteFolder;
  onPress: () => void;
  /** `true` enquanto ESTE ladrilho está levantado. */
  dragging?: boolean;
}) {
  const theme = useTheme();
  const scheme = useScheme();

  // A cor pinta o ladrilho INTEIRO (25/09/2026), como o cartão da nota — ver `note-card.tsx`.
  const paleta = notePalette(folder.color, scheme, theme);
  const cores = paleta ? { ...theme, ...paleta } : theme;

  const label = [
    folder.name,
    `${folder.notes_count} nota${folder.notes_count === 1 ? '' : 's'}`,
    folder.pinned ? 'fixada' : null,
    folder.tags.length > 0 ? folder.tags.map((t) => `tag ${t}`).join(', ') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.alvo}>
      {({ pressed }) => (
        <View
          style={[
            styles.ladrilho,
            {
              backgroundColor: pressed || dragging ? cores.backgroundSelected : cores.surface,
              borderColor: cores.cardBorder,
            },
          ]}>
          <PaletaTingida cores={paleta}>
            <View style={styles.topo}>
              {/*
                Quem carrega a cor é o LADRILHO INTEIRO, não o glifo (`Icon` só aceita token de
                tema). O quadrado do ícone é o tom FORTE da mesma cor — ou o elemento neutro, sem
                cor —, lido da paleta ajustada.
              */}
              <View style={[styles.icone, { backgroundColor: cores.backgroundElement }]}>
                {/* Glifo em tinta CHEIA mesmo sem cor escolhida: em `textSecondary` o ladrilho
                    cinza com o desenho cinza dentro lia como controle desabilitado, e a pasta sem
                    cor é o caso PADRÃO — quase toda a grade. Quem diferencia é o fundo, não o
                    apagamento do glifo. */}
                <Icon name={symbol(folder.icon)} size="md" color="text" />
              </View>
              <View style={styles.metaDireita}>
                {folder.pinned ? <Icon name="pin.fill" size="sm" color="tint" /> : null}
                {/* ⚠️ **Pasta vazia não carimba "0".** É a mesma régua do badge de aba (§8):
                    contagem real ou nada. Uma grade de pastas novas virava uma fileira de zeros —
                    ruído no canto de cada ladrilho dizendo que não há o que ver ali. */}
                {folder.notes_count > 0 ? (
                  <ThemedText type="code" themeColor="textSecondary" style={tabular}>
                    {folder.notes_count}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            {/*
              Nome NUNCA trunca: é identificador (§7). Não coube em duas linhas, a fonte não é o
              problema — o ladrilho é que está estreito, e aí quem cede é o layout.

              ⚠️ **`flexShrink: 0` porque a grade entra com `FadeInDown`** (§3, 15/09/2026): o Yoga
              mede o filho enquanto o contêiner animado ainda está chegando e, com o `flexShrink: 1`
              que o `ThemedText` traz na base, ele prefere ENCOLHER a quebrar — encolhido naquele
              instante, o texto não se remede nunca mais. Foi assim que "App bloqueado" virou "App"
              no APK de release, invisível no dev.
            */}
            <ThemedText type="smallBold" style={styles.nome}>
              {folder.name}
            </ThemedText>
          </PaletaTingida>
        </View>
      )}
    </Pressable>
  );
}

export const FolderCard = memo(FolderCardBase);

const styles = StyleSheet.create({
  alvo: { flex: 1 },
  ladrilho: {
    flex: 1,
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    // 1dp, não `hairlineWidth` (um pixel FÍSICO, que some em escala) — a régua do `Card` (§2).
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaDireita: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  icone: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  nome: { flexShrink: 0, maxWidth: '100%' },
});
