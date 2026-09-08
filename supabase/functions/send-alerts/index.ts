/**
 * Alertas proativos (pg_cron, uma vez por dia de manhã).
 *
 * O que dispara está em `_alerts_to_send()`: orçamento em 80%/100%, fatura e
 * conta vencendo, saldo projetado negativo. Aqui só entrega.
 *
 * Dedupe: cada alerta é gravado em `alerts_sent` com unique
 * (workspace, tipo, ref, DIA, CANAL) ANTES do envio. Quem perde a corrida do
 * insert (23505) simplesmente não envia — rodar o cron duas vezes não vira spam.
 *
 * Canal: só os que a pessoa ativou. Token e telefone são capacidades, nunca
 * consentimento ou fallback implícito.
 */

import { adminClient } from "../_shared/admin.ts";
import { alertChannels } from "../_shared/alert-channels.ts";
import { sendTemplate } from "../_shared/whatsapp.ts";

const WHATSAPP_ALERT_TEMPLATE = Deno.env.get("WA_ALERT_TEMPLATE") ??
  "personal_proops_alert";
/** Teto por rodada: alerta demais no mesmo dia é ruído, não ajuda. */
const MAX_ALERTS_PER_USER = 4;

interface Alert {
  workspace_id: string;
  user_id: string;
  phone: string | null;
  expo_push_token: string | null;
  alerts_push_enabled: boolean;
  alerts_whatsapp_enabled: boolean;
  kind: string;
  ref: string;
  title: string;
  body: string;
}

/** Cada alerta abre a tela que resolve o problema dele. Chave de allowlist, não rota livre. */
function targetFor(kind: string): string {
  if (kind.startsWith("budget")) return "budgets";
  if (kind.startsWith("invoice") || kind.startsWith("card")) return "cards";
  if (kind.startsWith("balance") || kind.startsWith("forecast")) return "forecast";
  return "today";
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  kind: string,
): Promise<void> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: token,
      title,
      body,
      sound: "default",
      data: { target: targetFor(kind) },
    }),
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

    const channels = alertChannels(alerta);
    if (channels.length === 0) {
      pulados++;
      continue;
    }

    let entregou = false;
    for (const channel of channels) {
      // reserva POR CANAL antes de enviar: duas execuções não duplicam nenhuma entrega
      const { error: reservaError } = await supabase.from("alerts_sent").insert({
        workspace_id: alerta.workspace_id,
        user_id: alerta.user_id,
        kind: alerta.kind,
        ref: alerta.ref,
        channel,
      });
      if (reservaError) {
        if (reservaError.code !== "23505") console.error("alerts_sent:", reservaError);
        pulados++;
        continue;
      }

      try {
        if (channel === "push") {
          await sendExpoPush(alerta.expo_push_token!, alerta.title, alerta.body, alerta.kind);
        } else {
          // Aviso inferido não pode usar o template que diz "você pediu".
          await sendTemplate(alerta.phone!, WHATSAPP_ALERT_TEMPLATE, [
            `${alerta.title}: ${alerta.body}`,
          ]);
        }
        enviados++;
        entregou = true;
      } catch (err) {
        // a reserva fica: preferimos perder UM alerta a insistir todo dia num
        // canal quebrado (foi assim que o cron de lembretes virou loop infinito)
        console.error(`alerta ${alerta.kind}/${alerta.ref} via ${channel} falhou:`, err);
        pulados++;
      }
    }

    if (entregou) {
      porUsuario.set(alerta.user_id, jaEnviados + 1);
    }
  }

  return new Response(JSON.stringify({ candidatos: alerts.length, enviados, pulados }), {
    headers: { "Content-Type": "application/json" },
  });
});
