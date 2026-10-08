# Fatura parcial, pagar único, detalhe do ciclo, pago × previsto e hipóteses por período — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** os 9 pontos do dono do produto de 07/10/2026, cada um corrigido na raiz e conferido no emulador.

**Architecture:** regra em helper puro (`src/lib`, testado com `node --test`) ou em SQL (testado em
`supabase/tests`), tela só lê. Duas migrations novas (pago × previsto; detalhe do ciclo), só no STAGING.

**Tech Stack:** Expo SDK 57 + expo-router + TanStack Query (`consulta-em-foco`), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-10-07-fatura-ciclo-e-hipoteses-design.md`

## Global Constraints

- Dinheiro sempre `amount_cents` inteiro; exibição por `formatBRL`/`useBRL` (respeita "esconder saldo").
- Nada em produção (`kwriuifcwyvdrxtspjiz`); migrations no staging (`utkqoiigimqzeenxkxdl`) após `scripts/supabase-target.sh </dev/null`.
- Função SQL nova: `set search_path`, `set timezone to 'America/Sao_Paulo'` no cabeçalho, `revoke ... from public, anon`. `create or replace` repete TODAS as cláusulas e guardas do corpo anterior.
- `useQuery` vem de `@/lib/consulta-em-foco`. Rolagem nova com `keyboardShouldPersistTaps="handled"`.
- Menos texto: rótulo curto, explicação na confirmação. Nenhuma barra de ação fixa sobre conteúdo que rola.
- Commit por tarefa, conventional, 1 linha, sem co-autor. Sem tag.
- Portão por tarefa: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída), e conferência no emulador Android com `dev@` (staging).

## Review Focus

1. Fatura com pagamento parcial E vencida: "Pagar" e "Jogar para a próxima" lado a lado; chave desligada quita o RESTO sem transferência (Task 3).
2. Rascunho gravado no aparelho ANTES desta mudança, com a mesma parcela cancelada em dois grupos: a simulação deduplica (Task 4).
3. Ciclo com valores ocultos: a folha "Como chego nesse valor" mascara tudo (Task 7).
4. "Paguei" repetido com o mesmo valor (retry de rede): `expected_amount_cents` não muda (Task 6).
5. Hipótese com data fora do horizonte carregado: o grupo aparece com o rótulo do mês, sem saldo inventado (Task 5).

---

### Task 1: "Ver mais" com respiro (ponto 9)

**Files:**
- Modify: `src/components/ui/ver-mais.tsx`
- Modify: `src/app/finance/cycle.tsx` (componente `Linha`)
- Audit: todos os usos (`grep -rn "<VerMais" src`)

- [ ] Step 1: `wrap` passa de `{ paddingTop: Space.xs }` para respiro simétrico (`paddingVertical: Space.sm`) — o botão nunca encosta no que vem depois.
- [ ] Step 2: no `Linha` do ciclo a fatura aberta é UM filho do `Section` (Fragment); o "Ver mais" das compras fica sem separação da linha seguinte. Garantir respiro + separador antes da próxima linha.
- [ ] Step 3: abrir no emulador cada tela com `VerMais` e lista longa (ciclo, faturas, Projeção mês a mês, parcelas, recorrentes, metas, importação, lançamentos, notas, lembretes, alertas) e corrigir as que ficarem coladas.
- [ ] Step 4: `tsc`, `lint`, `npm test`; commit `fix(ui): ver mais com respiro e separado da linha seguinte`.

### Task 2: fatura paga em parte na face do cartão, em Cartões e na Carteira (ponto 1)

**Files:**
- Modify: `src/lib/card-status.ts` (`CartaoDaPilha`, `LinhaDoResumo`, `cartaoDaPilha`, nova `parcialDaFatura`)
- Test: `src/lib/card-status.test.ts`
- Modify: `src/components/finance/card-face.tsx` (`BaseDaPilha`, `rotuloDoCartao`)
- Modify: `src/app/finance/cards.tsx`, `src/app/finance/wallet.tsx`

**Interfaces:**
- Produces: `parcialDaFatura(c: { invoice_total_cents: number | string | null; invoice_open_cents?: number | string | null }): { pago: number; falta: number } | null`

- [ ] Step 1: teste:

```ts
test('parcialDaFatura: só com pagamento e ainda faltando', () => {
  assert.deepEqual(parcialDaFatura({ invoice_total_cents: 100000, invoice_open_cents: 44067 }), { pago: 55933, falta: 44067 });
  assert.equal(parcialDaFatura({ invoice_total_cents: 100000, invoice_open_cents: 100000 }), null);
  assert.equal(parcialDaFatura({ invoice_total_cents: 100000, invoice_open_cents: 0 }), null);
  assert.equal(parcialDaFatura({ invoice_total_cents: '100000', invoice_open_cents: '25000' })?.falta, 25000);
  assert.equal(parcialDaFatura({ invoice_total_cents: 100000 }), null);
});
```

- [ ] Step 2: rodar, falha. Step 3: implementar:

```ts
export function parcialDaFatura(c: { invoice_total_cents: number | string | null; invoice_open_cents?: number | string | null }) {
  const total = Number(c.invoice_total_cents ?? 0);
  if (c.invoice_open_cents == null) return null;
  const falta = Number(c.invoice_open_cents);
  return falta > 0 && falta < total ? { pago: total - falta, falta } : null;
}
```
`cartaoDaPilha` passa a copiar `invoice_open_cents`.
- [ ] Step 4: `BaseDaPilha`: com `parcialDaFatura(card)`, o rodapé ganha "pago X · falta **Y**"; `rotuloDoCartao` diz "fatura de X, falta Y". Cartões e Carteira: linha "Pago X · falta Y" logo abaixo do total.
- [ ] Step 5: emulador (staging `dev@`): pagar parte de uma fatura, conferir os três lugares, fonte 1,3, valores ocultos; commit `feat(cartao): fatura paga em parte mostra pago e quanto falta`.

### Task 3: um botão "Pagar" no topo da fatura, a folha decide se desconta da conta (pontos 2 e 8)

**Files:**
- Create: `src/lib/pagar-fatura.ts`; Test: `src/lib/pagar-fatura.test.ts`
- Modify: `src/app/finance/invoice/[id].tsx`
- Modify: `.claude/rules/design.md` (registrar a decisão de 07/10/2026 sobre ação no topo da fatura)

**Interfaces:**
- Produces: `podeConfirmarPagamento({ desconta, payerId, dataISO, valorCents, falta }): boolean`

- [ ] Step 1: teste do helper (chave ligada exige conta, valor 1..falta e data; desligada só exige data):

```ts
test('pagar fatura: chave ligada x desligada', () => {
  const base = { payerId: 'a', dataISO: '2026-10-07', valorCents: 1000, falta: 5000 };
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true }), true);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, payerId: null }), false);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, valorCents: 6000 }), false);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: false, payerId: null, valorCents: 0 }), true);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: false, dataISO: null }), false);
});
```
- [ ] Step 2: implementar o helper; rodar.
- [ ] Step 3: no `cabecalho`, dentro do `InvoiceDock` (depois das linhas de pago/parcial), quando `podePagar`: `ButtonRow` com `Button "Pagar"` (primário, `abrirPagamento`) e, se `podeAdiar`, `Button "Jogar para a próxima"` (secundário). Remover `rodape` e `ListFooterComponent`.
- [ ] Step 4: folha: estado `desconta` (true ao abrir). No topo, chave "Descontar de uma conta". Ligada: Valor, Pagar com, Data, botão "Paguei R$ X com <conta>" → `registrar`. Desligada: só Data, linha "Fica paga sem mexer no saldo." e botão "Marcar como paga" → `settle.mutate({ invoiceId, paidAt: dataISO })`, sem segundo diálogo (a folha já é a confirmação). Botões desabilitados com `pay.isPending || settle.isPending`. Erro do settle dentro da folha, como o do pay.
- [ ] Step 5: menu "…": "Marcar como paga" vira "Pagar…" abrindo a folha (só com `podePagar`).
- [ ] Step 6: `acao=pagar` (vindo de Cartões) continua abrindo a folha.
- [ ] Step 7: design.md: nota "a fatura tem as ações no TOPO, sob o total (07/10/2026)".
- [ ] Step 8: emulador: fatura longa, Pagar visível sem rolar; ligada → transferência e saldo da conta cai; desligada → paga, sem transferência; parcial; vencida com os dois botões; duplo toque; commit `feat(fatura): pagar unico no topo com escolha de descontar da conta`.

### Task 4: adiantar desconta o que o rascunho já adiantou (ponto 6)

**Files:**
- Modify: `src/lib/anticipation.ts`; Test: `src/lib/anticipation.test.ts`
- Modify: `src/app/finance/forecast.tsx`, `src/components/finance/anticipation-fields.tsx`, `src/hooks/use-finance.ts` (`paraOBanco`)

**Interfaces:**
- Produces:
  - `chaveDaParcela(ref_id: string, day: string): string` → `${ref_id}|${day}`
  - `parcelasJaAdiantadas(drafts: DraftDeAdiantamento[], exceto?: string): Set<string>` — o `ref_id` do cancel vem do draft de pagamento do mesmo `grupo` (rascunho antigo também serve)
  - `semAsJaAdiantadas(lista: Adiantavel[], ja: Set<string>): Adiantavel[]`
  - `semCancelamentoRepetido<T extends DraftDeAdiantamento>(drafts: T[]): T[]`
  - `faltamDepois(drafts: DraftDeAdiantamento[], candidatos: Adiantavel[]): Map<string, number>` (chave = grupo)

- [ ] Step 1: testes:

```ts
const item: Adiantavel = { source: 'plan', ref_id: 'p', title: 'TV', account_name: null, total_n: 12, taxa: null,
  events: ['2026-11-10','2026-12-10','2027-01-10','2027-02-10','2027-03-10','2027-04-10'].map((day, i) => ({ n: 7 + i, day, cents: 100, pv_cents: 100 })) };
test('o segundo adiantamento não reoferece as parcelas do primeiro', () => {
  const g1 = draftsDoAdiantamento(item, item.events.slice(-3), 300, '2026-11-01', 'g1', { quantas: 3, quais: 'ultimas' });
  const resto = semAsJaAdiantadas([item], parcelasJaAdiantadas(g1));
  assert.deepEqual(resto[0].events.map((e) => e.n), [7, 8, 9]);
  assert.equal(semAsJaAdiantadas([item], parcelasJaAdiantadas(g1, 'g1'))[0].events.length, 6); // editando g1
});
test('rascunho antigo com cancelamento repetido é deduplicado', () => {
  const g1 = draftsDoAdiantamento(item, item.events.slice(-3), 300, '2026-11-01', 'g1');
  const g2 = draftsDoAdiantamento(item, item.events.slice(-3), 300, '2026-12-01', 'g2');
  const limpo = semCancelamentoRepetido([...g1, ...g2]);
  assert.equal(limpo.filter((d) => d.mode === 'cancel').length, 3);
  assert.equal(limpo.filter((d) => d.mode === 'total').length, 2);
});
test('faltam depois de cada adiantamento, em ordem de pagamento', () => {
  const g1 = draftsDoAdiantamento(item, item.events.slice(-3), 300, '2026-11-01', 'g1');
  const g2 = draftsDoAdiantamento(item, item.events.slice(1, 3), 200, '2026-12-01', 'g2');
  const f = faltamDepois([...g2, ...g1], [item]);
  assert.equal(f.get('g1'), 3); // depois de nov: 7,8,9 (10,11,12 adiantadas)
  assert.equal(f.get('g2'), 0); // depois de dez: 8,9 adiantadas; 7 vence em nov
});
```
- [ ] Step 2: implementar (puro, sem tocar o motor SQL); `paraOBanco` aplica `semCancelamentoRepetido` antes de mandar.
- [ ] Step 3: `forecast.tsx`: `adiantaveis.data` passa por `semAsJaAdiantadas(…, parcelasJaAdiantadas(adiantamentos, editando ?? undefined))` antes de `itemAdiantar`; seletor e hint de `AdiantarCampos` leem a lista líquida.
- [ ] Step 4: linha do adiantamento: `… · faltam N` com `faltamDepois` sobre os candidatos de hoje.
- [ ] Step 5: emulador: adiantar 3 em nov e mais em dez da mesma compra; lista, teto, "faltam", saldo final igual ao de um adiantamento único equivalente; commit `fix(e-se): adiantar desconta as parcelas ja adiantadas no rascunho`.

### Task 5: hipóteses agrupadas por período, com o saldo do período e prévia na folha (pontos 5 e 7)

**Files:**
- Create: `src/lib/hipoteses-por-periodo.ts`; Test: `src/lib/hipoteses-por-periodo.test.ts`
- Modify: `src/hooks/use-finance.ts` (`useSimulacao` aceita `comMeses`)
- Modify: `src/app/finance/forecast.tsx` (lista do rascunho; prévia na folha)

**Interfaces:**
- Produces:
  - `periodoDe(meses: MesProjetado[], iso: string): MesProjetado | null`
  - `agruparPorPeriodo<T>(itens: { data: string; item: T }[], meses: MesProjetado[]): { chave: string; mes: string; periodo: MesProjetado | null; itens: T[] }[]` — ordem cronológica; dentro do grupo, por data
  - `useSimulacao({..., comMeses?: boolean })` devolve `meses` também no modo `'dia'`

- [ ] Step 1: testes (bordas de ciclo 11/09–10/10; data fora do horizonte → `periodo: null`, chave = mês civil; ordem estável).
- [ ] Step 2: implementar; rodar.
- [ ] Step 3: `useSimulacao`: com `comMeses` a leitura `meses` vai junto da `forecast`.
- [ ] Step 4: lista do rascunho: hipóteses (`dataDaHipotese`) e adiantamentos (`start` do pagamento) entram juntos em `agruparPorPeriodo`; cabeçalho por grupo `"Dezembro · fecha em −R$ 300"` (`Money` em `danger` se negativo; sem número se `periodo` nulo).
- [ ] Step 5: prévia da folha: simulação do rascunho + a hipótese em edição (só completa), `modo: 'mes'`, depois de 350 ms sem mudança, SEM placeholder; o "era" sai da projeção real por mês. Linha acima dos botões: "Dezembro fecha em −R$ 300 · era R$ 120". Adiantamento usa o mês do pagamento.
- [ ] Step 6: emulador: hipótese em dezembro negativa; trocar régua Mês/Ciclo; várias hipóteses em meses diferentes; valores ocultos; commit `feat(e-se): hipoteses por periodo com saldo e previa antes do resultado`.

### Task 6: pago × previsto (ponto 4)

**Files:**
- Create: `supabase/migrations/<ts>_valor_previsto_da_baixa.sql`, `supabase/tests/valor_previsto_da_baixa.sql`
- Create: `src/lib/previsto.ts`; Test: `src/lib/previsto.test.ts`
- Modify: `src/hooks/use-finance.ts`, `src/lib/debt-history.ts`, `src/components/finance/debt-timeline.tsx`, `src/app/finance/installments.tsx`, `src/app/finance/recurring.tsx` (ocorrências), `src/app/finance/[txId].tsx`, `src/lib/database.types.ts` (regenerado)
- Check: caminho do agente que dá baixa com outro valor (`agent/app`) — grava o previsto igual

**Interfaces:**
- Produces: `previstoDaLinha(t): { rotulo: 'previsto' | 'parcela'; cents: number } | null`

- [ ] Step 1: migration: coluna `transactions.expected_amount_cents bigint` (positivo ou null); `confirm_payment_scoped` com o corpo INTEIRO de `20260927220015` e a baixa gravando `coalesce(expected_amount_cents, anchor.amount_cents)` quando o valor muda; backfill só das ocorrências de recorrente pagas desde 28/09/2026 (o histórico de versões só é confiável dali) com valor diferente da versão vigente na data.
- [ ] Step 2: teste SQL: baixa com outro valor grava o previsto; repetir não muda; baixa no previsto deixa null; escopo `future` grava só na âncora. Suíte SQL inteira contra o Postgres local.
- [ ] Step 3: helper + teste (dívida em parcela fixa: `debt_principal_cents` como "parcela"; com juros nada; fora de dívida: `expected_amount_cents` diferente do pago; pendente nunca).
- [ ] Step 4: telas: linha de apoio ganha `· previsto R$ X` (`· parcela R$ X` na dívida) só quando diferente; `[txId]` mostra "Previsto R$ X" sob o valor quando não há `detalheDoPagamento`.
- [ ] Step 5: staging + types; emulador: pagar ocorrência com outro valor e parcela de dívida a menos; commit `feat(financeiro): valor pago e previsto lado a lado`.

### Task 7: "Como chego nesse valor" (ponto 3)

**Files:**
- Create: `supabase/migrations/<ts>_detalhe_do_ciclo.sql`, `supabase/tests/detalhe_do_ciclo.sql`
- Create: `src/lib/detalhe-do-ciclo.ts` (+ teste), `src/components/finance/detalhe-do-ciclo-sheet.tsx`
- Modify: `src/hooks/use-finance.ts` (`useCycleBreakdown`), `src/app/(tabs)/finance/index.tsx`, `src/app/finance/cycle.tsx` (`Fechamento`; balde extraído para `baldeDaOrigem`), `src/app/finance/forecast.tsx` ("em conta hoje")

**Interfaces:**
- Produces: `cycle_breakdown(p_month date, p_view text default null) returns jsonb`:
  `{ estado, ini, fim, partida: { tipo: 'contas'|'anterior'|'inicio', cents, contas: [{ account_id, nome, tipo, cents }] }, entra, sai, por_origem: [{ origin, in_cents, out_cents }], resultado, faltou_pagar }`
  - aberto: contas de `private.caixa_das_contas(ws, current_date)`; entra/sai/por_origem só de `cash_events` com `not realizado`
  - previsto: partida `anterior` = `comecei_com`; eventos do ciclo inteiro
  - fechado: partida `inicio` = `comecei_com`; eventos do ciclo; `resultado` = `caixa_no_fim`
- `baldeDaOrigem(origin: string, entra: boolean): string` (o mesmo de `agrupar` no ciclo)

- [ ] Step 1: teste SQL: ciclo aberto, previsto e fechado, nas duas réguas: `partida.cents + entra − sai = resultado` de `cycle_series` (fechado: `caixa_no_fim`) e `sum(contas) = partida.cents`.
- [ ] Step 2: migration (par interna/wrapper, invoker, fuso, revoke); staging; types.
- [ ] Step 3: helper do balde + teste; o ciclo passa a usá-lo.
- [ ] Step 4: folha "Como chego nesse valor": Partida (cada conta, ou "Veio do ciclo anterior"/"Comecei com"), "+ Ainda entra", "− Ainda sai" por natureza, "= Fecho em" (ou "Sobrou"); "Hipóteses do rascunho" quando a tela soma rascunho; "Ver o que fecha o ciclo". Tudo mascarável.
- [ ] Step 5: entradas: número do herói de Finanças, número do `Fechamento`, "em conta hoje" da Projeção (folha só com as contas).
- [ ] Step 6: emulador: soma da folha = número tocado, nos três estados e nas duas réguas; commit `feat(ciclo): detalhe de como chego no valor do ciclo`.

### Task 8: fechamento

- [ ] Suíte SQL inteira, `tsc`, `lint`, `npm test`, `ruff`/`pytest` se o agente mudou.
- [ ] Revisão de código do conjunto; corrigir o que for real.
- [ ] Regras: `finance.md`/`frontend.md`/`design.md` com as decisões novas; `docs/AGENTE-PARIDADE-COM-O-APP.md` se algo do app não tem par no agente.
- [ ] Passada final no emulador por todas as telas tocadas (claro/escuro, fonte 1,3).
