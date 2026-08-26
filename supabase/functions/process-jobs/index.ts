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

import { adminClient } from "../_shared/admin.ts";
import { downloadMedia, sendText } from "../_shared/whatsapp.ts";
import { localISODate, toInstantISO } from "../_shared/datetime.ts";
import { nextOccurrence } from "../_shared/recurrence.ts";
import {
  type AiAction,
  GEMINI_FLASH,
  GEMINI_PRO,
  type MediaPart,
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

/** Envio best-effort: nunca lança — uma falha de confirmação não deve reprocessar o job. */
async function trySend(to: string, body: string): Promise<void> {
  try {
    await sendText(to, body);
  } catch (err) {
    console.error("confirmação WhatsApp falhou (ignorado):", err);
  }
}

/** Anexos que a IA consegue ler direto (Gemini multimodal). */
const VISION_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
/** Limite do inline_data do Gemini (~20MB no request inteiro); 8MB é folgado. */
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

interface Extracted {
  text: string;
  media?: MediaPart;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // btoa direto estoura o stack com arquivo grande: converte em blocos
  let binario = "";
  const bloco = 8192;
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloco));
  }
  return btoa(binario);
}

/**
 * Traz o conteúdo da mensagem para o formato do Gemini.
 * Texto e áudio (via Whisper) viram texto; foto de cupom, print de Pix e PDF de
 * fatura vão como anexo multimodal, com a legenda do usuário como contexto.
 */
async function extractContent(message: Record<string, unknown>): Promise<Extracted | null> {
  if (message.type === "text") {
    const body = (message.text as { body?: string })?.body;
    return body ? { text: body } : null;
  }

  if (message.type === "audio") {
    const mediaId = (message.audio as { id?: string })?.id;
    if (!mediaId) return null;
    const blob = await downloadMedia(mediaId);
    const text = await transcribeAudio(blob);
    return text ? { text } : null;
  }

  if (message.type === "image" || message.type === "document") {
    const anexo = (message.image ?? message.document) as
      | { id?: string; caption?: string; mime_type?: string; filename?: string }
      | undefined;
    if (!anexo?.id) return null;

    const blob = await downloadMedia(anexo.id);
    const mimeType = anexo.mime_type ?? blob.type;
    if (!VISION_MIME.test(mimeType)) return null;
    if (blob.size > MAX_MEDIA_BYTES) return null;

    const legenda = anexo.caption?.trim();
    return {
      text: legenda
        ? `${legenda}\n\n(o usuário mandou este documento junto — extraia os lançamentos dele)`
        : "Extraia os lançamentos deste documento (cupom, comprovante ou fatura).",
      media: { mimeType, data: await blobToBase64(blob) },
    };
  }

  return null;
}

/**
 * Aplica as regras do usuário sobre a categoria sugerida pela IA.
 * Regra do usuário GANHA da IA: é o antídoto para a queixa de "categorizou
 * errado e não tem como consertar" que os concorrentes colecionam.
 */
async function applyRules(
  supabase: Admin,
  workspaceId: string,
  action: AiAction,
): Promise<AiAction> {
  const texto = [action.content, action.title, action.category].filter(Boolean).join(" ");
  if (!texto) return action;

  const { data } = await supabase.rpc("_match_rule", { ws_id: workspaceId, texto });
  const regra = (data ?? [])[0] as
    | { category: string | null; account_id: string | null; rule_id: string }
    | undefined;
  if (!regra) return action;

  // contador serve para a tela de regras mostrar quais valem a pena manter;
  // best-effort: falhar aqui não pode derrubar o lançamento
  try {
    await supabase.rpc("_bump_rule_hits", { rule_id: regra.rule_id });
  } catch (err) {
    console.error("bump rule hits (ignorado):", err);
  }
  return {
    ...action,
    category: regra.category ?? action.category,
  };
}

/**
 * Escopo de uma execução: quem escreveu (autor) e onde (workspace).
 * A partir da 0010 o dado pertence ao WORKSPACE — leituras e writes filtram por
 * `workspace_id` para que conta compartilhada (casal/família) enxergue tudo.
 */
type Ctx = {
  userId: string;
  workspaceId: string;
  timezone: string;
  /** ids das transações criadas nesta mensagem — vão para ai_events e viram o desfazer do app. */
  created: string[];
};

/** Resolve conta citada por nome (ilike). Sem match -> null: lançamento nunca falha por conta desconhecida. */
async function resolveAccount(supabase: Admin, workspaceId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("archived", false)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0]?.id ?? null;
}

const KIND_LABEL: Record<string, string> = { expense: "gasto", income: "receita" };

/** Quantos lançamentos recentes entram na janela de busca por referência. */
const REFERENCE_WINDOW = 40;

interface TxRef {
  id: string;
  kind: string;
  amount_cents: number;
  category: string | null;
  description: string | null;
  occurred_at: string;
}

/**
 * Acha o lançamento que o usuário citou ("o último", "o de 45", "o mercado de
 * ontem"). Busca na janela recente e filtra pelo que ele mencionou.
 * Devolve `ambiguous` quando sobra mais de um: perguntar é melhor que chutar e
 * alterar o lançamento errado.
 */
async function resolveTransactionRef(
  supabase: Admin,
  workspaceId: string,
  action: AiAction,
): Promise<{ found: TxRef } | { ambiguous: TxRef[] } | { none: true }> {
  const { data } = await supabase
    .from("transactions")
    .select("id, kind, amount_cents, category, description, occurred_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(REFERENCE_WINDOW);

  let candidatos = (data ?? []) as TxRef[];
  if (!candidatos.length) return { none: true };

  const termo = (action.content ?? action.title)?.toLowerCase().trim();
  let filtrou = false;

  if (action.amount_cents) {
    candidatos = candidatos.filter((t) => t.amount_cents === action.amount_cents);
    filtrou = true;
  }
  if (action.category) {
    const cat = action.category.toLowerCase();
    candidatos = candidatos.filter((t) => t.category?.toLowerCase() === cat);
    filtrou = true;
  }
  if (termo) {
    const porTexto = candidatos.filter(
      (t) =>
        t.description?.toLowerCase().includes(termo) ||
        t.category?.toLowerCase().includes(termo),
    );
    // termo que não casa com nada não pode zerar uma busca que já achou por valor
    if (porTexto.length) {
      candidatos = porTexto;
      filtrou = true;
    }
  }
  if (action.occurred_at) {
    const porData = candidatos.filter((t) => t.occurred_at === action.occurred_at);
    if (porData.length) {
      candidatos = porData;
      filtrou = true;
    }
  }

  if (!candidatos.length) return { none: true };
  // sem nenhuma pista, "o último" é a leitura certa
  if (!filtrou) return { found: candidatos[0] };
  if (candidatos.length > 1) return { ambiguous: candidatos.slice(0, 3) };
  return { found: candidatos[0] };
}

function descreveTx(tx: TxRef): string {
  return `${KIND_LABEL[tx.kind] ?? tx.kind} de ${centsToBRL(tx.amount_cents)}` +
    (tx.category ? ` em *${tx.category}*` : "") +
    (tx.description ? ` (${tx.description})` : "");
}

/** Executa uma ação e retorna a linha de resultado da confirmação. */
async function executeAction(
  supabase: Admin,
  ctx: Ctx,
  action: AiAction,
): Promise<string> {
  const { userId, workspaceId, timezone, created } = ctx;
  const now = new Date();

  switch (action.type) {
    case "create_expense":
    case "create_income": {
      const kind = action.type === "create_expense" ? "expense" : "income";
      if (!action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não entendi o valor. Tenta de novo com o valor (ex.: \"mercado 45\").";
      }
      const accountId = await resolveAccount(supabase, workspaceId, action.account);
      const base = {
        user_id: userId,
        workspace_id: workspaceId,
        amount_cents: action.amount_cents,
        currency: action.currency ?? "BRL",
        category: action.category?.toLowerCase() ?? null,
        description: action.content ?? action.title,
        account_id: accountId,
      };
      if (action.recurrence) {
        const next = nextOccurrence(action.recurrence, now, timezone);
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
          ` — próxima em ${formatDateBR(localISODate(next, timezone))}.`;
      }
      const { data: criada, error } = await supabase.from("transactions").insert({
        ...base,
        kind,
        occurred_at: action.occurred_at ?? localISODate(now, timezone),
        source: "whatsapp",
      }).select("id").single();
      if (error) throw error;
      if (criada) created.push(criada.id);
      const emoji = kind === "expense" ? "💸" : "💰";
      return `${emoji} ${KIND_LABEL[kind]} anotad${kind === "expense" ? "o" : "a"}: ${centsToBRL(action.amount_cents)}` +
        (base.category ? ` em *${base.category}*` : "") +
        (action.occurred_at ? ` (${formatDateBR(action.occurred_at)})` : "") + ".";
    }

    case "create_transfer": {
      if (!action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não entendi o valor da transferência.";
      }
      const fromId = await resolveAccount(supabase, workspaceId, action.account);
      const toId = await resolveAccount(supabase, workspaceId, action.counterparty_account);
      if (!toId || fromId === toId) {
        return "❌ Não achei a conta de destino. Cadastre as contas no app e cite os nomes (ex.: \"da corrente pra poupança\").";
      }
      const { data: transferencia, error } = await supabase.from("transactions").insert({
        user_id: userId,
        workspace_id: workspaceId,
        kind: "transfer",
        amount_cents: action.amount_cents,
        currency: action.currency ?? "BRL",
        description: action.content ?? action.title,
        account_id: fromId,
        counterparty_account_id: toId,
        occurred_at: action.occurred_at ?? localISODate(now, timezone),
        source: "whatsapp",
      }).select("id").single();
      if (error) throw error;
      if (transferencia) created.push(transferencia.id);
      return `🔄 Transferência de ${centsToBRL(action.amount_cents)} registrada.`;
    }

    case "create_installment_purchase": {
      if (!action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não entendi o valor da compra parcelada.";
      }
      const parcelas = action.installments ?? 0;
      if (parcelas < 2 || parcelas > 72) {
        return "❌ Não entendi em quantas vezes. Tenta \"parcelei 1200 em 12x no cartão X\".";
      }
      const accountId = await resolveAccount(supabase, workspaceId, action.account);
      if (!accountId) {
        return "❌ Não achei o cartão. Cadastra o cartão no app (com fechamento e vencimento) e cita o nome dele.";
      }
      // toda a regra de divisão + fatura de cada parcela vive na RPC (0013)
      const { error } = await supabase.rpc("create_installment_plan", {
        p_account_id: accountId,
        p_total_cents: action.amount_cents,
        p_installments: parcelas,
        p_occurred_at: action.occurred_at ?? localISODate(now, timezone),
        p_description: action.content ?? action.title,
        p_category: action.category?.toLowerCase() ?? null,
        p_merchant: null,
      });
      if (error) throw error;
      const porParcela = Math.floor(action.amount_cents / parcelas);
      return `💳 Parcelado: ${centsToBRL(action.amount_cents)} em ${parcelas}x de ~${centsToBRL(porParcela)}` +
        (action.category ? ` em *${action.category.toLowerCase()}*` : "") +
        `. As ${parcelas - 1} parcelas seguintes já entraram nas próximas faturas.`;
    }

    case "pay_invoice": {
      const cardId = await resolveAccount(supabase, workspaceId, action.account);
      if (!cardId) return "❌ Não achei o cartão. Cita o nome dele (ex.: \"paguei a fatura do nubank\").";

      const { data: invoices } = await supabase
        .from("card_invoices")
        .select("id, due_date")
        .eq("account_id", cardId)
        .neq("status", "paid")
        .order("reference_month")
        .limit(1);
      const invoice = invoices?.[0];
      if (!invoice) return "🤷 Esse cartão não tem fatura em aberto.";

      // conta de origem: a citada, senão a conta de pagamento do cartão, senão a 1ª corrente
      let payerId = await resolveAccount(supabase, workspaceId, action.counterparty_account);
      if (!payerId) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, type, payment_account_id")
          .eq("workspace_id", workspaceId)
          .eq("archived", false);
        const card = accounts?.find((a) => a.id === cardId);
        payerId = card?.payment_account_id ??
          accounts?.find((a) => a.type === "checking")?.id ?? null;
      }
      if (!payerId) {
        return "❌ Não sei de qual conta saiu. Cadastra a conta de pagamento do cartão no app ou diz \"paguei a fatura do X pela corrente\".";
      }

      const { error } = await supabase.rpc("pay_invoice", {
        p_invoice_id: invoice.id,
        p_account_id: payerId,
        p_paid_at: action.occurred_at ?? localISODate(now, timezone),
      });
      if (error) return `❌ Não consegui pagar a fatura: ${error.message}`;
      return `✅ Fatura paga (vencimento ${formatDateBR(invoice.due_date)}). O limite já voltou.`;
    }

    case "query_invoice": {
      const { data, error } = await supabase.rpc("_card_summary", { uid: userId });
      if (error) throw error;
      let rows = (data ?? []) as {
        name: string;
        invoice_total_cents: number;
        unpaid_total_cents: number;
        available_limit_cents: number;
        due_date: string | null;
        closing_date: string | null;
      }[];
      if (action.account) {
        const alvo = action.account.toLowerCase();
        rows = rows.filter((r) => r.name.toLowerCase().includes(alvo));
      }
      if (!rows.length) {
        return "💳 Você ainda não tem cartão cadastrado. Cadastra no app com o dia de fechamento e de vencimento!";
      }
      const lines = rows.map((r) =>
        `  • *${r.name}*: fatura ${centsToBRL(Number(r.invoice_total_cents))}` +
        (r.due_date ? ` — vence ${formatDateBR(r.due_date)}` : "") +
        (r.closing_date ? ` (fecha ${formatDateBR(r.closing_date)})` : "") +
        `\n    limite disponível: ${centsToBRL(Number(r.available_limit_cents))}`
      );
      return `💳 Cartões:\n${lines.join("\n")}`;
    }

    case "query_forecast": {
      const [forecast, bills] = await Promise.all([
        supabase.rpc("_cash_flow_forecast", { uid: userId, days: 90 }),
        supabase.rpc("_upcoming_bills", { uid: userId, days: 30 }),
      ]);
      if (forecast.error) throw forecast.error;
      let dias = (forecast.data ?? []) as { day: string; balance_cents: number }[];
      if (action.query_to) dias = dias.filter((d) => d.day <= action.query_to!);
      if (!dias.length) return "🔮 Ainda não tenho o que projetar. Cadastre contas e recorrentes!";

      const fim = dias[dias.length - 1];
      const pior = dias.reduce((min, d) =>
        Number(d.balance_cents) < Number(min.balance_cents) ? d : min
      );
      const linhas = [
        `🔮 Projeção até ${formatDateBR(fim.day)}: *${centsToBRL(Number(fim.balance_cents))}*`,
      ];
      if (Number(pior.balance_cents) < 0) {
        linhas.push(
          `  ⚠️ Fica negativo em ${formatDateBR(pior.day)} (${centsToBRL(Number(pior.balance_cents))})`,
        );
      } else {
        linhas.push(`  Menor saldo: ${centsToBRL(Number(pior.balance_cents))} em ${formatDateBR(pior.day)}`);
      }

      const contas = (bills.data ?? []) as {
        title: string;
        amount_cents: number;
        due_date: string;
        overdue: boolean;
      }[];
      if (contas.length) {
        linhas.push("", "📅 A pagar:");
        for (const c of contas.slice(0, 6)) {
          linhas.push(
            `  ${c.overdue ? "🔴" : "•"} ${c.title}: ${centsToBRL(Number(c.amount_cents))} — ${formatDateBR(c.due_date)}`,
          );
        }
      }
      return linhas.join("\n");
    }

    case "simulate_purchase": {
      if (!action.amount_cents || action.amount_cents <= 0) {
        return "❌ Me diz o valor. Ex.: \"posso comprar um celular de 3000 em 10x?\"";
      }
      const parcelas = Math.min(Math.max(action.installments ?? 1, 1), 72);
      const { data, error } = await supabase.rpc("_affordability", {
        uid: userId,
        amount_cents: action.amount_cents,
        installments: parcelas,
      });
      if (error) throw error;
      const sim = (data ?? [])[0] as
        | { can_afford: boolean; worst_day: string; worst_balance_cents: number; installment_cents: number }
        | undefined;
      if (!sim) return "🤔 Não consegui simular. Cadastre suas contas primeiro!";

      const comoPaga = parcelas > 1
        ? `${parcelas}x de ${centsToBRL(Number(sim.installment_cents))}`
        : `${centsToBRL(action.amount_cents)} à vista`;
      if (sim.can_afford) {
        return `✅ Dá sim: ${comoPaga}.\n` +
          `Mesmo assim seu saldo mais apertado fica em ${centsToBRL(Number(sim.worst_balance_cents))} ` +
          `(${formatDateBR(sim.worst_day)}).`;
      }
      return `⚠️ Aperta: com ${comoPaga} você fica em ` +
        `${centsToBRL(Number(sim.worst_balance_cents))} no dia ${formatDateBR(sim.worst_day)}.\n` +
        `Dá para esticar o parcelamento ou adiar um pouco?`;
    }

    case "mark_paid": {
      // procura entre o que está PREVISTO (pending), do mais vencido para o mais novo
      let query = supabase
        .from("transactions")
        .select("id, description, category, amount_cents, due_at, occurred_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending")
        .eq("kind", "expense")
        .order("due_at", { ascending: true })
        .limit(5);
      const alvo = action.content ?? action.title;
      if (alvo) query = query.or(`description.ilike.%${alvo}%,category.ilike.%${alvo}%`);
      if (action.amount_cents) query = query.eq("amount_cents", action.amount_cents);

      const { data: candidatos, error } = await query;
      if (error) throw error;
      if (!candidatos?.length) {
        return "🤷 Não achei essa conta entre as previstas. Se for gasto novo, manda \"paguei X de luz\".";
      }
      if (candidatos.length > 1 && alvo) {
        const opcoes = candidatos
          .slice(0, 3)
          .map((c) => `  • ${c.description ?? c.category}: ${centsToBRL(c.amount_cents)}`)
          .join("\n");
        return `🤔 Achei mais de uma conta parecida:\n${opcoes}\nMe diz o valor pra eu saber qual é.`;
      }

      const conta = candidatos[0];
      const { error: updateError } = await supabase
        .from("transactions")
        .update({ status: "cleared", occurred_at: localISODate(now, timezone) })
        .eq("id", conta.id);
      if (updateError) throw updateError;
      return `✅ Baixa dada: ${conta.description ?? conta.category ?? "conta"} — ${centsToBRL(conta.amount_cents)}.`;
    }

    case "set_rule": {
      const padrao = (action.content ?? action.title)?.trim();
      const categoria = action.category?.toLowerCase().trim();
      if (!padrao || !categoria) {
        return "❌ Não entendi a regra. Tenta \"sempre que eu falar ifood, põe em restaurante\".";
      }
      const { error } = await supabase.from("categorization_rules").upsert(
        {
          workspace_id: workspaceId,
          user_id: userId,
          match_type: "contains",
          pattern: padrao,
          category: categoria,
          source: "user",
        },
        { onConflict: "workspace_id,match_type,pattern" },
      );
      if (error) throw error;
      return `📌 Anotado: tudo que falar *${padrao}* vai para *${categoria}*.\n` +
        `Você pode ver e apagar suas regras no app.`;
    }

    case "update_transaction": {
      const patch: Record<string, unknown> = {};
      if (action.new_amount_cents && action.new_amount_cents > 0) {
        patch.amount_cents = action.new_amount_cents;
      }
      if (action.new_category) patch.category = action.new_category.toLowerCase();
      if (action.new_occurred_at) patch.occurred_at = action.new_occurred_at;
      if (!Object.keys(patch).length) {
        return "❌ Não entendi o que mudar. Tenta \"muda o último pra 54\" ou \"o mercado de ontem era transporte\".";
      }

      const ref = await resolveTransactionRef(supabase, workspaceId, action);
      if ("none" in ref) return "🤷 Não achei esse lançamento nos últimos registros.";
      if ("ambiguous" in ref) {
        const opcoes = ref.ambiguous.map((t) => `  • ${descreveTx(t)} em ${formatDateBR(t.occurred_at)}`);
        return `🤔 Achei mais de um parecido:\n${opcoes.join("\n")}\nMe diz o valor exato pra eu saber qual.`;
      }

      const antes = ref.found;
      const { error } = await supabase.from("transactions").update(patch).eq("id", antes.id);
      if (error) throw error;

      const mudancas: string[] = [];
      if (patch.amount_cents) {
        mudancas.push(`${centsToBRL(antes.amount_cents)} → ${centsToBRL(patch.amount_cents as number)}`);
      }
      if (patch.category) mudancas.push(`categoria → *${patch.category}*`);
      if (patch.occurred_at) mudancas.push(`data → ${formatDateBR(patch.occurred_at as string)}`);
      return `✏️ Corrigido (${descreveTx(antes)}): ${mudancas.join(", ")}.`;
    }

    case "delete_item": {
      const tipo = action.target_type ?? "transaction";
      const termo = (action.content ?? action.title)?.trim();

      if (tipo === "transaction") {
        const ref = await resolveTransactionRef(supabase, workspaceId, action);
        if ("none" in ref) return "🤷 Não achei esse lançamento.";
        if ("ambiguous" in ref) {
          const opcoes = ref.ambiguous.map((t) => `  • ${descreveTx(t)}`);
          return `🤔 Achei mais de um parecido:\n${opcoes.join("\n")}\nMe diz o valor exato.`;
        }
        const { error } = await supabase.from("transactions").delete().eq("id", ref.found.id);
        if (error) throw error;
        return `🗑️ Apagado: ${descreveTx(ref.found)}.`;
      }

      const tabela = {
        note: "notes",
        reminder: "reminders",
        goal: "goals",
        recurring: "recurring_transactions",
      }[tipo];
      const campoTexto = tipo === "note" ? "content" : tipo === "reminder" ? "title" : tipo === "goal" ? "name" : "description";
      if (!termo) return "❌ Me diz qual item apagar (ex.: \"apaga a nota do mercado\").";

      const { data: achados } = await supabase
        .from(tabela)
        .select(`id, ${campoTexto}`)
        .eq("workspace_id", workspaceId)
        .ilike(campoTexto, `%${termo}%`)
        .order("created_at", { ascending: false })
        .limit(3);
      const lista = (achados ?? []) as unknown as Record<string, string>[];
      if (!lista.length) return `🤷 Não achei nada com "${termo}".`;
      if (lista.length > 1) {
        const opcoes = lista.map((i) => `  • ${i[campoTexto]}`).join("\n");
        return `🤔 Achei mais de um:\n${opcoes}\nSeja mais específico.`;
      }

      const { error } = await supabase.from(tabela).delete().eq("id", lista[0].id);
      if (error) throw error;
      const rotulo = { note: "Nota", reminder: "Lembrete", goal: "Meta", recurring: "Recorrente" }[tipo];
      return `🗑️ ${rotulo} apagad${tipo === "note" || tipo === "goal" ? "a" : "o"}: ${lista[0][campoTexto]}`;
    }

    case "create_note": {
      const { error } = await supabase.from("notes").insert({
        user_id: userId,
        workspace_id: workspaceId,
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
        workspace_id: workspaceId,
        title: action.title ?? action.content ?? "Lembrete",
        recurrence: action.recurrence,
        next_run_at: action.remind_at
          ? toInstantISO(action.remind_at, timezone, now)
          : nextOccurrence(action.recurrence!, now, timezone)?.toISOString() ?? now.toISOString(),
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
        workspace_id: workspaceId,
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
        .eq("workspace_id", workspaceId)
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
      const to = action.query_to ?? localISODate(now, timezone);
      const from = action.query_from ?? `${to.slice(0, 7)}-01`; // default: mês do fim do período
      const { data, error } = await supabase.rpc("_tx_summary", {
        uid: userId,
        from_date: from,
        to_date: to,
      });
      if (error) throw error;
      let rows = (data ?? []) as { kind: string; category: string; total_cents: number; tx_count: number }[];
      if (action.query_kind) rows = rows.filter((r) => r.kind === action.query_kind);
      const cat = action.query_category?.toLowerCase();
      if (cat) rows = rows.filter((r) => r.category === cat);
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
        ref_month: localISODate(now, timezone),
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
        .eq("workspace_id", workspaceId)
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
        .eq("workspace_id", workspaceId)
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

      // 1b. workspace do usuário (escopo do dado desde a 0010)
      const { data: workspaceId } = await supabase.rpc("_default_workspace", { uid: profile.id });
      if (!workspaceId) {
        await markDone(job.id);
        await trySend(profile.phone, "😕 Sua conta ainda não tem um espaço criado. Abre o app uma vez e me chama de novo!");
        continue;
      }

      // 2. conteúdo: texto, áudio transcrito ou anexo (foto/PDF) para o Gemini ler
      const content = await extractContent(message);
      if (!content) {
        await markDone(job.id);
        await trySend(
          profile.phone,
          "🙈 Não consegui ler isso. Mando bem com texto, áudio, foto de cupom e PDF de fatura (até 8MB).",
        );
        continue;
      }
      const { text, media } = content;

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
      let { parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_FLASH, media);
      if (parsed.confidence < CONFIDENCE_ESCALATE) {
        ({ parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_PRO, media));
      }

      const { data: aiEvent } = await supabase.from("ai_events").insert({
        user_id: profile.id,
        message_raw_id,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        confidence: parsed.confidence,
        result: parsed,
      }).select("id").single();

      // 5. executa cada ação; uma linha de resultado por ação (falha isolada não derruba as demais)
      const lines: string[] = [];
      const created: string[] = [];
      for (const action of parsed.actions.slice(0, 10)) {
        try {
          const comRegra = await applyRules(supabase, workspaceId, action);
          lines.push(await executeAction(
            supabase,
            { userId: profile.id, workspaceId, timezone: profile.timezone, created },
            comRegra,
          ));
        } catch (err) {
          console.error(`ação ${action.type} falhou:`, err);
          lines.push("❌ Deu erro ao processar uma parte da mensagem. Tenta de novo!");
        }
      }
      if (!lines.length) {
        lines.push("🤔 Não entendi. Tenta algo como: \"gastei 45 no mercado\" ou \"me lembra de pagar a conta dia 10\".");
      }

      // liga o parse ao que ele criou: é o que permite desfazer pela tela de atividade
      if (aiEvent && created.length) {
        await supabase
          .from("ai_events")
          .update({ created_transaction_ids: created })
          .eq("id", aiEvent.id);
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
