/**
 * Consumidor da fila `jobs` (invocada por pg_cron/pg_net ou manualmente).
 * Para cada job pendente:
 *   1. resolve o usuário pelo telefone (profiles.phone)
 *   2. áudio -> Groq (Whisper) transcreve; texto segue direto
 *   3. rate limit por usuário (custo de IA)
 *   4. Gemini gera AÇÕES multi-intent (creates, consultas, undo) com responseSchema
 *   5. executa cada ação (inserts/RPCs) + audita em ai_events
 *   6. confirma pro usuário via WhatsApp em UMA mensagem consolidada (best-effort)
 *
 * Regra de robustez: o job é marcado "done" assim que as ações são EXECUTADAS.
 * O envio da confirmação é best-effort — se falhar (ex.: janela 24h fechada),
 * NÃO reprocessa o job, evitando inserts duplicados.
 */

import { RRule } from "https://esm.sh/rrule@2.8.1";
import { adminClient } from "../_shared/admin.ts";
import { downloadMedia, sendText } from "../_shared/whatsapp.ts";
import {
  type AiAction,
  GEMINI_FLASH,
  GEMINI_PRO,
  parseMessage,
  transcribeAudio,
} from "../_shared/gemini.ts";

const MAX_ATTEMPTS = 3;
const CONFIDENCE_ESCALATE = 0.6;
// ponytail: limite fixo por usuário/hora; mover p/ env var se precisar ajustar sem deploy
const MAX_PARSES_PER_HOUR = 60;

type Admin = ReturnType<typeof adminClient>;

/**
 * Gera formatos possíveis do número para casar com o profile.
 * Brasil: o WhatsApp às vezes envia o número SEM o 9º dígito (ex.: 55 51 92553295),
 * enquanto o usuário se cadastra COM o 9 (55 51 992553295). Tenta as duas formas.
 */
function phoneCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const set = new Set<string>([digits]);
  if (digits.startsWith("55")) {
    const rest = digits.slice(2); // DDD + número
    if (rest.length === 11 && rest[2] === "9") {
      set.add("55" + rest.slice(0, 2) + rest.slice(3)); // remove o 9º dígito
    } else if (rest.length === 10) {
      set.add("55" + rest.slice(0, 2) + "9" + rest.slice(2)); // adiciona o 9º dígito
    }
  }
  return [...set];
}

function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** ISO yyyy-mm-dd -> dd-mm-yyyy */
function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}-${m}-${y}` : iso;
}

/** Próxima ocorrência de uma RRULE a partir de `after` (inclusive hoje não). */
function nextOccurrence(recurrence: string, after: Date): Date | null {
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

/** Envio best-effort: nunca lança — uma falha de confirmação não deve reprocessar o job. */
async function trySend(to: string, body: string): Promise<void> {
  try {
    await sendText(to, body);
  } catch (err) {
    console.error("confirmação WhatsApp falhou (ignorado):", err);
  }
}

async function extractText(message: Record<string, unknown>): Promise<string | null> {
  if (message.type === "text") {
    return (message.text as { body?: string })?.body ?? null;
  }
  if (message.type === "audio") {
    const mediaId = (message.audio as { id?: string })?.id;
    if (!mediaId) return null;
    const blob = await downloadMedia(mediaId);
    return await transcribeAudio(blob);
  }
  return null; // outros tipos (imagem/recibo) ficam para a v2
}

/** Resolve conta citada por nome (ilike). Sem match -> null: lançamento nunca falha por conta desconhecida. */
async function resolveAccount(supabase: Admin, userId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("archived", false)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0]?.id ?? null;
}

const KIND_LABEL: Record<string, string> = { expense: "gasto", income: "receita" };

/** Executa uma ação e retorna a linha de resultado da confirmação. */
async function executeAction(
  supabase: Admin,
  userId: string,
  timezone: string,
  action: AiAction,
): Promise<string> {
  const now = new Date();

  switch (action.type) {
    case "create_expense":
    case "create_income": {
      const kind = action.type === "create_expense" ? "expense" : "income";
      if (!action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não entendi o valor. Tenta de novo com o valor (ex.: \"mercado 45\").";
      }
      const accountId = await resolveAccount(supabase, userId, action.account);
      const base = {
        user_id: userId,
        amount_cents: action.amount_cents,
        currency: action.currency ?? "BRL",
        category: action.category?.toLowerCase() ?? null,
        description: action.content ?? action.title,
        account_id: accountId,
      };
      if (action.recurrence) {
        const next = nextOccurrence(action.recurrence, now);
        if (!next) return "❌ Não entendi a recorrência. Tenta \"todo dia 5\" ou \"toda segunda\".";
        const { error } = await supabase.from("recurring_transactions").insert({
          ...base,
          kind,
          rrule: action.recurrence,
          next_run_at: next.toISOString(),
        });
        if (error) throw error;
        const emoji = kind === "expense" ? "🔁💸" : "🔁💰";
        return `${emoji} ${KIND_LABEL[kind]} recorrente: ${centsToBRL(action.amount_cents)}` +
          (base.category ? ` em *${base.category}*` : "") +
          ` — próxima em ${formatDateBR(next.toISOString().slice(0, 10))}.`;
      }
      const { error } = await supabase.from("transactions").insert({
        ...base,
        kind,
        occurred_at: action.occurred_at ?? now.toISOString().slice(0, 10),
        source: "whatsapp",
      });
      if (error) throw error;
      const emoji = kind === "expense" ? "💸" : "💰";
      return `${emoji} ${KIND_LABEL[kind]} anotad${kind === "expense" ? "o" : "a"}: ${centsToBRL(action.amount_cents)}` +
        (base.category ? ` em *${base.category}*` : "") +
        (action.occurred_at ? ` (${formatDateBR(action.occurred_at)})` : "") + ".";
    }

    case "create_transfer": {
      if (!action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não entendi o valor da transferência.";
      }
      const fromId = await resolveAccount(supabase, userId, action.account);
      const toId = await resolveAccount(supabase, userId, action.counterparty_account);
      if (!toId || fromId === toId) {
        return "❌ Não achei a conta de destino. Cadastre as contas no app e cite os nomes (ex.: \"da corrente pra poupança\").";
      }
      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        kind: "transfer",
        amount_cents: action.amount_cents,
        currency: action.currency ?? "BRL",
        description: action.content ?? action.title,
        account_id: fromId,
        counterparty_account_id: toId,
        occurred_at: action.occurred_at ?? now.toISOString().slice(0, 10),
        source: "whatsapp",
      });
      if (error) throw error;
      return `🔄 Transferência de ${centsToBRL(action.amount_cents)} registrada.`;
    }

    case "create_note": {
      const { error } = await supabase.from("notes").insert({
        user_id: userId,
        content: action.content ?? action.title ?? "",
        category: action.category?.toLowerCase() ?? null,
        source: "whatsapp",
      });
      if (error) throw error;
      return `📝 Nota salva: ${action.content ?? action.title ?? ""}`;
    }

    case "create_reminder": {
      if (!action.remind_at && !action.recurrence) {
        return "❌ Não entendi quando te lembrar. Tenta \"me lembra amanhã às 9h\".";
      }
      const { error } = await supabase.from("reminders").insert({
        user_id: userId,
        title: action.title ?? action.content ?? "Lembrete",
        recurrence: action.recurrence,
        next_run_at: action.remind_at ?? nextOccurrence(action.recurrence!, now)?.toISOString() ?? now.toISOString(),
        timezone,
        channel: "both",
        source: "whatsapp",
      });
      if (error) throw error;
      return `⏰ Lembrete criado: *${action.title ?? "sem título"}*` +
        (action.recurrence ? " (recorrente)" : "") + ".";
    }

    case "create_goal": {
      if (!action.goal_name || !action.target_cents || action.target_cents <= 0) {
        return "❌ Para criar meta preciso do nome e do valor (ex.: \"quero juntar 3000 pra viagem\").";
      }
      const { error } = await supabase.from("goals").insert({
        user_id: userId,
        name: action.goal_name,
        target_cents: action.target_cents,
        deadline: action.deadline,
      });
      if (error?.code === "23505") return `❌ Você já tem uma meta chamada *${action.goal_name}*.`;
      if (error) throw error;
      return `🎯 Meta criada: *${action.goal_name}* — ${centsToBRL(action.target_cents)}` +
        (action.deadline ? ` até ${formatDateBR(action.deadline)}` : "") + ".";
    }

    case "goal_deposit": {
      if (!action.goal_name || !action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não entendi o aporte. Tenta \"coloca 200 na meta da viagem\".";
      }
      const { data: goals } = await supabase
        .from("goals")
        .select("id, name, target_cents, saved_cents")
        .eq("user_id", userId)
        .eq("archived", false)
        .ilike("name", `%${action.goal_name}%`)
        .limit(1);
      const goal = goals?.[0];
      if (!goal) return `❌ Não achei a meta *${action.goal_name}*.`;
      const saved = goal.saved_cents + action.amount_cents;
      const { error } = await supabase.from("goals").update({ saved_cents: saved }).eq("id", goal.id);
      if (error) throw error;
      const pct = Math.min(100, Math.round((saved / goal.target_cents) * 100));
      return `🎯 +${centsToBRL(action.amount_cents)} na meta *${goal.name}*: ` +
        `${centsToBRL(saved)} de ${centsToBRL(goal.target_cents)} (${pct}%).` +
        (saved >= goal.target_cents ? " 🎉 Meta batida!" : "");
    }

    case "query_balance": {
      const { data, error } = await supabase.rpc("_account_balances", { uid: userId });
      if (error) throw error;
      const rows = (data ?? []) as { name: string; balance_cents: number }[];
      if (!rows.length) return "💼 Você ainda não tem contas nem lançamentos. Cadastre contas no app!";
      const total = rows.reduce((s, r) => s + Number(r.balance_cents), 0);
      const lines = rows.map((r) => `  • ${r.name}: ${centsToBRL(Number(r.balance_cents))}`);
      return `💼 Saldo total: *${centsToBRL(total)}*\n${lines.join("\n")}`;
    }

    case "query_transactions": {
      const to = action.query_to ?? now.toISOString().slice(0, 10);
      const from = action.query_from ?? `${to.slice(0, 7)}-01`; // default: mês do fim do período
      const { data, error } = await supabase.rpc("_tx_summary", {
        uid: userId,
        from_date: from,
        to_date: to,
      });
      if (error) throw error;
      let rows = (data ?? []) as { kind: string; category: string; total_cents: number; tx_count: number }[];
      if (action.query_kind) rows = rows.filter((r) => r.kind === action.query_kind);
      if (action.query_category) rows = rows.filter((r) => r.category === action.query_category.toLowerCase());
      if (!rows.length) return `📊 Nada registrado entre ${formatDateBR(from)} e ${formatDateBR(to)}.`;
      const spent = rows.filter((r) => r.kind === "expense").reduce((s, r) => s + Number(r.total_cents), 0);
      const earned = rows.filter((r) => r.kind === "income").reduce((s, r) => s + Number(r.total_cents), 0);
      const lines = rows.slice(0, 8).map((r) =>
        `  • ${r.kind === "income" ? "💰" : "💸"} ${r.category}: ${centsToBRL(Number(r.total_cents))} (${r.tx_count}x)`
      );
      const header = [
        spent ? `Gastos: *${centsToBRL(spent)}*` : null,
        earned ? `Receitas: *${centsToBRL(earned)}*` : null,
      ].filter(Boolean).join(" | ");
      return `📊 ${formatDateBR(from)} a ${formatDateBR(to)} — ${header}\n${lines.join("\n")}`;
    }

    case "query_budgets": {
      const { data, error } = await supabase.rpc("_budgets_status", {
        uid: userId,
        ref_month: now.toISOString().slice(0, 10),
      });
      if (error) throw error;
      const rows = (data ?? []) as { category: string; limit_cents: number; spent_cents: number }[];
      if (!rows.length) return "📉 Você ainda não definiu orçamentos. Crie no app, na aba Financeiro!";
      const lines = rows.map((r) => {
        const pct = Math.round((Number(r.spent_cents) / Number(r.limit_cents)) * 100);
        const flag = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
        return `  ${flag} ${r.category}: ${centsToBRL(Number(r.spent_cents))} de ${centsToBRL(Number(r.limit_cents))} (${pct}%)`;
      });
      return `📉 Orçamentos do mês:\n${lines.join("\n")}`;
    }

    case "query_goals": {
      const { data, error } = await supabase
        .from("goals")
        .select("name, target_cents, saved_cents, deadline")
        .eq("user_id", userId)
        .eq("archived", false)
        .order("created_at");
      if (error) throw error;
      if (!data?.length) return "🎯 Você ainda não tem metas. Tenta \"quero juntar 3000 pra viagem até dezembro\"!";
      const lines = data.map((g) => {
        const pct = Math.min(100, Math.round((g.saved_cents / g.target_cents) * 100));
        return `  • ${g.name}: ${centsToBRL(g.saved_cents)} de ${centsToBRL(g.target_cents)} (${pct}%)` +
          (g.deadline ? ` — até ${formatDateBR(g.deadline)}` : "");
      });
      return `🎯 Suas metas:\n${lines.join("\n")}`;
    }

    case "undo_last": {
      const { data } = await supabase
        .from("transactions")
        .select("id, kind, amount_cents, category, description")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      const last = data?.[0];
      if (!last) return "🤷 Não achei nenhum lançamento para apagar.";
      const { error } = await supabase.from("transactions").delete().eq("id", last.id);
      if (error) throw error;
      return `🗑️ Apagado: ${KIND_LABEL[last.kind] ?? last.kind} de ${centsToBRL(last.amount_cents)}` +
        (last.category ? ` em *${last.category}*` : "") + ".";
    }

    default:
      return "🤔 Não entendi essa parte. Tenta algo como: \"gastei 45 no mercado\", \"recebi 500 de freela\" ou \"quanto gastei esse mês?\".";
  }
}

Deno.serve(async (_req) => {
  const supabase = adminClient();

  // reivindicação atômica: cada job vai para um único processador (SKIP LOCKED)
  const { data: jobs, error } = await supabase.rpc("claim_jobs", { batch_size: 10 });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const markDone = (id: string) =>
    supabase.from("jobs").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", id);

  let done = 0;
  for (const job of jobs ?? []) {
    // job já reivindicado (status=processing, attempts incrementado pela claim_jobs)
    const { phone, message, message_raw_id } = job.payload as {
      phone: string;
      message: Record<string, unknown>;
      message_raw_id: string;
    };

    try {
      // 1. resolve usuário pelo telefone
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, timezone, phone")
        .in("phone", phoneCandidates(phone))
        .limit(1);
      const profile = profiles?.[0] ?? null;

      if (!profile) {
        await markDone(job.id);
        await trySend(
          phone,
          "👋 Ainda não encontrei sua conta. Baixe o Personal ProOps app e cadastre-se com este número para começar!",
        );
        continue;
      }

      // 2. texto (transcreve áudio se preciso)
      const text = await extractText(message);
      if (!text) {
        await markDone(job.id);
        await trySend(profile.phone, "🙈 Por enquanto só entendo texto e áudio. Em breve, fotos de recibo!");
        continue;
      }

      // 3. rate limit por usuário: protege custo de Gemini/Groq contra flood
      const { count: parsesLastHour } = await supabase
        .from("ai_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
      if ((parsesLastHour ?? 0) >= MAX_PARSES_PER_HOUR) {
        await markDone(job.id);
        await trySend(profile.phone, "😅 Muitas mensagens em pouco tempo. Aguarda um pouquinho e tenta de novo!");
        continue;
      }

      // 4. Gemini Flash; escala p/ Pro se a confiança for baixa
      let { parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_FLASH);
      if (parsed.confidence < CONFIDENCE_ESCALATE) {
        ({ parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_PRO));
      }

      await supabase.from("ai_events").insert({
        user_id: profile.id,
        message_raw_id,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        confidence: parsed.confidence,
        result: parsed,
      });

      // 5. executa cada ação; uma linha de resultado por ação (falha isolada não derruba as demais)
      const lines: string[] = [];
      for (const action of parsed.actions.slice(0, 10)) {
        try {
          lines.push(await executeAction(supabase, profile.id, profile.timezone, action));
        } catch (err) {
          console.error(`ação ${action.type} falhou:`, err);
          lines.push("❌ Deu erro ao processar uma parte da mensagem. Tenta de novo!");
        }
      }
      if (!lines.length) {
        lines.push("🤔 Não entendi. Tenta algo como: \"gastei 45 no mercado\" ou \"me lembra de pagar a conta dia 10\".");
      }

      // 6. marca done (fonte da verdade salva) ANTES de tentar confirmar
      await markDone(job.id);
      done++;

      // 7. confirmação best-effort no número registrado, UMA mensagem consolidada
      await trySend(profile.phone, lines.join("\n"));
    } catch (err) {
      const failed = job.attempts >= MAX_ATTEMPTS;
      await supabase
        .from("jobs")
        .update({ status: failed ? "failed" : "pending", last_error: String(err) })
        .eq("id", job.id);
      console.error(`job ${job.id}:`, err);
    }
  }

  return new Response(JSON.stringify({ processed: done, total: jobs?.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
});
