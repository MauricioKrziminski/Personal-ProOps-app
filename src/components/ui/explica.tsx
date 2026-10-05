import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { HitTarget, Space } from '@/design/tokens';
import type { Explicacao } from '@/lib/explicacoes';

/**
 * "Como é calculado": o (i) ao lado do TÍTULO de um bloco, que abre uma folha de leitura com
 * quatro linhas fixas — o que conta, o período REAL, a fonte e, só quando a resposta marca
 * estimativa, a qualidade. As frases saem de `lib/explicacoes.ts`, do mesmo payload que desenhou
 * o número; este primitivo só as mostra.
 *
 * Sem explicação (`null`: carregando, erro ou sem número) o (i) não existe — explicar o que não
 * está na tela é ruído. O texto do valor já chega pronto (via `useBRL`), então "ocultar valores"
 * vale aqui dentro sem este componente saber de dinheiro.
 */
export function Explica({
  indicador,
  explicacao,
  tom = 'textSecondary',
}: {
  indicador: string;
  explicacao: Explicacao | null;
  /** `onHeroMuted` sobre o painel de tinta. */
  tom?: 'textSecondary' | 'onHeroMuted';
}) {
  const [aberta, setAberta] = useState(false);
  if (!explicacao) return null;
  const linhas: [string, string][] = [
    ['O que conta', explicacao.oQueConta],
    ['Período', explicacao.periodo],
    ['Fonte', explicacao.fonte],
    ...(explicacao.qualidade ? ([['Qualidade', explicacao.qualidade]] as [string, string][]) : []),
  ];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Como é calculado: ${indicador}`}
        onPress={() => setAberta(true)}
        style={styles.botao}>
        <Icon name="info.circle" size="sm" color={tom} />
      </Pressable>
      <Sheet visible={aberta} onClose={() => setAberta(false)}>
        <TaskHeader title="Como é calculado" onClose={() => setAberta(false)} />
        <SheetScroll contentContainerStyle={styles.corpo}>
          <ThemedText type="headline">{indicador}</ThemedText>
          {linhas.map(([rotulo, texto]) => (
            <View key={rotulo} style={styles.linha}>
              <ThemedText type="footnote" themeColor="textSecondary">{rotulo}</ThemedText>
              <ThemedText type="default">{texto}</ThemedText>
            </View>
          ))}
          {explicacao.verItens ? (
            <Button
              label={explicacao.verItens.label}
              variant="secondary"
              onPress={() => {
                setAberta(false);
                router.push(explicacao.verItens!.href as never);
              }}
            />
          ) : null}
        </SheetScroll>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  // Alvo de 44pt sem aumentar a linha do título: o glifo é pequeno, a área não.
  botao: { width: HitTarget, height: HitTarget, alignItems: 'center', justifyContent: 'center', marginVertical: -Space.md },
  corpo: { padding: Space.lg, gap: Space.lg },
  linha: { gap: Space.xs },
});
