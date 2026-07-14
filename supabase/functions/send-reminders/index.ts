/**
 * Disparador de lembretes (invocada a cada minuto por pg_cron/pg_net).
 * Busca reminders ativos com next_run_at <= now():
 *   - push via Expo Notifications (GRÁTIS, canal preferencial)
 *   - template Utility no WhatsApp (complemento pago ~US$0,007)
 * Depois recalcula next_run_at pela recorrência (RRULE) ou desativa se for único.
 */

import { RRule } from "npm:rrule@2.8.1";
import { adminClient } from "../_shared/admin.ts";
import { sendTemplate } from "../_shared/whatsapp.ts";

const WHATSAPP_REMINDER_TEMPLATE = "proops_reminder"; // criar/aprovar no painel da Meta

async function sendExpoPush(token: string, title: string): Promise<void> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: token,
      title: "⏰ Lembrete",
      body: title,
      sound: "default",
    }),
  });
  if (!res.ok) throw new Error(`Expo push falhou (${res.status})`);
}

/** Próxima ocorrência a partir de agora, ou null se não há recorrência. */
function nextOccurrence(recurrence: string | null, after: Date): Date | null {
  if (!recurrence) return null;
  try {
    const rule = RRule.fromString(
      recurrence.startsWith("RRULE:") ? recurrence : `RRULE:${recurrence}`,
    );
    return rule.after(after, false);
  } catch (err) {
    console.error("RRULE inválida:", recurrence, err);
    return null;
  }
}

Deno.serve(async (_req) => {
  const supabase = adminClient();
  const now = new Date();

  const { data: due, error } = await supabase
    .from("reminders")
    .select("id, user_id, title, recurrence, channel, next_run_at, profiles(phone, expo_push_token)")
    .eq("active", true)
    .lte("next_run_at", now.toISOString())
    .limit(100);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0;
  for (const reminder of due ?? []) {
    const profile = reminder.profiles as unknown as {
      phone: string;
      expo_push_token: string | null;
    } | null;

    try {
      const wantsPush = reminder.channel === "push" || reminder.channel === "both";
      const wantsWhatsApp = reminder.channel === "whatsapp" || reminder.channel === "both";

      let delivered = false;

      if (wantsPush && profile?.expo_push_token) {
        await sendExpoPush(profile.expo_push_token, reminder.title);
        delivered = true;
      }

      // WhatsApp como complemento — ou fallback quando não há push token
      if (profile?.phone && (wantsWhatsApp || (!delivered && wantsPush))) {
        await sendTemplate(profile.phone, WHATSAPP_REMINDER_TEMPLATE, [reminder.title]);
        delivered = true;
      }

      const next = nextOccurrence(reminder.recurrence, now);
      await supabase
        .from("reminders")
        .update(
          next
            ? { next_run_at: next.toISOString(), updated_at: now.toISOString() }
            : { active: false, updated_at: now.toISOString() },
        )
        .eq("id", reminder.id);

      if (delivered) sent++;
    } catch (err) {
      console.error(`reminder ${reminder.id}:`, err);
      // mantém next_run_at: será tentado de novo no próximo tick do cron
    }
  }

  return new Response(JSON.stringify({ due: due?.length ?? 0, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
