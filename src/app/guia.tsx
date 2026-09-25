import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ComNegrito } from '@/components/ui/forte';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { marcarGuiaAberto, reacenderDica } from '@/hooks/use-dicas';
import { destinoDoItem, GUIA, type ItemDoGuia } from '@/lib/dicas';

/**
 * "Como usar o ProOps" (spec `2026-09-24-dicas-e-guia-design.md`): tudo que dá para fazer, aberto
 * pela PESSOA (Perfil e Primeiros passos) — o que ela abre sozinha ela termina.
 *
 * "Mostrar" leva à tela certa e, quando o item é um gesto escondido, acende a dica de lá mesmo que
 * já tenha sido dispensada. Abrir o guia marca "Conhecer o app" nos Primeiros passos.
 */
export default function GuiaScreen() {
  useEffect(() => {
    marcarGuiaAberto();
  }, []);

  const mostrar = (item: ItemDoGuia) => {
    if ('dica' in item) reacenderDica(item.dica);
    router.navigate(destinoDoItem(item));
  };

  return (
    <Screen>
      {GUIA.map((grupo) => (
        <Section key={grupo.titulo} title={grupo.titulo}>
          {grupo.itens.map((item) => (
            <Row
              key={item.titulo}
              title={item.titulo}
              subtitle={<ComNegrito texto={item.texto} />}
              chevron={false}
              trailing={
                <ThemedText type="smallBold" style={styles.link}>
                  Mostrar
                </ThemedText>
              }
              accessibilityLabel={`${item.titulo}. Mostrar`}
              onPress={() => mostrar(item)}
            />
          ))}
        </Section>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline' },
});
