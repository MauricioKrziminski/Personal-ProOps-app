/**
 * Contraste WCAG 2.x entre duas cores `#RRGGBB`.
 *
 * Puro, para `node --test`: é o que `contrast.test.ts` usa para prender a paleta de
 * `constants/theme.ts` aos mínimos de leitura, nos dois temas.
 */
function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const canal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

export function contrast(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (claro + 0.05) / (escuro + 0.05);
}
