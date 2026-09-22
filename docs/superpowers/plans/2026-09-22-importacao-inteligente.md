# Importação inteligente de extrato/fatura — plano

> Executado inline nesta sessão (superpowers:executing-plans). Passos em checkbox.

**Goal:** importar OFX/CSV de conta ou cartão mostrando uma PRÉVIA selecionável — novos
pré-marcados, o que já está no app desmarcado com o motivo — sem nunca duplicar, e trazendo
compras parceladas inteiras (parcelas já pagas, a atual e as futuras).

**Architecture:** o parser fica puro (`agent/app/domain/statement.py`) e passa a devolver a
DIREÇÃO bruta do banco; o sentido (gasto/receita/crédito de fatura) é decidido pelo TIPO da conta
do lote (estrutural, nunca por palavra). A conciliação vira um módulo puro em Python
(`agent/app/domain/reconcile.py`) com camadas em cascata e reserva 1-para-1; o importer só carrega
candidatos do banco, chama o módulo e grava o veredito por item. A escrita final é UMA RPC atômica
(`finish_import_batch`) que cria lançamentos e compras parceladas (adotando parcelas antigas que já
existem) e descarta o que ficou desmarcado.

**Tech:** FastAPI/psycopg (agente), Postgres (Supabase staging), Expo/React Native (app).

## Estado de hoje, medido nos arquivos reais (`~/Downloads`)

| arquivo | hoje |
|---|---|
| `Nubank_2026-10-10.csv` (fatura) | 26 de 30 compras viram **receita**; `title` não é reconhecido → todas "Lançamento importado" |
| `Nubank_2026-10-10.ofx` (fatura) | "Pagamento recebido" vira receita no cartão |
| `NU_…_AGO2026.ofx` (conta) | Pix no crédito (entra+sai), RDB, transferência para conta própria, boleto da fatura: tudo receita/despesa comum |
| dedupe | só exato (data+valor+nome) e "mesmo valor ±5 dias" SÓ com conta; ignora lançamento sem conta (WhatsApp) e parcela |
| parcelado com histórico | parcelas "já pagas" criam faturas passadas ABERTAS → viram "Atrasado" fantasma |

## Regras (do pedido do Gabriel, 22/09/2026)

1. Prévia antes de gravar; pré-selecionado o que vai ser importado; marcar/desmarcar à vontade.
2. Camadas comparativas em cascata: uma camada "não achei" passa para a próxima; só é "novo" quem
   passou por todas.
3. Parcelado entra inteiro: parcelas anteriores como pagas, a do arquivo, as futuras.
4. Zero duplicidade — inclusive reimportar o mesmo arquivo e importar o mês seguinte.

## Camadas (ordem = força; cada lançamento do app é reivindicado por UM item só)

| # | camada | casa quando | veredito |
|---|---|---|---|
| 0 | mesmo arquivo | `external_id` (FITID/Identificador) já aprovado antes e o lançamento ainda existe | já no app |
| 1 | idêntico | mesmo sentido, valor, data e nome normalizado (nome OU estabelecimento) | já no app |
| 2 | parcela | item "Parcela k/N" ↔ parcela k de compra de N no app, valor ±N centavos, ±62 dias; ou linha solta com "k/N" no nome e mesmo valor | já no app |
| 3 | mesmo valor, perto | mesmo sentido e valor, ±3 dias; único candidato (ou um claramente mais parecido no nome) | já no app (data diferente → "data diferente") |
| 4 | nome parecido | semelhança ≥ 0,72, valor igual ou ±1%, ±10 dias, único | já no app |
| 5 | talvez | mesmo valor e sentido em ±10 dias, ou empate nas camadas 3/4 | talvez (desmarcado) |
| — | pagamento de fatura / transferência | crédito no cartão ou débito na conta ↔ transferência do app entre essas contas, mesmo valor, ±5 dias | já no app |

Candidatos: lançamentos do workspace na conta do lote **ou sem conta**, de −60 a +60 dias do
período do arquivo, mais transferências que tocam a conta.

## Pré-seleção (o que o app marca sozinho)

Marcado = veredito "novo" E não é: crédito em cartão (pagamento/estorno), nem natureza que a IA
marca como `pagamento_fatura`, `transferencia_propria`, `investimento` ou `saldo_anterior`. A IA
só influencia a pré-seleção — nunca escreve nada; a pessoa vê o motivo e pode marcar.

## Parcelado

`Parcela k/N` (regex ESTRUTURAL, só em conta cartão) → compra de N parcelas de `valor` (total
`valor × N`, estimativa: a última pode diferir centavos), 1ª em `data − (k−1) meses`, 1..k−1
`cleared` (histórico), k..N `pending`. Parcela anterior que já existe no app como linha solta
(mesmo valor ±N centavos, ±10 dias) é ADOTADA, não duplicada. Fatura que só passa a existir por
causa do histórico nasce quitada (`paid`, sem transferência — semântica de `settle_invoice`).

## Tarefas

- [x] T0 Plano.
- [ ] T1 Parser: direção bruta, `external_id`, `title`/`identificador`, tipo do arquivo OFX; testes com os 3 arquivos reais (`agent/tests/test_statement.py`).
- [ ] T2 `reconcile.py` puro + `parse_parcela`: camadas, reserva 1-para-1, adoção de histórico; testes (`agent/tests/test_reconcile.py`).
- [ ] T3 Migration: colunas novas em `import_items`, status `uncertain`, `_prepare_import_batch` só aplica regras, `finish_import_batch` atômica com parcelado/adoção/fatura quitada, histórico do formulário também sem fatura fantasma; teste SQL (`supabase/tests/importacao_inteligente.sql`); migration-reviewer; staging.
- [ ] T4 Importer: conta obrigatória, sentido pelo tipo da conta, natureza via IA (`categorize_batch`), candidatos do banco, grava veredito; pytest.
- [ ] T5 App: tela de prévia selecionável (`src/app/import.tsx`), hooks (`useFinishImport`), types; `simple-finance-ui.test.ts`.
- [ ] T6 Deploy do agente no staging; ponta a ponta no emulador com os 3 arquivos reais: prévia, importar, reimportar (0 novos), "mês seguinte".
