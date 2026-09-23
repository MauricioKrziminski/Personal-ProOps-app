import { Colors } from '@/constants/theme';
import { semNulos, type Retrato } from '@/lib/widget-snapshot';

/**
 * O que chega ao widget: o retrato + a PALETA, em hex.
 *
 * ⚠️ A paleta viaja nas props porque o componente do iOS (`'widget'`) roda num runtime isolado
 * que não enxerga constante de módulo nem importa `theme.ts` — e hex escrito à mão no widget
 * seria a segunda cópia da cor da marca (`anti-slop.test.ts` barra hex fora do tema). O
 * widget é o HERÓI da Hoje fora do app: bloco de tinta nos dois temas, `onHero*` por cima.
 */
export interface PropsDoWidget extends Retrato {
  cor: {
    fundo: `#${string}`;
    texto: `#${string}`;
    apagado: `#${string}`;
    perigo: `#${string}`;
    faixa: `#${string}`;
  };
}

/**
 * `rgba(...)` do tema pintado SOBRE o fundo, em `#RRGGBB` sólido. As duas plataformas leem hex
 * sem ambiguidade; transparência em widget depende de quem compõe (o iOS e o launcher do Android
 * compõem diferente), e o que se quer é a mesma cor que o herói mostra dentro do app.
 */
export function solido(cor: string, fundo: string): `#${string}` {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const m = cor.match(/rgba?\(([^)]+)\)/);
  if (!m) return cor as `#${string}`;
  const [r, g, b, a = 1] = m[1].split(',').map((x) => Number(x.trim()));
  const [br, bg, bb] = hex(fundo);
  const mix = (f: number, b0: number) => Math.round(f * a + b0 * (1 - a)).toString(16).padStart(2, '0');
  return `#${mix(r, br)}${mix(g, bg)}${mix(b, bb)}`.toUpperCase() as `#${string}`;
}

export function propsDoWidget(r: Retrato): PropsDoWidget {
  const c = Colors.light;
  const fundo = c.heroSurface;
  // Sem `null`: as preferências do App Group do iOS recusam o retrato inteiro por um `null` só.
  return semNulos({
    ...r,
    cor: {
      fundo,
      texto: solido(c.onHero, fundo),
      apagado: solido(c.onHeroMuted, fundo),
      perigo: solido(c.onHeroDanger, fundo),
      faixa: solido(c.heroChip, fundo),
    },
  });
}
