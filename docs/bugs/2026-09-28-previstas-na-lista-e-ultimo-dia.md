# Previstas na lista, "Paguei" nelas e "último dia" em tudo que se repete

Data: 28/09/2026. Relato do Gabriel no simulador iOS (conta dev@ do **staging**
`utkqoiigimqzeenxkxdl`). Produção não foi tocada. Migrations `20260928210000` a `20260928210060`
aplicadas **só no staging**; o agente não foi publicado.

## O que foi relatado e o que era

| # | Relato | Causa |
|---|---|---|
| 1 | As recorrentes aparecem num bloco à parte em Lançamentos | Decisão da rodada anterior: no staging o agendador não roda, a recorrente nunca vira lançamento e só existia como "prevista", num card separado. Em produção ela vira lançamento em até 1 minuto, mas continuam só previstas a parcela futura de dívida e a recorrente além de 1 ano. |
| 2 | Tocar na prevista não abre nada | O card não tinha ação nenhuma. |
| 3 | Em junho no calendário, "Último dia" marcava 30/09 | `DatePickerField` calculava o fim do mês da data GRAVADA; a grade guardava o mês visível só para ela. |
| 4 | Não dá para marcar a recorrente como paga | Mesma causa do 2: prevista não era lançamento. |
| 5 | Editar pagamento de dívida não tinha "último dia" | A data do pagamento só mudava com "Só este"; com "Este e os próximos"/"Todos" a tela recusava e mandava editar a dívida. Parceladas também não tinham a opção. |
| — | "Parcela com 2 pagas não editava" | `edicaoEscopadaDaCompra` tratava a DATA como contrato: "Esta e as próximas" mandava escolher "Todas", e "Todas" recusava por haver parcela paga. Nenhum alcance deixava mudar a data. |

## Achados durante a correção (não relatados)

- **A prevista mostrava fantasmas**, e o toque gravaria cobrança em dobro (revisor de migration):
  o dia antigo depois de trocar o dia da série, o vencimento 30 ao lado da linha de 04 com
  vencimento 30 (Fundacred), a ocorrência apagada voltando. Visto também no simulador: trocar
  "dia 15" → "último dia" deixava novembro com 15/11 e 30/11; e apagar o 30/11 fazia o 15/11 voltar.
- **"Atrasado" em ocorrência que nasce paga** ("entra como pago" e data passada): a lista oferecia
  "Paguei" numa linha que, gravada, já seria `cleared`.
- **Com o próximo vencimento velho** (série que o agendador não andou), o "Último dia" ficava
  desligado por cair antes do mínimo.
- `restore_deleted_reminder_occurrence` (rodada anterior) executável por `anon`.

## O que mudou

- **Lista**: previstas misturadas por data, no mesmo desenho da linha, com pílula pelo estado
  (`status` vindo do banco: `cleared` para o que nasce pago). Toque em recorrente →
  `materialize_recurring_occurrence` grava a linha que o agendador gravaria (adota a "gêmea" solta,
  recusa estimativa retroativa, idempotente) e abre o detalhe; "Paguei" abre a confirmação; "Apagar"
  é `skip_recurring_occurrence` (só a marca). Parcela de dívida abre a tela da parcela; "Paguei" da
  próxima leva à ficha já no pagamento. O card do topo soma as previstas (o total é o da lista).
- **Leitura de previstas** (`expected_recurring_occurrences`): uma por período, da versão mais nova
  da regra, escolhida ANTES das exclusões; fora do trecho que o agendador gerou; período com cobrança
  real não ganha outra; data apagada/movida não volta. O agendador passa a respeitar a data apagada.
- **Dívida**: data nova + "Este e os próximos"/"Todos" = dia de vencimento do contrato
  (`update_debt_payment_due_day`, uma transação). A data deste pagamento muda; os outros pagamentos
  registrados ficam no dia em que o dinheiro saiu.
- **Parceladas fora do cartão**: "Último dia de todo mês" na criação, em "Editar a compra" e na
  parcela (`create_installment_plan_last_day`, `update_installment_scope_last_day`). A data deixou
  de ser contrato: vale nos três alcances a partir da parcela de referência.
- **Calendário**: o botão segue o mês visível e, antes do mínimo, o primeiro mês permitido.

## Verificação

- SQL: os 64 arquivos de `supabase/tests` no staging em transação desfeita, todos verdes; os novos
  (`ocorrencia_prevista_vira_lancamento`, `data_do_pagamento_move_o_vencimento`,
  `parcelas_no_ultimo_dia`) falharam antes da correção. `income_pending` oscila por procurar o
  "Pix Winicius" pelo nome em todo o banco (há um real no staging).
- `npm test` 1014/1014, `tsc`, lint, `ruff`, `pytest` 1204/1204.
- Simulador iOS (dev@, dados temporários `QA …` apagados por id no fim): calendário em junho →
  30/06; Aluguel em 30/06 na lista; toque na prevista → detalhe; "Paguei" na prevista de 15/10 →
  pago; parcela de dívida → tela da 4ª parcela; pagamento de dívida com "último dia" + "Este e os
  próximos" → contrato `-1`, próximas 31/10, 30/11, 31/12; "Todos" com dia 20 → próximas no 20;
  compra com 2 pagas: "Esta e as próximas" no dia 20 (pagas intocadas), "Todas" + último dia (6 no
  fim do mês), "Só esta" (só a 4ª).
- Emulador Android (`proops_qatest_20260927`, com `-allow-host-audio`): novembro misturado, ações
  da prevista no toque longo, "Apagar" some e não volta.
- Também no iOS: "Paguei" na parcela prevista de uma dívida → folha "Pagar …" da ficha, e o
  pagamento registrado; a parcela aberta pela lista → "Paguei esta parcela" → a mesma folha; novo
  lançamento em conta corrente, 3x, "Último dia" → 30/09, 31/10, 30/11.
- Custo da leitura (conta `teste@`, 300 lançamentos, cache quente): `ledger_expected_lines` de um
  mês ~25 ms, a parte das recorrentes ~10 ms (a primeira chamada fria levou 710 ms).

## Pendências

- **Produção**: `20260928210000` a `20260928210060` → agente (agendador) → app, só com pedido.
- No toque na prevista a linha some por ~1 s antes de voltar como lançamento (a leitura das previstas volta antes da lista).
