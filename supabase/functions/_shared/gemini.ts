/**
 * Parsing/categorização com Google Gemini (saída estruturada via responseSchema).
 * Flash-Lite para volume (cota de 500/dia); escala para o Flash maior quando a
 * confiança fica baixa.
 *
 * Multi-intent: uma mensagem pode virar VÁRIAS ações (lista de gastos, gasto +
 * lembrete, consulta + nota...). O schema é um objeto flat único por ação —
 * Gemini structured output lida mal com anyOf/union.
 *
 * Só `type` é obrigatório: os demais campos NÃO levam `nullable` no schema, o
 * modelo simplesmente omite o que não se aplica — ver os dois limites medidos
 * na nota do ACTION_SCHEMA antes de mexer em qualquer campo.
 */

import { localDateTimeISO } from "./datetime.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * Modelos FIXADOS, não alias.
 *
 * `gemini-flash-latest` já nos custou uma quebra em produção: o alias migrou
 * sozinho para o Gemini 3.7 Flash, que (a) recusa o nosso responseSchema e
 * (b) tem cota grátis de 20 requisições POR DIA. O parse parou sem ninguém
 * mexer em nada.
 *
 * O preço de fixar é ter que revisar quando o modelo for descontinuado — mas
 * isso avisa com 404 explícito, e não silenciosamente com o comportamento
 * mudando debaixo do produto.
 *
 * Escolha do modelo é COTA, não só qualidade. No nível gratuito (verificado no
 * painel em 27/08/2026): Flash 3.6/3.7 = 5 RPM e **20 requisições por dia**;
 * Flash-Lite 3.1/3.5 = 15 RPM e **500 por dia**. Vinte por dia não sustenta nem
 * uma sessão de teste, então o principal é Lite.
 *
 * O Lite errava o valor em mensagem composta ("quero juntar 5000 E me lembra do
 * aluguel" devolvia meta sem valor) — e com confiança 1.0, ou seja,
 * confiantemente errado, que escalonamento nenhum pega. Resolvido com exemplos
 * explícitos de campo multiuso no prompt, não trocando de modelo.
 */
export const GEMINI_PARSE = "gemini-3.5-flash-lite";
/**
 * Escalonamento por baixa confiança. Flash "cheio" tem só 20 requisições/dia no
 * nível gratuito — insustentável como principal, mas perfeito para o caso raro.
 * (Antes era o Pro, que tem cota ainda menor e vivia estourado.)
 */
export const GEMINI_ESCALATE = "gemini-3.6-flash";
/** Categorizar linhas de extrato é classificação simples: o Lite mais barato serve. */
export const GEMINI_BATCH = "gemini-3.1-flash-lite";

export const SUGGESTED_CATEGORIES = [
  "mercado", "transporte", "lazer", "contas", "saúde", "casa",
  "educação", "assinaturas", "restaurante", "salário", "freela", "outros",
] as const;

export type AiActionType =
  | "create_expense"
  | "create_income"
  | "create_transfer"
  | "create_installment_purchase"
  | "pay_invoice"
  | "query_invoice"
  | "query_forecast"
  | "simulate_purchase"
  | "mark_paid"
  | "set_rule"
  | "update_transaction"
  | "delete_item"
  | "query_net_worth"
  | "update_asset_value"
  | "create_note"
  | "create_reminder"
  | "create_goal"
  | "goal_deposit"
  | "query_balance"
  | "query_transactions"
  | "query_budgets"
  | "query_goals"
  | "undo_last"
  | "unknown";

/**
 * ⚠️ DOIS LIMITES DO SCHEMA — medidos, não estimados.
 *
 * A geração nova de modelos (3.1/3.5-flash-lite, 3.6-flash, 3.7-flash) responde
 * 400 INVALID_ARGUMENT, sem nenhum detalhe, se o `responseSchema` passar de:
 *   1. **15 propriedades** por ação (16 já falha, com busca binária confirmada);
 *   2. **UM único `enum`** no schema inteiro (o segundo derruba, mesmo com 15
 *      campos e mesmo que o enum tenha só 5 valores).
 * Não tem a ver com o tamanho do prompt: prompt de 200 chars falha igual.
 *
 * Por isso os campos são multiuso: o mesmo `content` é descrição, título do
 * lembrete, nome da meta e gatilho da regra, conforme o `type`. Antes de somar
 * um campo aqui, tire outro — ou o parse inteiro para de funcionar.
 *
 * Só `type` é obrigatório; o modelo omite o que não se aplica (nada de
 * `nullable`, que também engorda o schema).
 */
export interface AiAction {
  type: AiActionType;
  /** Texto principal: descrição, título do lembrete, conteúdo da nota, nome da meta/bem, gatilho da regra. */
  content?: string | null;
  /** Categoria do lançamento — e também a categoria filtrada nas consultas. */
  category?: string | null;
  /** Valor em centavos — e também o alvo da meta, o valor da simulação e o valor novo do bem. */
  amount_cents?: number | null;
  /** Data do lançamento — e também o prazo da meta e a data NOVA em update_transaction. */
  occurred_at?: string | null; // YYYY-MM-DD
  remind_at?: string | null; // ISO datetime local do usuário
  recurrence?: string | null; // RRULE (ex.: FREQ=MONTHLY;BYMONTHDAY=5)
  account?: string | null; // nome livre da conta ou cartão citado
  counterparty_account?: string | null; // conta destino (transfer, pagamento de fatura)
  installments?: number | null; // nº de parcelas
  // correção: os campos acima dizem QUAL item; estes, o que passa a valer
  new_amount_cents?: number | null;
  new_category?: string | null;
  target_type?: "transaction" | "note" | "reminder" | "goal" | "recurring" | null;
  query_from?: string | null; // YYYY-MM-DD
  query_to?: string | null; // YYYY-MM-DD
}

export interface AiResult {
  actions: AiAction[];
  confidence: number; // 0..1, da mensagem inteira
}

const ACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: {
      type: "STRING",
      enum: [
        "create_expense", "create_income", "create_transfer",
        "create_installment_purchase", "pay_invoice", "query_invoice",
        "query_forecast", "simulate_purchase", "mark_paid", "set_rule",
        "update_transaction", "delete_item", "query_net_worth", "update_asset_value",
        "create_note", "create_reminder", "create_goal", "goal_deposit",
        "query_balance", "query_transactions", "query_budgets", "query_goals",
        "undo_last", "unknown",
      ],
    },
    // ⚠️ 14 campos + `type` = 15, o teto do modelo. Não adicione sem remover.
    content: { type: "STRING" },
    category: { type: "STRING" },
    amount_cents: { type: "INTEGER" },
    occurred_at: { type: "STRING" },
    remind_at: { type: "STRING" },
    recurrence: { type: "STRING" },
    account: { type: "STRING" },
    counterparty_account: { type: "STRING" },
    installments: { type: "INTEGER" },
    new_amount_cents: { type: "INTEGER" },
    new_category: { type: "STRING" },
    // STRING livre de propósito: o schema aceita UM enum só (o de `type`).
    // Os valores válidos vão no prompt e são validados no executor.
    target_type: { type: "STRING" },
    query_from: { type: "STRING" },
    query_to: { type: "STRING" },
  },
  required: ["type"],
} as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    actions: { type: "ARRAY", items: ACTION_SCHEMA, maxItems: 10 },
    confidence: { type: "NUMBER" },
  },
  required: ["actions", "confidence"],
} as const;

function systemPrompt(nowLocal: string, timezone: string): string {
  return `Você é o assistente do Personal ProOps app. O usuário manda mensagens informais em português pelo WhatsApp.
A mensagem pode conter VÁRIOS itens — emita UMA ação por item, na ordem em que aparecem (máx. 10).
Ex.: "mercado 200, uber 30 e recebi 500 de freela" -> 3 ações (2 create_expense + 1 create_income).

Tipos de ação:
- "create_expense": gasto/compra/pagamento com valor. amount_cents (inteiro em centavos: "45 reais" -> 4500), category (curta, minúscula, preferindo: ${SUGGESTED_CATEGORIES.join(", ")}), occurred_at (YYYY-MM-DD; resolva "ontem"/"hoje" pela data atual), description em content. Se citar a conta/cartão ("no nubank"), preencha account. Se for recorrente ("todo mês"), preencha recurrence como RRULE.
- "create_income": dinheiro recebido ("recebi", "caiu o salário", "me pagaram"). Mesmos campos do expense (category ex.: salário, freela).
- "create_transfer": mover dinheiro entre contas próprias ("passei 200 da corrente pra poupança"). account = origem, counterparty_account = destino.
- "create_installment_purchase": compra PARCELADA ("parcelei a geladeira em 12x", "3x de 90 no cartão", "comprei um celular de 3000 em 10 vezes"). amount_cents = valor TOTAL da compra (se o usuário falar o valor DA PARCELA, multiplique pelo número de parcelas), installments = nº de parcelas, account = cartão citado, category, occurred_at = data da compra, description em content. Uma parcela só ("1x") não é parcelamento: use create_expense.
- "pay_invoice": pagamento da fatura do cartão ("paguei a fatura do nubank", "quitei o cartão"). account = cartão, counterparty_account = conta de onde saiu o dinheiro (se citada). NÃO use para compras no cartão.
- "query_invoice": pergunta sobre fatura/limite do cartão ("quanto tá a fatura?", "quanto sobrou de limite no nubank", "quando vence o cartão"). account = cartão citado, ou null para todos.
- "query_forecast": pergunta sobre o FUTURO do saldo ("quanto vai sobrar no fim do mês?", "vou ficar no vermelho?", "o que tenho pra pagar essa semana?"). query_to = até quando (YYYY-MM-DD), se citado.
- "simulate_purchase": pergunta se PODE comprar algo ("posso comprar um celular de 3000 em 10x?", "dá pra gastar 800 esse mês?", "consigo pagar uma viagem de 5 mil?"). amount_cents = valor total, installments = parcelas (1 se à vista). NÃO registra nada — é só simulação.
- "mark_paid": confirmar que uma conta prevista foi paga ("paguei a luz", "quitei o aluguel"). content = do que se trata, amount_cents se citado. Diferente de create_expense: aqui o lançamento JÁ EXISTE como previsto.
- "set_rule": o usuário quer que algo SEMPRE caia numa categoria ("sempre que eu falar ifood põe em restaurante", "posto é transporte", "toda vez que aparecer uber, categoria transporte"). content = o texto que dispara a regra (ex.: "ifood"), category = a categoria de destino.
- "update_transaction": corrigir um lançamento JÁ registrado ("na verdade foi 54, não 45", "muda o último pra transporte", "o mercado de ontem foi 120"). Campos de BUSCA: amount_cents (valor atual), category, content (parte da descrição) — preencha só o que o usuário citou; nada citado = o último lançamento. Campos de CORREÇÃO: new_amount_cents, new_category e occurred_at (que aqui significa a data NOVA, não filtro de busca).
- "delete_item": apagar um item específico ("apaga a nota do mercado", "cancela o lembrete do aluguel", "tira aquele gasto de 45"). target_type tem que ser EXATAMENTE um destes: transaction, note, reminder, goal, recurring. content/amount_cents/category identificam qual. Para "apaga o último lançamento" use undo_last.
- "query_net_worth": pergunta sobre patrimônio ("quanto eu tenho no total?", "qual meu patrimônio?", "quanto vale tudo que eu tenho?", "como tá minha saúde financeira?"). Diferente de query_balance, que é só o saldo em conta.
- "update_asset_value": atualizar o valor de um bem/investimento ("meu tesouro direto tá em 27 mil", "o carro agora vale 38 mil"). content = nome do bem, amount_cents = valor novo.
- "create_note": anotação livre. content (texto limpo) e category curta se óbvia.
- "create_reminder": pedido para ser lembrado. content = o que lembrar, remind_at (próxima ocorrência, ISO, no fuso do usuário) e recurrence como RRULE quando recorrente ("todo dia 5" -> FREQ=MONTHLY;BYMONTHDAY=5; "todo dia às 8h" -> FREQ=DAILY). Sem recorrência -> null.
- "create_goal": meta de poupança ("quero juntar 5000 até dezembro pra viagem"). content = nome da meta, amount_cents = valor alvo, occurred_at = prazo (YYYY-MM-DD) se houver.
- "goal_deposit": aporte em meta existente ("coloca 200 na meta da viagem", "guardei 500 pra viagem"). content = nome da meta. amount_cents = valor do aporte e e OBRIGATORIO: "coloca 200" -> amount_cents=20000. Sem valor, use unknown em vez de goal_deposit.
- "query_balance": pergunta sobre saldo/quanto tem ("quanto tenho?", "saldo das contas").
- "query_transactions": pergunta sobre gastos/receitas ("quanto gastei esse mês?", "gastos com mercado em junho"). query_from/query_to (YYYY-MM-DD, resolva "esse mês"/"semana passada" pela data atual) e category se o usuário citar uma.
- "query_budgets": pergunta sobre orçamento/limite ("como tá meu orçamento?").
- "query_goals": pergunta sobre metas ("como tão minhas metas?").
- "undo_last": desfazer o último lançamento ("apaga o último", "foi engano").
- "unknown": não se encaixa em nada.

Regras:
- Dinheiro SEMPRE em centavos inteiros. "1.234,56" -> 123456.
- Datas relativas resolvidas com a data/hora atual DO USUÁRIO (já convertida para o fuso dele, com offset): ${nowLocal} (fuso ${timezone}). Use exatamente essa data como "hoje" — não recalcule fuso.
- Campos que não se aplicam à ação: OMITA (não mande null).
- Os campos são MULTIUSO: o significado depende do "type". content = descrição, título do lembrete, nome da meta/bem ou gatilho da regra. amount_cents = valor, alvo da meta ou valor do bem. occurred_at = data do lançamento, prazo da meta ou data corrigida.

Exemplos de campo multiuso (siga exatamente este formato):
"quero juntar 5000 ate dezembro pra viagem" -> create_goal com content="viagem", amount_cents=500000, occurred_at="2026-12-31"
"me lembra de pagar o aluguel todo dia 5" -> create_reminder com content="pagar o aluguel", recurrence="FREQ=MONTHLY;BYMONTHDAY=5"
"coloca 200 na meta da viagem" -> goal_deposit com content="viagem", amount_cents=20000
"meu tesouro direto ta em 27 mil" -> update_asset_value com content="tesouro direto", amount_cents=2700000
"apaga a nota do mercado" -> delete_item com target_type="note", content="mercado"
NUNCA deixe amount_cents vazio quando o usuario disser um valor.
- Corrigir algo que já existe é update_transaction ou delete_item — NUNCA crie um lançamento novo para "consertar" outro.
- Compra no cartão à vista é create_expense com account = nome do cartão. Só use create_installment_purchase quando houver 2 ou mais parcelas.
- confidence (0..1) é da interpretação da mensagem INTEIRA.

Quando vier uma IMAGEM ou PDF junto:
- Cupom/nota/comprovante de Pix: UMA ação create_expense (ou create_income se for recebimento) com o valor TOTAL pago, description = nome do estabelecimento, occurred_at = data do documento e category deduzida do que foi comprado.
- Fatura de cartão: UMA ação por lançamento da fatura (respeite o limite de 10 e priorize os maiores), account = nome do cartão que aparece no documento.
- Não conseguiu ler o valor com segurança: devolva uma ação "unknown" e confidence baixa em vez de inventar.`;
}

export interface GeminiUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** fetch com retry + backoff para erros transitórios (503 high demand, 429 rate limit, 5xx). */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt >= retries) return res;

    // 429 é cota: a janela costuma ser de 13s+, e dormir isso DENTRO da função
    // estoura o tempo dela — o job fica preso em `processing` e some do radar.
    // Numa fila com cron de 1 minuto, o próximo tick JÁ é o backoff: desistir
    // rápido devolve o job para a fila e custa 1 minuto, não a execução inteira.
    // (Aprendido na marra: com espera de 30s, dois jobs no lote mataram a função.)
    if (res.status === 429) {
      if (attempt >= 1) return res;
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }

    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt))); // 0.5s, 1s, 2s
  }
}

/** Anexo enviado ao Gemini junto do texto (foto de cupom, PDF de fatura). */
export interface MediaPart {
  mimeType: string;
  /** conteúdo em base64, sem o prefixo data: */
  data: string;
}

export async function parseMessage(
  text: string,
  timezone: string,
  model: string = GEMINI_PARSE,
  media?: MediaPart,
): Promise<{ parsed: AiResult; usage: GeminiUsage }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");

  const res = await fetchWithRetry(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt(localDateTimeISO(new Date(), timezone), timezone) }],
      },
      contents: [{
        role: "user",
        // multimodal: a MESMA chamada e o MESMO responseSchema servem para foto
        // de cupom e PDF de fatura — nada de segundo prompt para imagem
        parts: media
          ? [{ inline_data: { mime_type: media.mimeType, data: media.data } }, { text }]
          : [{ text }],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini falhou (${res.status}): ${body}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini retornou resposta vazia");

  const parsed = JSON.parse(raw) as AiResult;
  if (!Array.isArray(parsed.actions)) throw new Error("Gemini retornou shape inesperado (sem actions)");
  return {
    parsed,
    usage: {
      model,
      inputTokens: data?.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

/**
 * Categoriza N descrições de extrato em UMA chamada.
 * Importar 300 linhas com uma chamada por linha seria caro e lento; aqui o lote
 * inteiro vai junto e volta um array na MESMA ordem (o índice é o contrato).
 */
export async function categorizeBatch(
  descriptions: string[],
  model: string = GEMINI_BATCH,
): Promise<(string | null)[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");
  if (!descriptions.length) return [];

  const schema = {
    type: "OBJECT",
    properties: {
      categories: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["categories"],
  } as const;

  const prompt = `Você categoriza lançamentos de extrato bancário brasileiro.
Receberá uma lista numerada de descrições. Devolva "categories": um array com EXATAMENTE ${descriptions.length} itens, na MESMA ordem da entrada.
Cada item é uma categoria curta e minúscula, preferindo esta lista: ${SUGGESTED_CATEGORIES.join(", ")}.
Não sabe? Use "outros". Não explique nada, não pule itens.`;

  const entrada = descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n");

  const res = await fetchWithRetry(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [{ role: "user", parts: [{ text: entrada }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini (batch) falhou (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini (batch) retornou vazio");
  const parsed = JSON.parse(raw) as { categories?: unknown };
  if (!Array.isArray(parsed.categories)) throw new Error("Gemini (batch) sem categories");

  // o modelo pode devolver menos itens: alinhar por índice e completar com null
  return descriptions.map((_, i) => {
    const c = parsed.categories as unknown[];
    const valor = typeof c[i] === "string" ? (c[i] as string).toLowerCase().trim() : null;
    return valor || null;
  });
}

/** Transcreve áudio com Groq (Whisper) antes de mandar o texto pro Gemini. */
export async function transcribeAudio(audio: Blob, filename = "audio.ogg"): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY ausente");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq falhou (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.text as string;
}
