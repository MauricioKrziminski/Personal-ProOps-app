/**
 * O nome de cada aba — a fonte ÚNICA das duas tab bars (`app-tabs.tsx` no iOS, `app-tabs.android.tsx`)
 * e do título da rota `(tabs)`.
 */
export const ROTULO_DA_ABA = {
  today: 'Hoje',
  notes: 'Notas',
  finance: 'Financeiro',
  agent: 'Agente',
  profile: 'Perfil',
} as const;

type Aba = keyof typeof ROTULO_DA_ABA;

/**
 * O título da rota `(tabs)` na pilha raiz: o nome da aba ativa.
 *
 * ⚠️ Sem título, o iOS cai no nome da ROTA. O "voltar" de toda tela empurrada era lido "(tabs)"
 * pelo VoiceOver (e aparecia assim no menu do toque longo nele), e quando o header da raiz vazava
 * — voltar com a busca nativa ativa — o Financeiro ganhava um header escrito "(tabs)" (24/09/2026).
 */
export function tituloDaAba(segments: readonly string[]): string {
  const aba = segments.find((s): s is Aba => s in ROTULO_DA_ABA);
  return ROTULO_DA_ABA[aba ?? 'today'];
}
