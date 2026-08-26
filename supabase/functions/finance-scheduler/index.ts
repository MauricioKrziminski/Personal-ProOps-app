/**
 * Manutenção financeira (pg_cron, de hora em hora). Faz três coisas:
 *
 *   1. MATERIALIZA os lançamentos recorrentes 90 dias à frente, como
 *      `transactions` com `status='pending'`. É isso que faz a projeção de
 *      fluxo de caixa ser um `sum()` em SQL em vez de expandir RRULE em runtime,
 *      e é o que mostra ao usuário as contas que ainda vão cair.
 *   2. FECHA as faturas cujo dia de fechamento passou.
 *   3. PROMOVE para `cleared` o que já aconteceu (parcela de compra parcelada e
 *      ocorrência de série com auto_confirm). Conta a pagar avulsa fica pending
 *      até o usuário confirmar.
 *
 * Idempotente: o unique index (recurring_id, occurred_at) faz rodar duas vezes
 * não duplicar nada. Antes isso vivia no `send-reminders`, que voltou a cuidar
 * só de lembretes.
 */

import { adminClient } from "../_shared/admin.ts";
import { localISODate } from "../_shared/datetime.ts";
import { nextOccurrence } from "../_shared/recurrence.ts";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
/** Quanto do futuro fica materializado. Combina com o padrão da projeção. */
const HORIZON_DAYS = 90;
/** Trava contra RRULE patológica (ex.: FREQ=HOURLY) gerando milhares de linhas. */
const MAX_OCCURRENCES_PER_SERIES = 200;
const MAX_SERIES_PER_RUN = 200;

type Admin = ReturnType<typeof adminClient>;

interface RecurringRow {
  id: string;
  user_id: string;
  workspace_id: string;
  kind: string;
  amount_cents: number;
  currency: string;
  category: string | null;
  description: string | null;
  account_id: string | null;
  rrule: string;
  next_run_at: string;
  dtstart: string | null;
  end_date: string | null;
  auto_confirm: boolean;
  materialized_until: string | null;
  profiles: { timezone: string } | null;
}

async function materializeHorizon(supabase: Admin, now: Date): Promise<number> {
  const { data: series, error } = await supabase
    .from("recurring_transactions")
    .select(
      "id, user_id, workspace_id, kind, amount_cents, currency, category, description, account_id, rrule, next_run_at, dtstart, end_date, auto_confirm, materialized_until, profiles(timezone)",
    )
    .eq("active", true)
    .limit(MAX_SERIES_PER_RUN);
  if (error) {
    console.error("recurring_transactions fetch:", error);
    return 0;
  }

  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  let created = 0;

  for (const raw of series ?? []) {
    const rec = raw as unknown as RecurringRow;
    const timezone = rec.profiles?.timezone ?? DEFAULT_TIMEZONE;
    // âncora imutável da série: sem ela a hora de parede derivaria a cada rodada
    const dtstart = new Date(rec.dtstart ?? rec.next_run_at);

    try {
      // retoma de onde parou; na primeira vez, de um instante antes da próxima
      // ocorrência (para que ela mesma seja gerada)
      let cursor = rec.materialized_until
        ? new Date(rec.materialized_until)
        : new Date(new Date(rec.next_run_at).getTime() - 1);
      let ultima: Date | null = rec.materialized_until ? new Date(rec.materialized_until) : null;
      let geradas = 0;

      while (geradas < MAX_OCCURRENCES_PER_SERIES) {
        const occ = nextOccurrence(rec.rrule, cursor, timezone, dtstart);
        if (!occ || occ > horizon) break;
        const dia = localISODate(occ, timezone);
        if (rec.end_date && dia > rec.end_date) break;

        const jaAconteceu = occ <= now;
        const { error: insertError } = await supabase.from("transactions").insert({
          user_id: rec.user_id,
          workspace_id: rec.workspace_id,
          kind: rec.kind,
          amount_cents: rec.amount_cents,
          currency: rec.currency,
          category: rec.category,
          description: rec.description,
          account_id: rec.account_id,
          occurred_at: dia,
          due_at: dia,
          source: "recurring",
          status: jaAconteceu && rec.auto_confirm ? "cleared" : "pending",
          recurring_id: rec.id,
        });
        // 23505 = ocorrência já materializada numa rodada anterior: segue em frente
        if (insertError && insertError.code !== "23505") throw insertError;
        if (!insertError) created++;

        cursor = occ;
        ultima = occ;
        geradas++;
      }

      // next_run_at continua sendo a PRÓXIMA ocorrência futura (é o que o app mostra),
      // independente de quanto já foi materializado à frente
      const proxima = nextOccurrence(rec.rrule, now, timezone, dtstart);
      const encerrou =
        !proxima || (rec.end_date != null && localISODate(proxima, timezone) > rec.end_date);

      await supabase
        .from("recurring_transactions")
        .update({
          dtstart: dtstart.toISOString(),
          materialized_until: ultima?.toISOString() ?? rec.materialized_until,
          next_run_at: (encerrou ? ultima ?? new Date(rec.next_run_at) : proxima!).toISOString(),
          active: !encerrou,
          run_attempts: 0,
          last_error: null,
        })
        .eq("id", rec.id);
    } catch (err) {
      console.error(`série ${rec.id} falhou:`, err);
      await supabase
        .from("recurring_transactions")
        .update({ last_error: String(err) })
        .eq("id", rec.id);
    }
  }

  return created;
}

Deno.serve(async (_req) => {
  const supabase = adminClient();
  const now = new Date();

  const created = await materializeHorizon(supabase, now);

  const { data: closed, error: closeError } = await supabase.rpc("_close_due_invoices");
  if (closeError) console.error("_close_due_invoices:", closeError);

  const { data: promoted, error: promoteError } = await supabase.rpc("_promote_due_transactions");
  if (promoteError) console.error("_promote_due_transactions:", promoteError);

  return new Response(
    JSON.stringify({ created, invoicesClosed: closed ?? 0, promoted: promoted ?? 0 }),
    { headers: { "Content-Type": "application/json" } },
  );
});
