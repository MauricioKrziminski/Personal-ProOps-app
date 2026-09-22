import type { Retrato } from '@/lib/widget-snapshot';

/**
 * Publica o retrato para os widgets da plataforma. Aqui (web): não há widget.
 * As implementações moram em `publicar.ios.ts` e `publicar.android.ts`.
 */
export async function publicarRetrato(_retrato: Retrato): Promise<void> {}
