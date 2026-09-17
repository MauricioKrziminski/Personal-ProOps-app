/**
 * O voo do cartão entre telas — puro, em worklet, testado em `node --test`.
 *
 * O cartão é UM desenho deitado. "Em pé" é esse desenho girado 90° no sentido horário, como no
 * vídeo de referência (o "VISA" do cartão em pé fica de lado). Então todo pouso se descreve por
 * três números: o centro, o lado longo e o giro.
 *
 * ⚠️ **Nunca interpolar `left`/`top` com giro.** O giro acontece em volta do centro, e uma caixa
 * interpolada pelo canto sai do eixo no meio do caminho. Por isso o quadro é centro + lado.
 */

export type Caixa = { x: number; y: number; largura: number; altura: number };
export type Pose = 'deitado' | 'em-pe';
export type Quadro = { cx: number; cy: number; lado: number; giro: number };

/** Quanto o cartão sobe no meio do voo, em frações do lado longo. */
const ARCO = 0.08;
/** Quanto ele cresce no meio do voo: é o "levantar" da mesa. */
const CRESCE = 0.06;

export function quadroDaCaixa(c: Caixa, pose: Pose): Quadro {
  'worklet';
  return {
    cx: c.x + c.largura / 2,
    cy: c.y + c.altura / 2,
    lado: pose === 'deitado' ? c.largura : c.altura,
    giro: pose === 'deitado' ? 0 : 90,
  };
}

/**
 * O quadro do cartão em `p` (0 = origem, 1 = pouso). `p` passa de 1 na mola; o arco e o
 * crescimento usam `p` preso em [0, 1], então somem nas duas pontas e não voltam no quique.
 */
export function quadroNoVoo(p: number, de: Quadro, para: Quadro): Quadro {
  'worklet';
  const meio = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  const lado = de.lado + (para.lado - de.lado) * p;
  return {
    cx: de.cx + (para.cx - de.cx) * p,
    cy: de.cy + (para.cy - de.cy) * p - meio * ARCO * Math.max(de.lado, para.lado),
    lado: lado * (1 + CRESCE * meio),
    giro: de.giro + (para.giro - de.giro) * p,
  };
}

/** A caixa de um cartão arrastado: desce `dy` e encolhe em volta do próprio centro. */
export function caixaArrastada(c: Caixa, dy: number, escala: number): Caixa {
  'worklet';
  const largura = c.largura * escala;
  const altura = c.altura * escala;
  return {
    x: c.x + (c.largura - largura) / 2,
    y: c.y + dy + (c.altura - altura) / 2,
    largura,
    altura,
  };
}
