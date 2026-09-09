import { useWindowDimensions } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';

/**
 * O único caminho para um `Canvas` do Skia neste app.
 *
 * ## O defeito que ele existe para matar (09/09/2026)
 *
 * **A superfície do Skia guarda o px/dp com que nasceu.** Quando a densidade da tela muda com o
 * app RODANDO — "tamanho de exibição" nas configurações do Android, um dobrável trocando de
 * painel — o JS recalcula tudo em dp e as `View`s do RN se reposicionam sozinhas, mas o Skia
 * continua multiplicando pelo fator VELHO. Indo de 560 para 480 dpi, tudo que ele desenha sai
 * 3,5 / 3,0 = **1,1667× maior**, e o desenho deixa de casar com as views ao lado.
 *
 * Medido na `CurvedTabBar`, que é onde ficou visível: o berço saiu a 145,4dp com raio 38,5
 * quando o JS mandava 124,8 e 33 — os dois números multiplicados por 1,1667 —, enquanto a bolha,
 * que é uma `View`, ficou no lugar certo. A pílula, desenhada com a largura nova na escala
 * velha, não coube no canvas e foi **cortada** na borda em vez de terminar arredondada. Na tela
 * lia-se "a bola da aba selecionada está fora do lugar", e o código estava certo o tempo todo:
 * uma referência desenhada dentro do próprio canvas, nas coordenadas cruas do JS, caiu exatamente
 * em cima da bolha.
 *
 * `key` na escala é o que recria a superfície: é o mecanismo do React para "a identidade mudou,
 * reconstrua". A largura NÃO entra na chave — redimensionar sem mudar a densidade (split screen,
 * dobrável na mesma densidade) o canvas já resolve sozinho, e remontar ali só custaria um frame.
 *
 * ## Por que o wrapper, e não a chave em cada tela
 *
 * São cinco canvases (barra de abas, gradiente do `HeroPanel`, marca, sparkline, abertura) e a
 * regra vale para todos. Espalhar a mesma chave por cinco arquivos é a mesma dívida que o
 * `GlassCard` e o `Icon` já resolveram: a decisão mora no primitivo, com o motivo escrito uma
 * vez, e `anti-slop.test.ts` quebra o build se alguém importar o `Canvas` do Skia direto.
 */
export function SkiaCanvas(props: ComponentProps<typeof Canvas>) {
  const { scale } = useWindowDimensions();
  return <Canvas key={scale} {...props} />;
}
