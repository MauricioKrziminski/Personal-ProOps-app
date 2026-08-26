/**
 * Alertas proativos (pg_cron, uma vez por dia de manhã).
 *
 * O que dispara está em `_alerts_to_send()`: orçamento em 80%/100%, fatura e
 * conta vencendo, saldo projetado negativo. Aqui só entrega.
 *
 * Dedupe: cada alerta é gravado em `alerts_sent` com unique
 * (workspace, tipo, ref, DIA) ANTES do envio. Quem perde a corrida do insert
 * (23505) simplesmente não envia — rodar o cron duas vezes não vira spam.
 *
 * Canal: push (grátis) como principal; WhatsApp template (pago) só quando não
 * há token. É a regra de custo do produto — ver .claude/rules/whatsapp.md.
 */

import { adminClient } from "../_shared/admin.ts";
import { sendTemplate } from "../_shared/whatsapp.ts";

const WHATSAPP_REMINDER_TEMPLATE = Deno.env.get("WA_REMINDER_TEMPLATE") ??
  "personal_proops_reminder";
/** Teto por rodada: alerta demais no mesmo dia é ruído, não ajuda. */
const MAX_ALERTS_PER_USER = 4;

interface Alert {
  workspace_id: string;
  user_id: string;
  phone: string | null;
  expo_push_token: string | null;
  kind: string;
  ref: string;
  title: string;
  body: string;
}

async function sendExpoPush(token: string, title: string, body: string): Promise<void> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: token, title, body, sound: "default" }),
  });
  if (!res.ok) throw new Error(`Expo push falhou (${res.status})`);
}

Deno.serve(async (_req) => {
  const supabase = adminClient();

  const { data, error } = await supabase.rpc("_alerts_to_send");
  if (error) {
    console.error("_alerts_to_send:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const alerts = (data ?? []) as Alert[];
  const porUsuario = new Map<string, number>();
  let enviados = 0;
  let pulados = 0;

  for (const alerta of alerts) {
    const jaEnviados = porUsuario.get(alerta.user_id) ?? 0;
    if (jaEnviados >= MAX_ALERTS_PER_USER) {
      pulados++;
      continue;
    }

    // reserva ANTES de enviar: se duas execuções coincidirem, só uma passa
    const { error: reservaError } = await supabase.from("alerts_sent").insert({
      workspace_id: alerta.workspace_id,
      user_id: alerta.user_id,
      kind: alerta.kind,
      ref: alerta.ref,
      channel: alerta.expo_push_token ? "push" : "whatsapp",
    });
    if (reservaError) {
      // 23505 = já mandado hoje; qualquer outro erro também não deve enviar às cegas
      if (reservaError.code !== "23505") console.error("alerts_sent:", reservaError);
      pulados++;
      continue;
    }

    try {
      if (alerta.expo_push_token) {
        await sendExpoPush(alerta.expo_push_token, alerta.title, alerta.body);
      } else if (alerta.phone) {
        // fora da janela de 24h texto livre não passa: template Utility
        await sendTemplate(alerta.phone, WHATSAPP_REMINDER_TEMPLATE, [
          `${alerta.title}: ${alerta.body}`,
        ]);
      } else {
        pulados++;
        continue;
      }
      enviados++;
      porUsuario.set(alerta.user_id, jaEnviados + 1);
    } catch (err) {
      // a reserva fica: preferimos perder UM alerta a insistir todo dia num
      // canal quebrado (foi assim que o cron de lembretes virou loop infinito)
      console.error(`alerta ${alerta.kind}/${alerta.ref} falhou:`, err);
      pulados++;
    }
  }

  return new Response(JSON.stringify({ candidatos: alerts.length, enviados, pulados }), {
    headers: { "Content-Type": "application/json" },
  });
});
