/**
 * O canal com que um lembrete NOVO nasce: o que a pessoa ligou no Perfil (16/10/2026, dono do produto: "se eu
 * configurei só push, só push vai ser default"). Só um ligado vale ele; os dois, ou nenhum, valem os dois — o
 * WhatsApp só sai com ele ligado no Perfil (o envio confere), então "os dois" nunca manda template sem ele.
 * A MESMA régua do agente: `agent/app/domain/lembrete.py`, `canal_do_perfil`.
 */
export type Canal = 'push' | 'whatsapp' | 'both';

export function canalDoPerfil(prefs: { push: boolean; whatsapp: boolean } | null | undefined): Canal {
  if (prefs?.push && !prefs.whatsapp) return 'push';
  if (prefs?.whatsapp && !prefs.push) return 'whatsapp';
  return 'both';
}
