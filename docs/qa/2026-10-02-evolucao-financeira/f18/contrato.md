# F18 — transferência recorrente e encerrar série

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes. Inclui o pedido de 03/10: cancelar uma assinatura (ex.: ChatGPT)
mantendo os meses pagos e tirando só as cobranças futuras.

## Parte A — encerrar uma série (assinatura cancelada)

**Hoje**: "Apagar" apaga a REGRA e as futuras pendentes; "Pausar" para de gerar mas deixa as já
geradas. Nenhum dos dois é "cancelei a assinatura".

**Comportamento**: em Recorrentes (menu da série e no formulário da série), ação **Encerrar**.
A confirmação diz o que fica e o que sai, com números: "Ficam N pagas e M atrasadas. Saem K
cobranças futuras (R$ X). A série vai para Encerradas." Escolha da última cobrança: **a mais
recente que já venceu** (padrão) ou uma data. Distinto de Pausar ("para de gerar por enquanto,
pode voltar") e de Apagar.

**Regras**:
- `end_date` = data escolhida; pode ser ANTES do `next_run_at` (encerrar hoje uma assinatura cujo
  próximo vencimento é no mês seguinte). Não move nem recria nenhuma cobrança.
- Sai, na mesma transação: toda ocorrência da série `pending` com data > `end_date` (pelo
  vencimento fora do cartão, pela data no cartão — a régua de "futura em aberto" do
  `finance.md`), EXCETO as que estão numa fatura paga, adiada ou paga em parte
  (`private.parcela_travada`), que ficam e são contadas na resposta ("1 cobrança ficou porque a
  fatura de 10/11 já foi paga em parte").
- Pagas, atrasadas e históricas ficam. A série continua consultável (Encerradas, "Ver
  ocorrências").
- Idempotente: encerrar de novo com a mesma data não remove nada a mais; com chave de
  requisição (padrão F11). Reabrir = editar o fim (o agendador volta a gerar).
- O editor da série deixa de exigir "Termina em ≥ próximo vencimento": o piso é o **início
  original** (`dtstart`). Fim antes do próximo vencimento é encerramento (mesma limpeza),
  dito na tela antes de salvar.

RPC `public.end_recurring_series(p_recurring_id uuid, p_last_date date, p_request_id uuid)`
→ `{ removed_count, removed_cents, kept_locked_count, end_date }`; `security definer` + wrapper,
`set timezone`, revoke public/anon. Prévia `public.end_recurring_series_preview(p_recurring_id,
p_last_date)` com os mesmos números (para a confirmação).

## Parte B — transferência recorrente entre contas próprias

**Comportamento**: no formulário único, Recorrente → Tipo ganha **Transferência**; aparece
"Da conta" e logo depois "Para a conta" (sem categoria, sem forma de pagamento, sem
classificação). Valor, calendário e fim como qualquer série. Editar ocorrência/regra com o
alcance atual; pausar/encerrar como na parte A. Trocar o tipo da série (transferência ↔
gasto/receita) é conversão explícita (`converter_registro`), nunca troca silenciosa —
`comumParaSerie` deixa de transformar `transfer` em `expense`.

**Regras**:
- `recurring_transactions.counterparty_account_id` (FK `set null`); check: transferência exige
  as duas contas, diferentes; nos outros tipos, nula. Contas do mesmo workspace (gatilho de
  escopo). Origem cartão só no Pix no crédito já suportado; destino nunca cartão.
- O agendador (`scheduler._materialize_occurrence`, adoção de gêmea, `reparar_gemeas`) e
  `materialize_recurring_occurrence` copiam/comparam a contraparte; a ocorrência é uma
  `transactions kind='transfer'` normal (neutra em receita/despesa; mexe nas duas contas uma vez).
- Projeção e previstas (`ledger_expected_lines*`, `recurring_projection_for`,
  `private.recurring_dates_for`, `eventos_de_caixa`): a ocorrência prevista de transferência
  aparece nas duas contas (sai de uma, entra na outra), consolidado zero. Saldo insuficiente na
  origem é aviso da projeção, nunca recusa.
- `update_recurring_series` / `update_recurring_future` aceitam `counterparty_account_id` no
  patch (lista `allowed`), e o histórico de versões guarda a coluna.
- Série de transferência antiga sem contraparte (se houver no banco): fica como está, sem
  materializar novas, e a tela pede o destino ("Escolha para qual conta vai").

Migration `<ts>_recurring_transfers.sql` (coluna, check `not valid` + `validate` depois de
conferir que não há linha violando, versões das funções). Python: `agent/app/jobs/scheduler.py`
+ testes `pytest`.

## Cliente

`src/lib/serie.ts` (`SerieForm.kind` com `transfer`, contraparte, `validaSerie` com piso no
início original, `mudancasDaSerie`), `serie-form.tsx` (`CamposDaSerie`), `lancar.ts`
(`comumParaSerie`), `recurring.tsx` (ação Encerrar com prévia), hooks. Testes em
`src/lib/*.test.ts` e `simple-finance-ui.test.ts`.

## Aceite (matriz)

Encerrar assinatura com próximo vencimento no mês seguinte (nenhuma cobrança nova/movida, as
futuras saem, pagas e atrasadas ficam); encerrar com ocorrência em fatura paga em parte (fica e
é contada); encerrar duas vezes; reabrir. Transferência recorrente: contas iguais / de outro
workspace recusadas; mensal dia 31, semanal, anual; agendador rodado duas vezes (sem
duplicar); série pausada; editar só esta / esta e as próximas / todas; mover data; prevista
tocada materializa; transferência importada adotada; futuro além da janela na projeção; saldo
negativo na origem só avisa; receita/despesa consolidadas não mudam. Nativo nos dois sistemas,
claro/escuro, fonte grande, ocultar valores, Reduzir movimento.
