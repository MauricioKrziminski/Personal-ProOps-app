/**
 * Importa extrato/fatura em OFX ou CSV e devolve os lançamentos para revisão.
 *
 * É o substituto do Open Finance: em vez de pagar R$2,5k/mês de agregador, o
 * usuário exporta o extrato do banco (todo banco brasileiro exporta OFX ou CSV)
 * e manda aqui. Foto de cupom e PDF de fatura entram por outro caminho, direto
 * no WhatsApp (`process-jobs` com Gemini multimodal).
 *
 * Nada vira `transactions` aqui: tudo entra como `import_items` para revisão.
 * Importação silenciosa e errada é exatamente a reclamação que os concorrentes
 * colecionam — quem confirma é o usuário, na tela.
 *
 * Custo: a categorização é feita em UMA chamada Gemini para o lote inteiro, e só
 * das linhas que as regras do usuário não resolveram.
 */

import { adminClient } from "../_shared/admin.ts";
import { GEMINI_FLASH, categorizeBatch } from "../_shared/gemini.ts";
import { parseCSV, parseOFX } from "../_shared/statement-parser.ts";

const MAX_ITEMS = 500;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "use POST" }), { status: 405 });
  }

  const supabase = adminClient();
  try {
    const { user_id, workspace_id, account_id, filename, content, source } = await req.json() as {
      user_id: string;
      workspace_id: string;
      account_id?: string | null;
      filename?: string;
      content: string;
      source: "ofx" | "csv";
    };

    if (!user_id || !workspace_id || !content) {
      return new Response(JSON.stringify({ error: "user_id, workspace_id e content são obrigatórios" }), {
        status: 400,
      });
    }

    // importação é recurso de plano pago: checa antes de gastar parse e IA
    const { data: planoData } = await supabase.rpc("_plan_status", { ws_id: workspace_id });
    const plano = (planoData ?? [])[0] as { plan: string; can_import: boolean } | undefined;
    if (plano && !plano.can_import) {
      return new Response(
        JSON.stringify({
          error: `Importar extrato é do plano Pro. No ${plano.plan} dá para registrar pelo WhatsApp à vontade.`,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }

    const linhas = (source === "ofx" ? parseOFX(content) : parseCSV(content)).slice(0, MAX_ITEMS);
    if (!linhas.length) {
      return new Response(
        JSON.stringify({ error: "não encontrei lançamentos nesse arquivo" }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        workspace_id,
        user_id,
        source,
        filename: filename ?? null,
        account_id: account_id ?? null,
        status: "review",
      })
      .select("id")
      .single();
    if (batchError) throw batchError;

    // 1. staging cru: dedupe_hash sai do trigger, ninguém aqui precisa saber a regra
    const { error: itemsError } = await supabase.from("import_items").insert(
      linhas.map((linha) => ({
        batch_id: batch.id,
        workspace_id,
        kind: linha.kind,
        amount_cents: linha.amount_cents,
        occurred_at: linha.occurred_at,
        description: linha.description,
        suggested_account_id: account_id ?? null,
        raw: linha as unknown as Record<string, unknown>,
      })),
    );
    if (itemsError) throw itemsError;

    // 2. regras do usuário + marcação de duplicata, tudo em UMA chamada ao banco
    const { data: preparo, error: prepError } = await supabase.rpc("_prepare_import_batch", {
      p_batch_id: batch.id,
    });
    if (prepError) throw prepError;
    const resumo = (preparo ?? [])[0] as
      | { total: number; categorizados: number; duplicados: number }
      | undefined;

    // 3. só o que as regras não resolveram vai ao Gemini — UMA chamada para o lote
    const { data: semCategoria } = await supabase
      .from("import_items")
      .select("id, description")
      .eq("batch_id", batch.id)
      .is("suggested_category", null);

    let categorizadosIa = 0;
    if (semCategoria?.length) {
      try {
        const sugeridas = await categorizeBatch(
          semCategoria.map((i) => i.description ?? ""),
          GEMINI_FLASH,
        );
        for (const [i, item] of semCategoria.entries()) {
          const categoria = sugeridas[i];
          if (!categoria) continue;
          await supabase
            .from("import_items")
            .update({ suggested_category: categoria })
            .eq("id", item.id);
          categorizadosIa++;
        }
      } catch (err) {
        // sem categoria o item ainda é revisável: nunca derruba a importação
        console.error("categorização em lote falhou (segue sem categoria):", err);
      }
    }

    return new Response(
      JSON.stringify({
        batch_id: batch.id,
        items: resumo?.total ?? linhas.length,
        duplicates: resumo?.duplicados ?? 0,
        categorized: (resumo?.categorizados ?? 0) + categorizadosIa,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("import-statement:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
