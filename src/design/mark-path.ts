import { Skia, type SkPath } from '@shopify/react-native-skia';

/**
 * A marca do ProOps como geometria — **uma fonte só** para a abertura e para o app.
 *
 * O símbolo (o "P/d" em espiral dentro do círculo) existia só como PNG de 96px em
 * `assets/images/brand/`, o que serve para o splash nativo e para nada mais: não dá para animar,
 * não dá para recolorir por token e fica borrado em tamanho grande. O SVG vetorial estava em
 * `assets/images/logo/logo2-cropped.svg` e **não era referenciado em lugar nenhum do projeto.**
 *
 * ## O `transform` que precisa ser desfeito na mão
 *
 * O arquivo saiu de um traçador automático (potrace) e carrega, no `<g>`, um
 * `transform="translate(0,900) scale(0.1,-0.1)"` sobre um `viewBox="540 250 410 430"`. Ou seja:
 * coordenadas dez vezes maiores e **eixo Y invertido**.
 *
 * `Skia.Path.MakeFromSVGString` lê só o atributo `d` — ele **não aplica o `transform` do grupo
 * pai**. Sem reproduzir essa matriz aqui, a marca sai de cabeça para baixo e dez vezes fora do
 * quadro, que é o tipo de defeito que consome uma tarde antes de alguém desconfiar do arquivo.
 *
 * A conta, uma vez só:
 *
 * ```
 * x' = 0.1·x                y' = 900 − 0.1·y      (o transform do <g>)
 * x'' = k·(x' − 540) + dx   y'' = k·(y' − 250)    (o viewBox → caixa de `size`)
 * ```
 *
 * `k = size / 430` (o lado maior do viewBox, para caber sem distorcer) e `dx` centra os 410 de
 * largura na caixa quadrada.
 *
 * ## Dois subpaths, de propósito
 *
 * O `d` tem um `M` e um `m`: a silhueta e **o ponto central**. Eles são separados porque a
 * animação de abertura trata os dois de forma diferente — a espiral é revelada por varredura
 * angular e o ponto entra depois, com mola. É o "encaixe" da abertura.
 *
 * ⚠️ A marca é `fill`, **não `stroke`** (`stroke="none"` no arquivo). Trim path (`start`/`end`
 * do `<Path>`) percorre traço e aqui desenharia o contorno da silhueta, não a espiral — não é o
 * caminho.
 */
const RAW =
  'M7500 6103 c-485 -52 -935 -337 -1197 -758 -126 -202 -194 -401 -228 -660 -19 -150 -19 -197 1 -360 45 -379 180 -666 444 -947 45 -49 88 -88 96 -88 12 0 14 98 14 658 0 524 3 673 14 738 75 424 425 776 845 849 198 35 428 9 594 -67 l47 -21 0 -220 0 -220 -32 27 c-53 42 -149 94 -219 117 -52 18 -89 22 -199 23 -123 1 -142 -1 -216 -27 -153 -52 -274 -146 -359 -277 -61 -95 -92 -182 -104 -293 -12 -109 -15 -1505 -3 -1524 16 -26 205 -94 363 -131 97 -23 303 -34 438 -23 122 10 152 15 271 43 132 31 338 122 470 206 93 59 245 188 325 275 156 171 259 348 334 572 61 184 76 287 76 510 -1 254 -29 399 -120 620 -56 136 -108 228 -194 342 -62 84 -214 243 -232 243 -4 0 -10 -307 -12 -682 -3 -655 -4 -687 -25 -770 -24 -100 -73 -227 -106 -278 -81 -124 -109 -160 -188 -236 -48 -46 -116 -102 -150 -125 -298 -192 -680 -224 -985 -82 l-53 24 0 210 c0 147 3 209 11 209 6 0 32 -15 58 -34 55 -40 127 -77 201 -102 44 -15 83 -19 200 -18 139 0 148 2 225 32 265 105 435 340 446 617 1 33 1 380 1 772 l-2 712 -47 21 c-124 56 -303 104 -445 119 -92 10 -281 12 -358 4z m317 -1327 c65 -36 94 -66 132 -140 77 -146 13 -335 -139 -414 -62 -32 -69 -34 -150 -29 -102 5 -151 28 -216 100 -52 58 -78 131 -78 214 1 116 91 248 197 287 28 11 68 15 122 13 66 -3 90 -8 132 -31z';

/** viewBox do arquivo — não mexer sem reexportar o SVG. */
const VB = { x: 540, y: 250, w: 410, h: 430 } as const;
/** `scale(0.1, -0.1)` e `translate(0, 900)` do `<g>`. */
const G_SCALE = 0.1;
const G_TRANSLATE_Y = 900;

/**
 * A marca ajustada para uma caixa quadrada de `size`, centrada e com a orientação certa.
 *
 * Devolve um `SkPath` novo a cada chamada: `SkPath` é mutável, então compartilhar uma instância
 * entre dois `<Canvas>` que a transformam levaria a marca a encolher a cada render.
 */
export function markPath(size: number): SkPath {
  const path = Skia.Path.MakeFromSVGString(RAW);
  if (!path) throw new Error('mark-path: SVG da marca não parseou');

  const k = size / VB.h;
  const dx = (size - VB.w * k) / 2;

  // Skia pós-concatena: o resultado aplica a ESCALA primeiro e a translação depois, que é a
  // ordem que a conta do topo descreve.
  const m = Skia.Matrix();
  m.translate(-VB.x * k + dx, (G_TRANSLATE_Y - VB.y) * k);
  m.scale(G_SCALE * k, -G_SCALE * k);
  path.transform(m);

  return center(path, size);
}

/**
 * Centraliza pelos limites REAIS do desenho, não pelo `viewBox`.
 *
 * O `viewBox` do arquivo veio de um recorte automático e **não é simétrico em volta da tinta**:
 * confiando nele, a marca nasceu ~18 px à direita do centro na abertura — pouco para parecer
 * defeito no catálogo, muito para uma marca sozinha no meio da tela, onde o olho compara com as
 * duas bordas.
 *
 * `getBounds()` devolve a caixa justa do que será pintado; a partir dela o centro é aritmética,
 * não confiança no arquivo. Vale para qualquer reexportação futura do SVG.
 */
function center(path: SkPath, size: number): SkPath {
  const b = path.getBounds();
  const m = Skia.Matrix();
  m.translate((size - b.width) / 2 - b.x, (size - b.height) / 2 - b.y);
  path.transform(m);
  return path;
}

/**
 * O ponto central sozinho — o segundo subpath do `d`.
 *
 * Serve à abertura (ele entra com mola depois da espiral) e ao futuro spinner, onde é o eixo
 * fixo enquanto o resto gira.
 */
export function markDotPath(size: number): SkPath {
  const dot = RAW.slice(RAW.lastIndexOf('m317'));
  // O subpath é relativo ao ponto final do anterior; reancorado no absoluto equivalente.
  const path = Skia.Path.MakeFromSVGString(`M7817 4776 ${dot.slice(dot.indexOf('c'))}`);
  if (!path) throw new Error('mark-path: subpath do ponto não parseou');

  const k = size / VB.h;
  const dx = (size - VB.w * k) / 2;
  const m = Skia.Matrix();
  m.translate(-VB.x * k + dx, (G_TRANSLATE_Y - VB.y) * k);
  m.scale(G_SCALE * k, -G_SCALE * k);
  path.transform(m);

  return path;
}
