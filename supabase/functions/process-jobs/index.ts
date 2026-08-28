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
import { parseValorEmCentavos } from "../_shared/money-text.ts";
import {
  type AiAction,
  GEMINI_ESCALATE,
  GEMINI_PARSE,
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
  const texto = [action.content, action.category].filter(Boolean).join(" ");
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
  /** Texto original da mensagem — rede de segurança quando a IA omite o valor. */
  texto: string;
  /** ids das transações criadas nesta mensagem — vão para ai_events e viram o desfazer do app. */
  created: string[];
};

/** Resolve conta citada por nome (ilike). Sem match -> null: lançamento nunca falha por conta desconhecida. */
async function resolveAccount(
  supabase: Admin,
  workspaceId: string,
  // campo opcional do schema: vem `undefined` quando o modelo omite
  name: string | null | undefined,
): Promise<string | null> {
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

/**
 * Normaliza o nome da pasta para o formato que o banco EXIGE (0038):
 * `check (name = lower(trim(name)) and char_length(name) between 1 and 40)`.
 * O `trim` do fim NÃO é redundante — o slice pode parar num espaço e o check cairia.
 */
function nomePasta(bruto: string | null | undefined): string | null {
  return bruto?.toLowerCase().trim().slice(0, 40).trim() || null;
}

/**
 * Resolve (criando se preciso) a pasta da nota. Best-effort como `resolveAccount`:
 * falhar aqui devolve null e a nota nasce sem pasta — nota perdida seria pior.
 *
 * `user_id` explícito e obrigatório: `note_folders` NÃO tem `default auth.uid()`
 * de propósito (sob service_role isso viraria null e estouraria o not null).
 * O upsert é legal porque o unique `(workspace_id, name)` é COMPLETO — unique
 * parcial cairia no 42P10 do PostgREST.
 */
async function ensureFolder(
  supabase: Admin,
  workspaceId: string,
  userId: string,
  nome: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  const name = nomePasta(nome);
  if (!name) return null;
  const { data, error } = await supabase
    .from("note_folders")
    .upsert(
      { workspace_id: workspaceId, user_id: userId, name },
      { onConflict: "workspace_id,name" },
    )
    .select("id")
    .single();
  if (error || !data) {
    console.error("ensureFolder falhou (nota fica sem pasta):", error);
    return null;
  }
  return { id: data.id, name };
}

/** Título de uma nota = primeira linha não vazia (a mesma regra da tela de Notas). */
function primeiraLinha(content: string | null | undefined, max = 60): string {
  const linha = (content ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!linha) return "(nota vazia)";
  return linha.length > max ? `${linha.slice(0, max - 1)}…` : linha;
}

interface NotaRow {
  id: string;
  content: string | null;
  updated_at?: string;
  // embed do PostgREST: objeto na relação por FK, mas já veio array em outras versões
  note_folders?: { name: string } | { name: string }[] | null;
}

function pastaDaNota(nota: NotaRow): string | null {
  const f = nota.note_folders;
  if (!f) return null;
  return (Array.isArray(f) ? f[0]?.name : f.name) ?? null;
}

/** Ações que não fazem sentido nenhum sem valor em centavos. */
const PRECISA_VALOR = new Set<string>([
  "create_expense",
  "create_income",
  "create_transfer",
  "create_installment_purchase",
  "create_goal",
  "goal_deposit",
  "simulate_purchase",
  "update_asset_value",
]);

/**
 * Detecta parse estruturalmente incompleto — ação que exige valor e veio sem.
 *
 * Existe porque `confidence` provou ser sinal ruim: o Lite devolve 1.0 e ainda
 * assim omite o valor ("coloca 200 na meta da viagem" vira goal_deposit sem
 * amount_cents). Confiantemente errado é pior que inseguro, e só dá para pegar
 * olhando o resultado, não o que o modelo diz sobre si mesmo.
 */
function parseIncompleto(resultado: { actions: AiAction[] }): boolean {
  return resultado.actions.some(
    (a) => PRECISA_VALOR.has(a.type) && !a.amount_cents,
  );
}

const KIND_LABEL: Record<string, string> = { expense: "gasto", income: "receita" };

/**
 * Ações que NÃO passam por `applyRules`. Regra de categorização é do financeiro;
 * em ação de nota `category` é PASTA e `content` é termo de busca — deixar a
 * regra reescrever isso trocaria a pasta pedida por outra e a consulta voltaria
 * vazia, em silêncio.
 */
const SEM_REGRA = new Set<string>(["update_note", "query_notes"]);

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

  const termo = action.content?.toLowerCase().trim();
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
  // se a IA devolveu a acao certa sem o valor, tenta tirar do texto cru
  if (PRECISA_VALOR.has(action.type) && !action.amount_cents) {
    const doTexto = parseValorEmCentavos(ctx.texto);
    if (doTexto) action = { ...action, amount_cents: doTexto };
  }
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
        currency: "BRL",
        category: action.category?.toLowerCase() ?? null,
        description: action.content,
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
        currency: "BRL",
        description: action.content,
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
        p_description: action.content,
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
      const alvo = action.content;
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
      const padrao = action.content?.trim();
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
      // occurred_at aqui é a data NOVA (o schema não cabe um campo só para isso)
      if (action.occurred_at) patch.occurred_at = action.occurred_at;
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
      // target_type nao e mais enum no schema (o modelo so aceita um enum):
      // validar aqui e o que impede um valor inventado virar tabela inexistente
      const TIPOS = ["transaction", "note", "reminder", "goal", "recurring"] as const;
      const bruto = action.target_type ?? "transaction";
      const tipo = (TIPOS as readonly string[]).includes(bruto) ? bruto as typeof TIPOS[number] : "transaction";
      const termo = action.content?.trim();

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

      let busca = supabase
        .from(tabela)
        .select(`id, ${campoTexto}`)
        .eq("workspace_id", workspaceId)
        .ilike(campoTexto, `%${termo}%`);
      // nota já na lixeira (0038) não pode voltar como candidata
      if (tipo === "note") busca = busca.is("deleted_at", null);

      const { data: achados } = await busca
        .order("created_at", { ascending: false })
        .limit(3);
      const lista = (achados ?? []) as unknown as Record<string, string>[];
      if (!lista.length) return `🤷 Não achei nada com "${termo}".`;
      if (lista.length > 1) {
        const opcoes = lista.map((i) => `  • ${i[campoTexto]}`).join("\n");
        return `🤔 Achei mais de um:\n${opcoes}\nSeja mais específico.`;
      }

      if (tipo === "note") {
        // nota NUNCA some na hora: lixeira de 30 dias (cron `purge-trashed-notes`).
        // Apagar de vez é o jeito mais rápido de perder a confiança do usuário.
        const { error } = await supabase
          .from("notes")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", lista[0].id);
        if (error) throw error;
        return "🗑️ Nota na lixeira — 30 dias para restaurar.";
      }

      const { error } = await supabase.from(tabela).delete().eq("id", lista[0].id);
      if (error) throw error;
      // "note" já saiu pelo ramo da lixeira acima — aqui sobram os que apagam de vez
      const rotulo = { reminder: "Lembrete", goal: "Meta", recurring: "Recorrente" }[tipo];
      return `🗑️ ${rotulo} apagad${tipo === "goal" ? "a" : "o"}: ${lista[0][campoTexto]}`;
    }

    case "query_net_worth": {
      // a foto mais recente do workspace (tirada pelo finance-scheduler)
      const { data: patrimonio } = await supabase
        .from("net_worth_snapshots")
        .select("cash_cents, investments_cents, other_assets_cents, liabilities_cents, net_cents")
        .eq("workspace_id", workspaceId)
        .order("as_of", { ascending: false })
        .limit(1);
      const p = patrimonio?.[0];
      if (!p) {
        return "🏦 Ainda não tenho a foto do seu patrimônio (ela é tirada uma vez por dia). " +
          "Cadastra seus bens no app que amanhã já aparece aqui!";
      }
      return `🏦 Patrimônio líquido: *${centsToBRL(Number(p.net_cents))}*\n` +
        `  💵 em conta: ${centsToBRL(Number(p.cash_cents))}\n` +
        `  📈 investido: ${centsToBRL(Number(p.investments_cents))}\n` +
        `  🏠 outros bens: ${centsToBRL(Number(p.other_assets_cents))}\n` +
        `  🧾 dívidas e faturas: -${centsToBRL(Number(p.liabilities_cents))}`;
    }

    case "update_asset_value": {
      const nome = action.content?.trim();
      if (!nome || !action.amount_cents || action.amount_cents < 0) {
        return "❌ Não entendi. Tenta \"meu tesouro direto tá em 27 mil\".";
      }
      const { data: ativos } = await supabase
        .from("assets")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("archived", false)
        .ilike("name", `%${nome}%`)
        .limit(2);
      if (!ativos?.length) return `🤷 Não achei o bem *${nome}*. Cadastra ele no app primeiro.`;
      if (ativos.length > 1) {
        return `🤔 Achei mais de um: ${ativos.map((a) => a.name).join(", ")}. Qual deles?`;
      }

      const { error } = await supabase.rpc("update_asset_value", {
        p_asset_id: ativos[0].id,
        p_value_cents: action.amount_cents,
        p_as_of: localISODate(now, timezone),
      });
      if (error) throw error;
      return `📈 *${ativos[0].name}* atualizado para ${centsToBRL(action.amount_cents)}.`;
    }

    case "create_note": {
      const categoria = nomePasta(action.category);
      const pasta = await ensureFolder(supabase, workspaceId, userId, categoria);
      const { error } = await supabase.from("notes").insert({
        user_id: userId,
        workspace_id: workspaceId,
        content: action.content ?? "",
        // grava os DOIS durante a transição da 0038: o binário instalado ainda lê
        // `notes.category` nominalmente e a aba Notas quebraria sem ela.
        category: categoria,
        folder_id: pasta?.id ?? null,
        source: "whatsapp",
      });
      if (error) throw error;
      return `📝 Nota salva${pasta ? ` em *${pasta.name}*` : ""}: ${action.content ?? ""}`;
    }

    case "update_note": {
      const termo = action.content?.trim();
      // multiuso: em nota, `new_category` é o TEXTO a acrescentar (o schema está
      // no teto de 15 propriedades — não cabe um campo próprio).
      const trecho = action.new_category?.trim();
      if (!termo || !trecho) {
        return "❌ Não entendi. Tenta \"adiciona pão na nota do mercado\".";
      }
      const { data, error: buscaError } = await supabase
        .from("notes")
        .select("id, content")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .ilike("content", `%${termo}%`)
        .order("updated_at", { ascending: false })
        .limit(3);
      if (buscaError) throw buscaError;
      const notas = (data ?? []) as NotaRow[];
      if (!notas.length) {
        return `🤷 Não achei nota com "${termo}". Se for nova, manda "anotar: ${trecho}".`;
      }
      // empate PERGUNTA, não chuta: escrever na nota errada é o modo de falha que importa
      if (notas.length > 1) {
        const opcoes = notas.map((n) => `  • ${primeiraLinha(n.content)}`).join("\n");
        return `🤔 Achei mais de uma nota com "${termo}":\n${opcoes}\nQual delas?`;
      }
      const nota = notas[0];
      // SEMPRE acrescenta uma linha, nunca substitui — a nota não tem histórico,
      // sobrescrever seria perda irrecuperável.
      const { error } = await supabase
        .from("notes")
        .update({ content: nota.content ? `${nota.content}\n${trecho}` : trecho })
        .eq("id", nota.id);
      if (error) throw error;
      return `📝 Acrescentei em *${primeiraLinha(nota.content)}*: ${trecho}`;
    }

    case "create_reminder": {
      if (!action.remind_at && !action.recurrence) {
        return "❌ Não entendi quando te lembrar. Tenta \"me lembra amanhã às 9h\".";
      }
      const { error } = await supabase.from("reminders").insert({
        user_id: userId,
        workspace_id: workspaceId,
        title: action.content ?? "Lembrete",
        recurrence: action.recurrence,
        next_run_at: action.remind_at
          ? toInstantISO(action.remind_at, timezone, now)
          : nextOccurrence(action.recurrence!, now, timezone)?.toISOString() ?? now.toISOString(),
        timezone,
        channel: "both",
        source: "whatsapp",
      });
      if (error) throw error;
      return `⏰ Lembrete criado: *${action.content ?? "sem título"}*` +
        (action.recurrence ? " (recorrente)" : "") + ".";
    }

    case "create_goal": {
      if (!action.content || !action.amount_cents || action.amount_cents <= 0) {
        return "❌ Para criar meta preciso do nome e do valor (ex.: \"quero juntar 3000 pra viagem\").";
      }
      const { error } = await supabase.from("goals").insert({
        user_id: userId,
        workspace_id: workspaceId,
        name: action.content,
        target_cents: action.amount_cents,
        deadline: action.occurred_at,
      });
      if (error?.code === "23505") return `❌ Você já tem uma meta chamada *${action.content}*.`;
      if (error) throw error;
      return `🎯 Meta criada: *${action.content}* — ${centsToBRL(action.amount_cents)}` +
        (action.occurred_at ? ` até ${formatDateBR(action.occurred_at)}` : "") + ".";
    }

    case "goal_deposit": {
      if (!action.content || !action.amount_cents || action.amount_cents <= 0) {
        return "❌ Não achei o valor do aporte. Manda com o número junto, tipo: *coloca 200 reais na meta viagem*.";
      }
      const { data: goals } = await supabase
        .from("goals")
        .select("id, name, target_cents, saved_cents")
        .eq("workspace_id", workspaceId)
        .eq("archived", false)
        .ilike("name", `%${action.content}%`)
        .limit(1);
      const goal = goals?.[0];
      if (!goal) return `❌ Não achei a meta *${action.content}*.`;
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
      const cat = action.category?.toLowerCase();
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

    case "query_notes": {
      const termo = action.content?.trim();
      const pasta = nomePasta(action.category);
      // `!inner` só quando a pasta é filtro: com join à esquerda o .eq no embed
      // não filtraria nota nenhuma.
      const embed = pasta ? "note_folders!inner(name)" : "note_folders(name)";
      let q = supabase
        .from("notes")
        .select(`id, content, updated_at, ${embed}`)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
      // plainto_tsquery já escapa a entrada: termo do usuário nunca vira sintaxe
      // de tsquery. `pt_unaccent` (0038) faz "reuniao" achar "reunião".
      if (termo) q = q.textSearch("search_tsv", termo, { type: "plain", config: "pt_unaccent" });
      if (pasta) q = q.eq("note_folders.name", pasta);
      // limites do período no fuso do usuário: `.lte(created_at, "2026-08-27")`
      // compararia com a meia-noite UTC e cortaria o dia inteiro de hoje.
      if (action.query_from) {
        q = q.gte("created_at", toInstantISO(action.query_from, timezone, now));
      }
      if (action.query_to) {
        q = q.lte("created_at", toInstantISO(`${action.query_to}T23:59:59`, timezone, now));
      }

      const { data, error } = await q.order("updated_at", { ascending: false }).limit(5);
      if (error) throw error;
      const notas = (data ?? []) as unknown as NotaRow[];
      if (!notas.length) {
        const alvo = termo || pasta;
        return alvo
          ? `🤷 Não achei nota sobre *${alvo}*.`
          : "📝 Você ainda não anotou nada. Manda \"anotar: ligar pro dentista\"!";
      }

      // formatação em TS puro — nada de segunda chamada de LLM só para escrever
      if (notas.length === 1) {
        const nome = pastaDaNota(notas[0]);
        const corpo = (notas[0].content ?? "").trim();
        return `📝 ${nome ? `*${nome}* — ` : ""}` +
          (corpo.length > 600 ? `${corpo.slice(0, 600)}…` : corpo);
      }
      const linhas = notas.map((n) => {
        const nome = pastaDaNota(n);
        return `  • ${primeiraLinha(n.content)}${nome ? ` _(${nome})_` : ""}`;
      });
      const cabecalho = notas.length === 5 ? "As 5 notas mais recentes" : `Achei ${notas.length} notas`;
      return `📝 ${cabecalho}:\n${linhas.join("\n")}`;
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

      // 3a. anti-flood por hora: protege o custo de Gemini/Groq contra rajada
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

      // 3b. cota do plano (mensal). Limite vive no banco, num lugar só —
      // espalhar número de plano pelo código é como o produto acaba cobrando de
      // um jeito e entregando de outro.
      const { data: planoData } = await supabase.rpc("_plan_status", { ws_id: workspaceId });
      const plano = (planoData ?? [])[0] as
        | { plan: string; status: string; ai_messages_month: number; max_ai_messages_month: number }
        | undefined;
      if (plano && plano.ai_messages_month >= plano.max_ai_messages_month) {
        await markDone(job.id);
        await trySend(
          profile.phone,
          `📊 Você usou as ${plano.max_ai_messages_month} mensagens do plano ${plano.plan} este mês. ` +
            "No app dá para subir de plano e continuar agora mesmo — seus dados continuam todos aí.",
        );
        continue;
      }

      // 4. Gemini Flash; escala p/ Pro se a confiança for baixa
      let { parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_PARSE, media);
      // escala por confiança baixa OU por parse incompleto (o segundo pega o caso
      // que a confiança não pega: modelo seguro de si e ainda assim sem o valor)
      if (parsed.confidence < CONFIDENCE_ESCALATE || parseIncompleto(parsed)) {
        // best-effort: se o modelo maior falhar (cota, indisponibilidade), seguimos com o
        // resultado do Flash. Jogar fora um parse que deu certo por causa do
        // refinamento seria trocar uma resposta mediana por nenhuma.
        try {
          ({ parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_ESCALATE, media));
        } catch (err) {
          console.error("escalonamento falhou; seguindo com o resultado do Lite:", err);
        }
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
          const comRegra = SEM_REGRA.has(action.type)
            ? action
            : await applyRules(supabase, workspaceId, action);
          lines.push(await executeAction(
            supabase,
            { userId: profile.id, workspaceId, timezone: profile.timezone, texto: text, created },
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
