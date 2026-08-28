/**
 * Disparador de lembretes (invocada a cada minuto por pg_cron/pg_net).
 * Busca reminders ativos com next_run_at <= now():
 *   - push via Expo Notifications (GRÁTIS, canal preferencial)
 *   - template Utility no WhatsApp (complemento pago ~US$0,007)
 * Depois recalcula next_run_at pela recorrência (RRULE) ou desativa se for único.
 *
 * A materialização dos recorrentes NÃO mora mais aqui: virou a Edge Function
 * `finance-scheduler`, que materializa 90 dias à frente para alimentar a projeção.
 *
 * Falha de entrega NÃO repete para sempre: `send_attempts` conta as tentativas e,
 * ao estourar MAX_SEND_ATTEMPTS, a série recorrente pula para a próxima ocorrência
 * e o lembrete único é desativado (com o motivo em `last_error`). Sem isso, um
 * template não aprovado na Meta fazia o cron tentar de novo a cada minuto, eternamente.
 */

import { adminClient } from "../_shared/admin.ts";
import { sendTemplate } from "../_shared/whatsapp.ts";
import { nextOccurrence } from "../_shared/recurrence.ts";

// Nome do template vem do env (igual WA_OTP_TEMPLATE): trocar template passa a ser
// `secrets set`, não redeploy. Templates são por WABA — ao migrar para a WABA de
// produção, recriar com o MESMO nome e nada aqui muda.
const WHATSAPP_REMINDER_TEMPLATE = Deno.env.get("WA_REMINDER_TEMPLATE") ?? "personal_proops_reminder";
const MAX_SEND_ATTEMPTS = 5;
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

async function sendExpoPush(token: string, title: string): Promise<void> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: token,
      title: "⏰ Lembrete",
      body: title,
      sound: "default",
      // `target` é chave de uma allowlist no app (src/lib/notifications.ts), não rota livre:
      // payload externo não pode escolher para onde o app navega.
      data: { target: "reminders" },
    }),
  });
  if (!res.ok) throw new Error(`Expo push falhou (${res.status})`);
}

Deno.serve(async (_req) => {
  const supabase = adminClient();
  const now = new Date();

  const { data: due, error } = await supabase
    .from("reminders")
    .select(
      "id, user_id, title, recurrence, channel, next_run_at, timezone, send_attempts, profiles(phone, expo_push_token)",
    )
    .eq("active", true)
    .lte("next_run_at", now.toISOString())
    .limit(100);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0;
  let givenUp = 0;
  for (const reminder of due ?? []) {
    const profile = reminder.profiles as unknown as {
      phone: string;
      expo_push_token: string | null;
    } | null;
    const timezone = reminder.timezone ?? DEFAULT_TIMEZONE;

    try {
      const wantsPush = reminder.channel === "push" || reminder.channel === "both";
      const wantsWhatsApp = reminder.channel === "whatsapp" || reminder.channel === "both";

      let delivered = false;
      const failures: string[] = [];

      if (wantsPush && profile?.expo_push_token) {
        try {
          await sendExpoPush(profile.expo_push_token, reminder.title);
          delivered = true;
        } catch (err) {
          // push falhou não anula o WhatsApp: tenta o outro canal antes de desistir
          failures.push(`push: ${err}`);
        }
      }

      // WhatsApp como complemento — ou fallback quando não há push token
      if (profile?.phone && (wantsWhatsApp || (!delivered && wantsPush))) {
        try {
          await sendTemplate(profile.phone, WHATSAPP_REMINDER_TEMPLATE, [reminder.title]);
          delivered = true;
        } catch (err) {
          failures.push(`whatsapp: ${err}`);
        }
      }

      if (!delivered) {
        throw new Error(failures.join(" | ") || "nenhum canal disponível (sem push token nem telefone)");
      }

      const next = nextOccurrence(
        reminder.recurrence,
        now,
        timezone,
        new Date(reminder.next_run_at),
      );
      await supabase
        .from("reminders")
        .update({
          send_attempts: 0,
          last_error: null,
          updated_at: now.toISOString(),
          ...(next ? { next_run_at: next.toISOString() } : { active: false }),
        })
        .eq("id", reminder.id);

      sent++;
    } catch (err) {
      const attempts = (reminder.send_attempts ?? 0) + 1;
      const giveUp = attempts >= MAX_SEND_ATTEMPTS;
      // recorrente que desistiu pula para a próxima ocorrência; único é desativado
      const next = giveUp
        ? nextOccurrence(reminder.recurrence, now, timezone, new Date(reminder.next_run_at))
        : null;
      await supabase
        .from("reminders")
        .update({
          send_attempts: giveUp ? 0 : attempts,
          last_error: String(err),
          updated_at: now.toISOString(),
          ...(giveUp
            ? next
              ? { next_run_at: next.toISOString() }
              : { active: false }
            : {}),
        })
        .eq("id", reminder.id);
      if (giveUp) givenUp++;
      console.error(`reminder ${reminder.id} (tentativa ${attempts}):`, err);
    }
  }

  return new Response(
    JSON.stringify({ due: due?.length ?? 0, sent, givenUp}),
    { headers: { "Content-Type": "application/json" } },
  );
});
