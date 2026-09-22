import type { Retrato } from '@/lib/widget-snapshot';

/**
 * Publica o retrato para os widgets da plataforma. Aqui (web): não há widget.
 * As implementações moram em `publicar.ios.tsx` e `publicar.android.tsx`.
 *
 * ⚠️ **As três com a MESMA extensão (`.tsx`).** O Metro procura por extensão e, dentro dela, por
 * plataforma: com a base em `.ts` e o Android em `.tsx`, ele achava `publicar.ts` primeiro e o
 * Android rodava o no-op — o widget ficava em "entre no app" com a pessoa logada (22/09/2026).
 */
export async function publicarRetrato(_retrato: Retrato): Promise<void> {}
