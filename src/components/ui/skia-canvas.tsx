import { PixelRatio, useWindowDimensions } from 'react-native';
import { Canvas, Group } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';

/**
 * A densidade com que o módulo nativo do Skia nasceu.
 *
 * `PixelRatio.get()` lê a mesma `DisplayMetrics.density` que o `SkiaManager` leu, e este módulo
 * carrega no mesmo instante em que o contexto React é criado — entre os dois a densidade não tem
 * como mudar. Por isso a constante de módulo é uma cópia fiel do que o C++ guardou, e é o único
 * jeito de o JS saber por quanto o Skia está multiplicando.
 */
const ESCALA_DO_SKIA = PixelRatio.get();

/**
 * O único caminho para um `Canvas` do Skia neste app.
 *
 * ## O defeito que ele existe para matar
 *
 * **O Skia guarda o px/dp da tela UMA vez, quando o app sobe, e nunca mais olha.** No Android é
 * literal: `PlatformContext.java` faz `initHybrid(getResources().getDisplayMetrics().density)` na
 * construção do módulo, e o C++ guarda esse número num campo (`RNSkPlatformContext::_pixelDensity`)
 * que ninguém atualiza. Quando a densidade muda com o app RODANDO — "tamanho de exibição" nas
 * configurações do Android, um dobrável trocando de painel —, o RN reposiciona as `View`s em dp
 * sozinho, mas todo desenho do Skia continua multiplicado pelo fator VELHO.
 *
 * Medido na `CurvedTabBar` em 09/09/2026, indo de 480 para 560 dpi: a pílula, que devia ter
 * 352dp × 3,5 = **1232px**, saiu com ~1022 — os mesmos 3/3,5 = **0,857×** —, terminou antes da
 * aba Perfil e deixou o conteúdo de trás aparecer no buraco, com o berço pendurado fora dela.
 * As `View`s ao lado (bolha, ícones, rótulos) ficaram no lugar certo o tempo todo.
 *
 * ## Por que `key` NÃO resolve, embora pareça resolver
 *
 * A primeira versão deste arquivo remontava o canvas com `key={scale}`. O raciocínio estava certo
 * para uma superfície POR VIEW e errado para esta biblioteca: a densidade não mora na view, mora
 * no contexto nativo, que dura o processo inteiro. Verificado com sonda: o JS enxerga a troca
 * (`scale` 3 → 3,5, `width` 448 → 384) e o componente remonta — **e o desenho continua errado**.
 * O que consertava era o Reload do dev menu, e agora dá para dizer por quê: ele recria o contexto
 * React, e só aí o `SkiaManager` lê a densidade de novo.
 *
 * ## O que resolve
 *
 * Desfazer a multiplicação errada com uma certa. O C++ aplica `scale(ESCALA_DO_SKIA)`; um
 * `Group` por cima com `scale(atual / ESCALA_DO_SKIA)` deixa o produto igual à densidade real.
 * Vale para tudo que estiver dentro — inclusive `clip`, que passa pela mesma matriz.
 *
 * É correção de JS, então ela sobe por OTA. Trocar a versão da lib exigiria APK novo, e o
 * `_pixelDensity` continua sendo um campo const na 2.6.2 que temos.
 *
 * ⚠️ **Em DEV isto engana.** Fast Refresh deste arquivo reavalia o escopo do módulo e grava em
 * `ESCALA_DO_SKIA` a densidade de AGORA, enquanto o C++ segue com a de nascença — a correção sai
 * ao contrário e o desenho fica pior do que sem ela. Reload (não Fast Refresh) alinha os dois.
 * Em release não existe Fast Refresh, então o caso não é do produto; é de quem edita este
 * arquivo depois de mexer na densidade, e custou 15 minutos uma vez.
 *
 * ## Por que o wrapper, e não a correção em cada tela
 *
 * São cinco canvases (barra de abas, gradiente do `HeroPanel`, marca, sparkline, abertura) e a
 * regra vale para todos. A decisão mora no primitivo, com o motivo escrito uma vez, e
 * `anti-slop.test.ts` quebra o build se alguém importar o `Canvas` do Skia direto.
 */
export function SkiaCanvas({ children, ...props }: ComponentProps<typeof Canvas>) {
  const { scale } = useWindowDimensions();
  const correcao = scale / ESCALA_DO_SKIA;

  // O caso normal — a densidade nunca mudou — não paga nem um nó a mais na árvore do Skia.
  if (correcao === 1) return <Canvas {...props}>{children}</Canvas>;

  return (
    <Canvas {...props}>
      <Group transform={[{ scale: correcao }]}>{children}</Group>
    </Canvas>
  );
}
