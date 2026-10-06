# Domínio financeiro

## Dinheiro

- **Sempre `amount_cents` bigint inteiro e positivo. Nunca float, nunca decimal, nunca `parseFloat`.** Sinal/direção vem do `kind`, não do valor.
- Moeda default BRL. Exibição só via `formatBRL` (app) / `cents_to_brl` (agente).

## Modelo (v1)

- **`transactions`** unificada: `kind in (expense, income, transfer)`. Transfer exige `counterparty_account_id` (check no banco). `occurred_at date`. `source in (whatsapp, app, import, recurring)`.
- **`accounts`**: carteiras/contas com `type in (checking, savings, credit_card, cash, investment)` e `initial_balance_cents`. Saldo é **derivado** (RPC `_account_balances`), nunca coluna materializada. Cartão de crédito tem `closing_day`, `due_day`, `credit_limit_cents` e `payment_account_id` (check no banco: null nos outros tipos).
- **`card_invoices`**: ciclo da fatura (mês de referência, fechamento, vencimento, status). O **total nunca é materializado** — sai de `sum(transactions.amount_cents) where invoice_id = ...`, igual ao saldo de conta.
- **`installment_plans`**: compra parcelada. Uma `transactions` por parcela, uma por mês; as futuras nascem `status='pending'`. Resto da divisão inteira vai na ÚLTIMA parcela (a soma sempre bate com o total).
- **`transactions`** ganhou `status in (pending, cleared)`, `due_at`, `invoice_id`, `installment_plan_id`, `installment_no`, `merchant`. `pending` = ainda vai acontecer; é a base da projeção de fluxo de caixa.
- **`goals`**: `target_cents` + `saved_cents`, que é **derivado da soma de `goal_contributions`** (ledger). Aporte só pela RPC `goal_deposit` — nunca `+=` no cliente. Aporte NÃO vira transação: é movimento entre contas do próprio usuário e lançar como despesa inflaria o gasto do mês.
- **`budgets`**: **gasto e comprometido são colunas separadas, e a régua é "já aconteceu", não
  `status`** (`20260909180000`, validado contra o mercado). `spent_cents` = efetivado **+ parcela
  de cartão** (a compra foi feita, a parcela é inevitável); `committed_cents` = previsto sem
  fatura (dá para adiar). Filtrar só `cleared` seria trocar um erro por outro pior — subestimaria
  justamente o cartão. **O AVISO conta os dois; o número exibido é só o gasto**, que é o destaque
  amarelo do YNAB traduzido: transação agendada não entra no "Activity", mas acende a categoria
  quando o que vem não está coberto. Vale para as 5 telas, as 2 tab bars e o alerta.
  `month` null = limite padrão; linha com `month` sobrescreve aquele mês. **Dois unique parciais** (NULL não colide com NULL no Postgres). `rollover` soma a sobra do mês anterior, um nível só — e **só se o orçamento já existia antes do mês corrente** (`created_at`), senão um orçamento criado hoje ganharia sobra de um mês em que não existia. Status via `_budgets_status`.
- **`debts`**: dívidas com `interest_rate_monthly` em fração mensal (1,99% a.m. = 0.0199). `debt_schedule` monta a Price; `pay_debt_installment` abate o saldo **já descontando os juros do mês**.
  - **`first_due_date` é a âncora do CONTRATO** (`20260923160000`): a data da parcela nº 1. A
    parcela `n` vence em `day_in_month(add_months(first_due_date, n − 1), due_day)`, e
    `private.debt_schedule_for` usa `greatest(<próxima ocorrência do dia a partir de hoje>,
    <parcela pagas+1 do contrato>)` — a carência de 3 meses aparece. `null` é o comportamento antigo.
    **Desde 05/10/2026 (`20261005190000`) a âncora NÃO tem piso de hoje**: o cronograma é o do
    CONTRATO. A parcela `pagas+1` vencida e não paga fica na data dela, como ATRASADA, em vez de
    deslizar para o próximo mês e arrastar todas as seguintes (visto: a 9ª em 23/09, editada no
    app, voltava a 23/10 e o campo "insistia" em 23/10). Quem mostra por data (mês, lista, "O que
    vence") a deixa no dia do contrato; quem consome CAIXA a clampa para hoje (`cash_events` e
    `eventos_de_caixa`: `greatest(due, current_date)`, só na janela que contém hoje, nunca como
    saída de ciclo fechado) — a mesma régua de despesa atrasada. O formulário mostra a data da
    pessoa e, vencida, "Venceu em DD/MM e ainda não foi paga". Sem âncora nada mudou.
  - **Parcela paga no CICLO ATUAL vira lançamento** (`register_counted_debt_payments`,
    `20261005191000`): ao cadastrar (ou aumentar "Parcelas já pagas") o formulário
    pergunta "A 8ª (23/09) já saiu da conta X?" para cada paga cujo vencimento do contrato cai no
    ciclo do banco (`cycle_now`). Sim lança o pagamento pelo MESMO gatilho do "Paguei", ligado à
    parcela, recuando o contador para `k−1` e restaurando o par (pagas, saldo) no fim: o saldo da
    dívida não cai duas vezes, e repetir é no-op (parcela com pagamento é pulada). Não, ou ciclo
    anterior, continua só contada. **Com juros também** (`20261005230000`): o valor é a
    parcela Price (`coalesce(installment_cents, price_installment(saldo, taxa, restantes))`, a de
    `debt_schedule_for`; edição/estimativa declarada da k vale antes) e o saldo ANTES da k sai de
    desfazer, da última paga para trás, a conta do gatilho (`antes + ceil(antes×taxa) − parcela =
    depois`); o gatilho separa juros e amortização e o par (pagas, saldo) volta ao de antes. O app pergunta a PRÓXIMA parcela e grava
    `first = próxima − pagas`.
  - **Com âncora, "já pagou neste ciclo" NÃO empurra nem esconde nada** (`20260923170000`).
    O ramo do ciclo existe para a dívida sem âncora, que não sabe qual parcela foi paga; com
    âncora quem sabe é o contrato (o trigger conta cada pagamento). Mantido, ele pulava a 10ª
    quando a 9ª era paga com atraso dentro do mesmo ciclo — no cronograma (o `greatest` ficava
    com o mês seguinte) e em "O mês inteiro"/ciclo/"livre" (`debt_paid_in_month` escondia a
    linha). Os dois lugares perguntam `first_due_date is null` antes de olhar o ciclo.
  - **O contrato de parcela fixa se edita mesmo com "Paguei" lançado** (decisão do dono do
    produto, 23/09/2026): o `check` segura a aritmética; o pagamento anterior à edição vira
    histórico. **Apagar o pagamento MAIS RECENTE continua valendo** (`20260925150000`): em
    parcela fixa ele desfaz UMA parcela pelo contrato (parcela × restantes), sem conferir o saldo
    que o pagamento guardou — conferindo, o "Paguei" seguido de "Editar dívida" ficava impossível
    de apagar (visto em produção em 25/09/2026). Com juros a conferência continua.
  - **Parcela fixa paga com outro valor conta UMA parcela** (`20260925120000`, decisão do dono do
    produto): o saldo cai o valor da parcela, como o banco vê, e a diferença mora em
    `debt_interest_cents` — positiva é encargo, negativa é desconto. Limite: da metade até menos
    do dobro da parcela (R$ 0,01 não quita uma parcela; três pagas juntas não contam como uma).
    Corrigir o valor de um pagamento de parcela fixa vale em QUALQUER pagamento (o saldo não
    depende do valor); com juros, só no mais recente. No app, "Usar este valor nas próximas"
    passa o contrato ao valor novo ANTES de pagar (a parcela sai inteira nele), e editar o valor
    de um pagamento pergunta "Só este pagamento / Este e as próximas parcelas". A segunda segue a
    MESMA ordem (`20260925140000`): contrato primeiro, pagamento depois — e o trigger grava o
    pagamento MAIS RECENTE como a parcela inteira no valor novo, sem encargo. O detalhe do
    lançamento mostra "Parcela de R$ X + R$ Y de encargo" (ou "− desconto"; com juros,
    "Amortização + juros") lendo a LINHA (`detalheDoPagamento`), nunca o contrato.
  - **A ficha da dívida é uma TELA, `/finance/debts?id=<dívida>`** (25/09/2026): era uma folha,
    e abrir uma parcela fechava a ficha e voltar a reabria (*"para que fechar e não só voltar?"*).
    O mesmo `debts.tsx` desenha a lista (sem `id`) e a ficha (com `id`); a folha de pagar abre por
    cima das duas, e editar abre o formulário único (`/finance/lancar`). **Toda parcela da linha do
    tempo abre**, empilhada sobre a ficha: a paga com lançamento abre o LANÇAMENTO (editar, apagar);
    a futura, a próxima e a só contada abrem `/finance/debt-installment` (valor, vencimento,
    juros/amortização e saldo depois, da MESMA conta da ficha). "Paguei esta parcela" ali — só na
    próxima, pagar é em ordem — volta para a ficha já no pagamento (`lib/volta-da-parcela.ts`).
  - **Excluir por completo é `public.delete_debt`**: trava a dívida, apaga os pagamentos
    (`transactions.debt_id`, com um desvio local à transação no `tg_transactions_debt_payment`) e a
    dívida. Idempotente. Apagar a dívida direto FALHA quando há pagamento: a FK `set null` dispara
    o trigger, que recusa "desvincular".
- **`recurring_transactions`**: RRULE + `dtstart` (âncora) + `next_run_at` (próxima ocorrência FUTURA, é o que o app mostra) + `materialized_until` (controle do cron) + `merchant` (o estabelecimento, que cada ocorrência herda). Materializadas **um ano à frente** pelo `finance-scheduler` como `pending`, com `source='recurring'`. Idempotência pelo unique `(recurring_id, occurred_at)`.

  **A série se edita INTEIRA** (`update_recurring_series`, `20260926120000`, *"ter todos os
  campos de quando eu crio ao editar"*): valor, título, estabelecimento, tipo, categoria, conta,
  fim e o CALENDÁRIO. Calendário novo (`rrule` + `next_run_at`, sempre juntos, só o que o
  `montaRRule` do app monta) mexe nas em aberto do PERÍODO (semana, mês, ano) do próximo
  vencimento em diante: a PRIMEIRA muda de data e fica com o mesmo id (as em aberto são
  atualizadas, não recriadas — é a linha aberta na tela), as outras saem, a âncora vai para o
  próximo vencimento e `materialized_until` zera — o agendador gera o resto e pula a movida pelo
  unique. A em aberto de um mês anterior é outra conta e fica; o passado, a atrasada e a paga não
  mudam.
  - **"Futura em aberto" é pelo VENCIMENTO fora do cartão**: o Fundacred de setembro tinha data
    04/09 e vencimento 30/09; pela data ele ficaria e nasceria outro 30/09 ao lado. No cartão
    `due_at` é o vencimento da FATURA e a compra de ontem já aconteceu: lá vale a data.
  - **O que FICA segura o calendário** (paga, atrasada, compra de cartão já feita): o próximo
    vencimento vem num período depois dela, senão aquele mês ganharia uma segunda cobrança — e
    desde 27/09/2026 o banco **desliza, não recusa** (`20260927120000`): "dia 4 → dia 31" com
    setembro pago vira "próximo 31/10", no dia da regra (`day_in_month`), e a tela diz onde caiu
    ("Setembro já tinha a cobrança dela: a próxima fica em 31/10/2026", `avisoDeDeslize`; o
    agente diz o mesmo). Recusar era o erro: a pessoa queria mudar o dia da série INTEIRA. Aberta
    pela ocorrência PAGA, "Esta e as próximas" parte do próximo vencimento, não da data dela.
  - **"Todo dia 30" nunca pula fevereiro.** A RRULE ao pé da letra pula o mês sem o dia, e o
    agendador pulava; hoje ele expande `BYMONTHDAY=29|30|31` como "o último destes que existir"
    (`recurrence._dia_que_cabe`), a mesma régua do `day_in_month`. A regra gravada não muda.
    Escolhida a data no último dia de um mês curto (30/09, 28/02), o formulário PERGUNTA "Todo
    dia 30 | Último dia do mês" (`DiaOuUltimo`, também no financiamento); sem resposta vale o dia.
  - **Série nova ganha as ocorrências no minuto**, não na rodada de hora em hora: o cron de
    lembretes materializa as nunca materializadas (`materialize_horizon(so_novas=True)`). Antes a
    série criada ficava até 1 h sem nenhuma linha — "Ver ocorrências" vazio e a projeção só com o
    mês da regra (produção, 27/09/2026). "Ver ocorrências" é a série INTEIRA: "A seguir" (a
    próxima primeiro, com a atrasada em aberto no topo) e "Anteriores".
  - `next_run_at` é timestamp: a tela lê o dia LOCAL (`dataLocalDe`). O Fundacred de produção tem
    05/10 00:00 UTC — 04/10 em Brasília —, e o card dizia "próximo 05/10".
  - Até o agendador rodar (1 h em produção), a projeção lê a REGRA (`recurring_projection_for`
    sobre `private.recurring_dates_for`, `20260927212119`): mensal (com "a cada N meses" e
    "último dia"), semanal e anual — tudo que o `montaRRule` do app monta. Regra fora desse
    formato (escrita pelo WhatsApp) some da projeção até a rodada.
  - **Uma tela só na ocorrência**: o formulário do lançamento de uma série abre com "Só esta |
    Esta e as próximas" no topo. "Só esta" edita a linha, com UMA data (o vencimento, fora do
    cartão). "Esta e as próximas" desenha os MESMOS campos do corpo Recorrente do formulário único
    (`CamposDaSerie`). `mudancasDaOcorrencia` separa campos da linha e regra; a RPC
    `update_recurring_future` grava ambos atomicamente, com revisão e chave de repetição.
    Na pendente futura, o helper captura o vencimento ORIGINAL (compra no cartão) antes de
    alterar conta ou campos: a linha SELECIONADA conserva seu id ao mudar de data, pendências
    anteriores ficam e só as seguintes são regeneradas. Adiar para outro mês também encerra
    as estimativas da regra antiga a partir dessa âncora original, sem recriá-las no intervalo
    até o novo início (`20260930160000`, `20260930163000`). Pela ocorrência paga/atrasada,
    permanece o calendário das próximas em aberto; edição direta da série mantém a régua de
    período descrita acima.

  **A janela é de um ano porque uma janela curta faz a projeção MENTIR** — não "acabar". A
  parcela é linha real e continua aparecendo; a receita recorrente além da janela, não: com 90
  dias, outubro de 2027 mostrava as parcelas sem o salário, e o saldo despencava para um número
  que nunca existiu. O padrão da indústria é híbrido: a REGRA é a fonte da verdade, uma janela
  vira linha de verdade (editável, conciliável) e o resto se expande da regra — o Google Calendar
  pré-computa ~1 ano, o Asana 30 dias. Aqui são 365 dias, ~12 linhas por série.

  **Com um ano materializado, ordenar por `created_at` quebra TODA leitura de "o mais recente",
  e em silêncio.**
  O cron grava as ocorrências do ano inteiro NO MESMO INSTANTE: quem ordena por `created_at`
  passa a ver só futuro. Medido em produção em 10/09/2026, com 200 linhas futuras contra 103
  passadas:

  - `useRecentTransactions` — "Últimos lançamentos" da Hoje e do Financeiro virou doze
    "Manutenção dentista", uma por mês, até agosto de 2027.
  - `finance.reference_window` (era `resolve_transaction` e `por_transacao`, com a consulta
    duplicada) — a janela dos 40 ficou **40 de 40 no futuro**, e "apaga o último gasto"
    resolvia para *Manutenção dentista de 10/08/2027*. Caminho destrutivo; quem segurava era o
    usuário ler o `interrupt()` e dizer não.

  O corte certo é a DATA, nunca o `status`: compra no cartão fica `pending` até a fatura ser
  paga e ainda assim é lançamento que aconteceu. E a janela do agente tem duas metades — o
  passado primeiro (é o que "o último" quer dizer), depois as 10 ocorrências futuras mais
  próximas, para "a parcela de outubro" continuar alcançável.

  **Não escreva um segundo expansor em SQL** para ir além do horizonte: a aritmética de
  recorrência mora em `agent/app/jobs/scheduler.py` (`HORIZON_DAYS`) e duplicá-la é a segunda
  cópia que diverge. Além de 12 meses, o caminho é uma RPC de LEITURA que marque a linha como
  projetada. E **quem anuncia a janela ao usuário lê a constante** — a frase de `query_recurring`
  cravava "90 dias" logo abaixo de um comentário dizendo que a janela vinha de `HORIZON_DAYS`;
  `tests/test_query_reads.py` quebra se voltar a cravar.

  **A ocorrência PASSADA que já existe solta é ADOTADA, não criada de novo** (`scheduler._adotar_gemea`,
  27/09/2026): mesmo espaço, tipo, valor, conta, dia e título, sem série dona. Em produção a
  pessoa apagou o Fundacred (o setembro pago ficou, é histórico) e o recriou a partir de 04/09
  com "entra como pago": nasceu outro 04/09 pago e a conta corrente caiu R$ 1.198,85 a mais.
  A duplicata que nasceu antes disso o agendador desfaz (`scheduler.reparar_gemeas`, aprovado
  pelo dono do produto): a gerada sai e a solta de `source='recurring'` (só série apagada deixa
  uma) volta para a série — par idêntico, estado igual, a solta criada antes.

  **Apagar a série leva junto as ocorrências futuras ainda `pending`** (trigger
  `recurring_drop_future`, `20260909090000`) — a FK é `on delete set null`, e sem o trigger elas
  ficavam órfãs pesando na projeção. Histórico e ocorrência ATRASADA ficam: a primeira aconteceu,
  a segunda é conta em aberto. Foi assim que nasceu um terceiro salário de R$ 2.632,00 que nunca
  existiu, quando o salário único virou dois pagamentos.

## Categorias

- **Texto livre, minúsculo, curto** — sem FK. Fonte única da lista de sugestões:
  `src/lib/categories.ts` — que é SUGESTÃO, não a lista. O seletor do app oferece **as
  categorias que o usuário usa** (`categories_used()`, `20260909100000`), mescladas com as
  sugestões e agrupadas por forma sem acento (`src/lib/categories-merge.ts`): em produção havia 25
  categorias distintas e só 8 estavam entre as 13 sugeridas — "despesas eventuais" (14
  lançamentos), "roupa", "eletrônicos" e "impostos" não davam para escolher no app. Existe UMA
  cópia literal, porque o Python não importa de `src/`: `agent/app/domain/categories.py`.
  (Eram duas; a do Deno saiu com `supabase/functions/` em 09/09/2026.)
  `src/lib/categories.test.ts` falha se as duas divergirem — mexeu numa, mexe na outra. A
  tabela `categories` legada foi dropada na `0010_workspaces.sql`.
- **Ícone e cor da categoria moram numa tabela à parte, e o registro continua com o TEXTO**
  (`public.categories`, `20260929170000`, spec `2026-09-29-formulario-unico-e-categorias-design.md`).
  A tabela nova tem o mesmo nome da legada e outro papel: guarda só a APARÊNCIA de um nome, por
  espaço, e a categoria criada no app antes de ter uso. Sem FK — WhatsApp, agente e importação
  seguem gravando o nome. `categories_used()` devolve as em uso e as criadas, com `icon`, `color`
  e `budgets` no FIM (o APK antigo lê `category`/`uses` por nome). No app, `useAparencia`
  (`lib/categorias.ts`) responde ícone e cor: a linha da tabela, senão o ícone adivinhado
  (`categoryIcon`) e sem cor — `anti-slop.test.ts` barra `categoryIcon` direto numa tela.
- **Renomear, juntar e apagar reescrevem o texto em SETE colunas, numa transação**:
  `transactions`, `recurring_transactions`, `installment_plans`, `budgets`,
  `categorization_rules`, `debts.payment_category` e o histórico da recorrente
  (`private.recurring_history_versions`, por um definer: a tabela só tem policy de leitura).
  Renomear para um nome que já existe (sem acento e sem caixa) é JUNTAR: `rename_category` recusa
  com `CATEGORIA_EXISTE` e só junta com `p_juntar`; no mês em que as duas têm orçamento, fica o
  da que recebe. Apagar deixa os registros sem categoria e tira os orçamentos dela. Um UPDATE só
  de categoria não acorda o gatilho do pagamento de dívida (`update of` as colunas que ele confere)
  nem versiona a série (`proops.renomeando_categoria`) — `supabase/tests/categorias.sql`.

## O "hoje" do banco não é o hoje do usuário

**O Postgres do Supabase roda em UTC, e das 21h à meia-noite `current_date` já é amanhã.**
Medido em 10/09/2026 às 21h03 BRT: aparelho e Mac diziam `10/09`, o banco dizia `11/09`. Nas
três horas finais de todo dia a projeção começava amanhã (largando o que ainda vence hoje), "o
que vence" perdia o dia, e o ciclo virava cedo — com fechamento no dia 10, às 21h do dia 10 o
app já mostrava o ciclo seguinte.

**24 funções usavam `current_date`** e a correção não foi reescrever nenhuma:
`alter function ... set timezone to 'America/Sao_Paulo'` (`20260911030000`) fixa a GUC pela
DURAÇÃO da chamada. O corpo não muda, o default do banco não muda, e como a GUC vale para tudo
que a função chamar, a porta pública leva o fuso certo para a árvore inteira. Provado antes de
aplicar: `cycle_now` devolvia `diasAteOFim` 19 em UTC e 20 com o fuso.

**Não mude o fuso do BANCO.** A doc do Supabase é explícita — *"strongly recommend keeping
it [UTC]"* —, e `alter database` arrastaria junto `auth`, `storage`, `realtime` e os
checkpoints do LangGraph.

**O fuso é fixo, e é decisão.** O produto é brasileiro em todas as pontas e não existe
coluna de fuso. Quando existir, o caminho é `private.today(ws_ids)` lendo
`workspaces.timezone`, e as 24 linhas viram `reset timezone`.

**Função nova que use `current_date` precisa do `set timezone` junto** — senão ela volta a
enxergar o dia do UTC, e o sintoma aparece só depois das 21h.

**`default current_date` na ASSINATURA não é alcançado pelo `set timezone`** — default de
parâmetro é avaliado no CHAMADOR, antes de a GUC da função valer. São 7 funções assim
(`pay_invoice`, `settle_invoice`, `goal_deposit`, `pay_debt_installment`, `update_asset_value`,
`budgets_status`, `_budgets_status`) e hoje nenhuma corre risco: **todo chamador passa a data
local** (`localISODate()` no app, `local_iso_date(ctx.timezone)` / `require_date` no agente).
Conferido em produção em 11/09/2026 — nas 7 o `current_date` está SÓ na assinatura, nunca no
corpo. Chamador novo que omitir a data grava o dia do UTC, e alterar o fuso da função não
conserta: o jeito é passar a data, ou trocar o default por `null` + `coalesce` DENTRO do corpo.

## O mês financeiro fecha no dia que o usuário paga, não no dia 31

**"Do dia 1 ao 31" é uma suposição, e para quem paga tudo num dia só ela corta o ciclo ao
meio.** O caso do dono do produto (10/09/2026): salário no dia 5 e no 20, e as DUAS faturas
vencendo dia 10 — Nubank (fecha dia 3) e BB (fecha no último dia). O período que importa para
ele é **11/08 a 10/09**: recebe, gasta, e no dia 10 paga tudo. Lido de 1 a 31, o salário do dia
20 aparece num balde e a fatura que ele paga com esse salário no seguinte — e nenhum número da
tela bate com a planilha dele.

`workspaces.cycle_close_day` (`20260911020000`), **null = último dia do mês**, que é o mês
civil.

> **O dia de fechamento vai de 1 a 31** (`20260923140000`). `cycle_bounds` faz o clamp com
> `private.day_in_month` — a mesma regra do vencimento do cartão:
> 29 e 30 fecham no último dia do mês mais curto. Com o clamp, fechar no 31 É fechar no
> último dia, então **o 31 grava `null`** (o `check` vai até 30) e o `null` acende o 31 na grade.
> Um valor por significado. `supabase/tests/mes_fecha_ate_o_31.sql` prende as bordas em fevereiro
> (bissexto e não), nos meses de 30 dias e que todo dia cai em exatamente um ciclo.

**Uma função sabe a regra, e é `private.cycle_bounds(close_day, mes)`.** Dela saem
`month_lines_for`, `month_summary_for`, `monthly_lines_range` e `month_group` — os quatro
`date_trunc('month', ...)` que existiam viraram uma chamada. `private.cycle_month_of` responde
a outra metade: a que ciclo um DIA pertence.

**O rótulo é o mês em que o ciclo TERMINA.** "Setembro" com fechamento no dia 10 é
11/08–10/09, porque é assim que o usuário fala ("o que eu pago em setembro"). A consequência é
que `date_trunc('month', current_date)` deixa de servir para "mês corrente": no dia 15/09 o
ciclo corrente já se chama outubro, e ancorar no mês civil deixaria a tela um ciclo atrasada
durante 20 dias por mês.

**Isto é parâmetro de LEITURA e não encosta na regra de fatura.** Em qual fatura uma compra
cai continua sendo o `closing_day` do cartão pelo trigger `set_invoice`, e a projeção continua
tirando o dinheiro do caixa na data de VENCIMENTO. Compra no Nubank dia 04/09 cai na fatura que
vence 10/10 — antes e depois. O ciclo só move a régua que corta os gráficos.

**O app PERGUNTA o ciclo, nunca calcula** (`cycle_now`, `cycle_range`). Reescrever a
aritmética em TypeScript seria a segunda cópia da regra, e o modo de falha é mudo: o painel
pediria N dias de projeção enquanto o banco agrupa outra borda, e os dois números da tela
discordariam sem erro nenhum. Foi quase o que aconteceu — o painel já seguia o ciclo enquanto a
linha "entrou · saiu" logo abaixo dele ainda somava 01 a 31.

Padrão do nicho, não invenção: YNAB, Monarch, Mobills e Organizze todos têm dia de
início/fechamento do mês configurável.

**E a régua é ESCOLHA, não configuração de mão única** (`20260911130000`). `cycle_close_day`
sozinho fixava a leitura: quem configurava o dia 10 via 11/08–10/09 em todo lugar, e o único
caminho de volta era apagar a configuração. `workspaces.cycle_view` (`cycle` | `civil`) separa
"qual é o meu ciclo" de "como eu quero ver agora" — o Perfil mostra os dois, e trocar a régua
**não apaga o dia**.

**Ela é aplicada num ponto só: `private.cycle_close_day()` devolve `null` no modo civil.** As
cinco leituras que perguntam o dia a ela (`month_lines_for`, `month_summary_for`,
`monthly_lines_range`, `month_group`/`month_forecast_json`, `cycle_range`) caem sozinhas no
`date_trunc('month')` que já era o caminho de quem nunca configurou ciclo. Zero argumento novo,
zero segunda aritmética de "onde o mês começa".

**`budgets_status_for` era a quinta leitura e tinha ficado para trás.** Ela seguia em
`date_trunc('month')` enquanto as outras quatro migraram na `20260911021000`: na tela do
Financeiro o painel somava 11/08–10/09 e o bloco de orçamento logo abaixo somava 01–30/09, os
dois escritos "setembro". Na Hoje e no badge da dock era pior — `useBudgetsStatus()` manda HOJE,
e no dia 11/09 o ciclo corrente já se chama outubro.

**`budgets.month` é o RÓTULO; `occurred_at` é a JANELA.** Com ciclo os dois deixam de ser o
mesmo valor (rótulo `01/09`, janela `11/08`–`10/09`), e comparar `b.month` com o início da janela
faz o limite personalizado do mês sumir da tela sem erro nenhum.

**A chave `budgets-status` não se conserta sozinha na troca de régua.** As outras são chaveadas
por `from`/`to`, que mudam junto; a do orçamento é chaveada pelo rótulo, que é o mesmo `2026-09`
nas duas réguas. Ela está em `REGUA_MUDOU` (`use-finance.ts`), a lista que os DOIS setters
invalidam.

## Um resumo resume o que está LOGO ABAIXO dele

**Número de outra lente no topo de uma lista é mentira, e já foi escrito dos dois jeitos.**
O card de Lançamentos somou a lista (e virou cópia do painel da home: dois resultados idênticos
em telas vizinhas, nada dizendo que respondiam a perguntas diferentes) e depois passou a ler
`cycle_series` para bater com a home — e aí parou de bater com a lista a 200px dele. Medido no
staging em 13/09/2026, ciclo de outubro: `saiu R$ 8.326,63` em cima de uma lista de
**R$ 3.842,78**.

A régua é uma só: **o total do topo soma exatamente as linhas de baixo.** Número de outra lente
vira LINK, com a lente escrita — em Lançamentos, "por data da compra" no card e "por data do
pagamento" no rodapé que leva ao ciclo. As duas leituras estão certas; o que não pode é a de
outra lente ocupar o topo desta.

**Com filtro ativo o card SOME.** `transactions_summary` soma o período inteiro e a lista
filtrada soma menos — mantê-lo ali recria o mesmo defeito com outra cara.

**Número de outra JANELA também precisa de caminho, não só número de outra lente**
(16/09/2026). O painel da Hoje escreve "Compromissos até 10/10/2026 · R$ 8.274,68" e logo abaixo
"O que vence" lista **7 dias**. Não é erro de soma — são perguntas diferentes, e a separação está
decidida no comentário do `HeroPanel` ("aqui é quanto dá para gastar AGORA"). O defeito era a
tela **afirmar** o total, dizer *"comprometi mais do que entra"*, e não ter como ver o que é
aquilo: o menu do painel oferecia Projeção, Patrimônio e Metas.

Medido na conta do dono do produto: das seis saídas até o fim do ciclo, a maior é a fatura do
Nubank (R$ 3.751,22, **45% do total**), que vence em 24 dias — com janela de 7 e cartão fechando
no dia 3 e vencendo no 10, ela some da Hoje em ~23 dos 30 dias do mês. `upcoming_bills` **já**
traz a fatura (`kind = 'invoice'`, pelo `invoice_open_cents`, sem `paid`/`rolled` e sem duplicar
a compra que está dentro dela): o que faltava não era dado nem seção, era o link.

O conserto é o item "Ver o que fecha o ciclo" no menu do painel, apontando para `/finance/cycle`
— a lista que já existe, agrupada, com a fatura abrindo nas compras. **Alargar a janela dos 7
dias seria o conserto errado**: a Hoje viraria a tela do ciclo com outro nome.

**E o link não bastou: a COMPRA que ainda vai postar não estava em tela nenhuma.** O ramo
avulso de `upcoming_bills` exige `invoice_id is null` — correto, é o que impede contar duas vezes
o que já está somado dentro da fatura —, e o efeito colateral é que a parcela e a assinatura com
data futura somem de toda leitura de "o que vem". Medido: `DAS` (20/09) e `Carro Peças (2/3)`
(22/09) não apareciam em lugar nenhum da Hoje.

**E a FATURA não responde isso.** Mostrá-la ("Fatura Nubank · R$ 3.751,22") foi tentado e
recusado: *"eu não quero a fatura em si, quero os próximos lançamentos previstos dentro da
fatura"*. O total é um número fechado sobre o que já foi gasto; o que ajuda a decidir hoje é o
que ainda vai ENTRAR nele. `useUpcomingCardCharges` lê isso direto (fatura aberta → transações
com `occurred_at >= hoje`), **limitado** — a fatura tem dezenas de linhas e a Hoje não é o
extrato do cartão —, e fica fora do contador "Vencendo" e do badge da aba: nada ali vence, é
compra que vai postar, e badge é contagem do que dá para resolver agora.

**O link carrega `mes` e `view` do próprio `cycle_now`, nunca um default.** Com `view` fixo,
quem está na régua civil abriria um período diferente do que o rodapé acabou de nomear — a mesma
discordância entre duas leituras que esta seção inteira persegue. E o `tipo` acompanha o que o
número CONTA: `comprometido_no_ciclo` é `sum(out_cents)`, então o destino abre em "Saiu".

**E o PERCENTUAL é a mesma regra: numerador e denominador saem da MESMA coluna**
(15/09/2026). "Onde o dinheiro foi" escrevia **"0% do mês" nas seis categorias** — o divisor era
o REALIZADO (`total_cents − pending_cents`) enquanto cada linha mostrava `total_cents`. No ciclo
corrente quase nada está `cleared` (compra no cartão só é baixada quando a fatura é paga), então
o divisor era ZERO e o `> 0 ?` devolvia o mesmo 0% para todas. Não é "um pouco errado": um
percentual igual em todas as linhas apaga exatamente a comparação que o bloco existe para fazer.
O divisor é a soma das linhas mostradas.

**A lista precisa da janela JÁ RESOLVIDA, nunca de um `YYYY-MM` para ela mesma recortar.**
`useTransactions` chamava `monthBounds()` (o mês CIVIL) enquanto o resumo da mesma tela pedia a
janela a `useMonthRange`, que respeita a régua. Com fechamento no dia 10 as duas discordavam em
~20 dias: a lista de "outubro" trazia 4 lançamentos do ciclo SEGUINTE e escondia 6 do ciclo que
estava na tela, e o botão `Mês | Ciclo` ficava logo acima de uma lista que o ignorava.

Nada apontava o defeito — **o total de RECEITA batia por coincidência**, porque cada janela
continha exatamente um salário. `src/lib/anti-slop.test.ts` prende as duas leituras na mesma
variável.

## A régua do mês é de CADA TELA, e não existe régua "por fatura"

`workspaces.cycle_close_day` é global (o Perfil grava o dia). **Como cada tela está olhando é da
tela**: `MonthRuler` (`Mês | Ciclo`) é escolhido por tela e fica GRAVADO por tela (`usePreferencia`,
`regua:<tela>`, 28/09/2026: *"se eu deixei ciclo, ele tem que abrir sempre no ciclo"*), e as leituras recebem
`p_view` (`'cycle'` | `'civil'` | null) — `null` cai no `workspaces.cycle_view`, que é o que
mantém o agente e APK antigo funcionando sem tocar em nada. `20260911170000` levou o argumento a
**19 funções**.

**Não existe uma terceira opção "por fatura", e isso é resultado de pesquisa.** O artigo que
DEFENDE alinhar orçamento ao ciclo do cartão entrega a frase que mata a ideia: *"if you have
several cards with different closing dates, you cannot align to all of them, and picking one
means the others are still misaligned"*. O fechamento é interno do cartão — com três cartões há
três fechamentos e nenhum período comum. O **vencimento**, ao contrário, é evento de caixa e cai
sozinho no período que o contém: é por isso que o usuário com cartões vencendo em dias diferentes
fica certo sem escolher nada.

O que o dono do produto queria da régua "fatura" (*"ver os lançamentos por fatura dentro do
ciclo"*) veio da **fatura virar linha**, não de um período novo — o modelo do Organizze, cujo
"Saldo diário" conta o cartão como uma despesa única "Fatura Mês Ano", pelo vencimento.

Mercado, medido: Finny tem dia configurável **1 a 28**; Goodbudget e Lunch
Money também; **Monarch e Copilot só têm mês civil**; e o **YNAB recusa por decisão de desenho** —
a resposta deles para quem recebe fora do dia 1 é "orce um mês à frente", para a borda deixar de
importar.

## A fatura como linha, e a etiqueta que liga as duas réguas

`month_lines_for` devolve `invoice_id` e `invoice_due` (`20260911180000`), e disso saem duas
coisas na tela do Mês: o bloco **"Faturas do período"** (uma linha por fatura, que leva para a
tela da fatura, que já lista as compras) e a etiqueta **"cai na fatura de DD/MM"** em cada linha
de cartão.

**Nenhum número muda.** As colunas são informativas e o bloco é agrupamento no cliente, sobre
as linhas que já vieram. A tela continua em COMPETÊNCIA, porque é ela que alimenta orçamento e
categoria: mover a compra para o mês da fatura faria agosto fechar folgado e setembro estourar
por uma compra que a pessoa não lembra de ter feito ali. Tirar as compras da lista para deixar só
a fatura quebraria os subtotais por natureza, que vêm do `month_summary` e não sabem de fatura.

A etiqueta existe porque a distância entre gastar e pagar é real e era invisível: com fechamento
no dia 3 e ciclo fechando no 10, **toda compra feita entre os dias 4 e 10 é contada num ciclo e
paga no seguinte**. A pergunta do dono do produto foi exatamente essa, e a resposta certa não era
remanejar número — era dizer, na linha, para onde ela vai.

**O recorte "Para onde o dinheiro foi" abre em MEIO, não em natureza.** A lista logo acima já
está agrupada por natureza, e abrir o recorte na mesma régua dizia a mesma coisa duas vezes na
mesma tela. Por meio é o bloco "Saídas" da planilha do dono do produto.

## Ciclo FECHADO conta só o que aconteceu (`20260925130000`)

**Conta pendente num ciclo que já fechou não é saída dele.** `cash_events` contava o aluguel
que venceu em 01/09 e não foi pago como saída do ciclo 11/08–10/09 — e o ramo 4 já o trazia para
o ciclo atual como "(atrasado)". Na tela, "comecei + entrou − saiu" não chegava ao "sobrou na
conta" (R$ 2.014,30 de diferença no staging) e `linha_do_tempo.sql` falhava. Hoje, em janela com
`fim < hoje`, só entra o quitado (ramos 1 e 3) e a recorrente projetada da regra não inventa
ocorrência (ramo 6); o "faltou pagar" soma a conta pendente fora de cartão vencida até o fim do
ciclo, como já somava a fatura em aberto. Ciclo aberto e "livre" não mudam.
`supabase/tests/ciclo_fechado.sql` prende as três coisas sem depender do dado do banco.

A lista do ciclo fechado deixa de mostrar esses itens (como já não mostrava a fatura atrasada):
eles aparecem no ciclo atual como atrasados e somam no "faltou pagar".

## A fatura ATRASADA é atômica no ciclo; a do ciclo abre

**A tela do ciclo abria TODA fatura nas compras dela** (15/09/2026), e o sintoma foi imediato:
no ciclo de 11/09 a 10/10 apareciam compras de **25/08 e 31/08**. A fatura atrasada cai neste
ciclo pelo VENCIMENTO; as compras dela aconteceram no ciclo anterior, e expandi-las trazia datas
de fora para dentro de um período fechado.

A regra separa os dois casos, e a diferença é de MODELO, não de layout:

| fatura | na tela do ciclo | por quê |
|---|---|---|
| **atrasada** | um card, e nada mais | é dívida a quitar. *"A fatura é uma só, eu não escolho quais lançamentos eu fiquei de pagar da fatura"* — no caixa paga-se a fatura, nunca a compra, e abri-la sugere uma escolha que não existe |
| **do ciclo** (a vencer) | abre nas compras dela | é o que ele está acumulando agora. Traz TODAS, **inclusive as de alguns dias antes do início do ciclo**: a fatura atual não começa na borda do ciclo, começa no fechamento do cartão |

**Quem separa é a coluna `atrasada` de `cycle_lines`** (`20260915120000`), não o sufixo
"(atrasada)" do título nem o `day`. O título é frase, e ler estado de dentro de um rótulo quebra
quando alguém reescreve a frase; o `day` chega clampado em `greatest(due_date, current_date)`,
então fatura que vence HOJE e fatura vencida têm o mesmo dia.

**A consulta da expansão é condicionada ao que vai ser DESENHADO.** `useInvoice` recebe o id
só quando a linha abre — com "é fatura" como condição, uma tela de seis faturas atrasadas dispara
seis consultas cujo resultado é jogado fora.

O seletor daquela tela passou a filtrar o LADO (`Tudo | Entrou | Saiu`), que era o que os três
atalhos da home (`tipo=entra`, `tipo=sai`) já prometiam e ninguém lia — os três caíam na mesma
lista sem filtro.

## A Projeção vai até a data que o usuário escolher

Dois caminhos para a MESMA pergunta, e os dois aplicam num toque só, fechando o sheet: uma
fileira de `Chip` com os atalhos (30 dias … 10 anos) e um **calendário** para a data exata. Piso
de amanhã (hoje não é horizonte) e teto do `clamp_forecast_days` — 10 anos.

**Não existe "de quando"**: uma projeção de caixa parte do saldo que existe AGORA, e começar
em outra data exigiria o saldo daquela data — que é justamente o que ela está calculando. A tela
escreve "de hoje até <data>" em vez de oferecer um campo que só aceita um valor.

**O campo de texto mascarado saiu, e a lição não é sobre máscara** (11/09/2026). Ele foi
pedido duas vezes pelo dono do produto — *"parece que se eu clicar no campo 'projetar até' iria
abrir um calendário e nada acontece"* e depois *"se eu ainda clico em 'Outra data', eu não
consigo mudar a data, tinha que abrir um calendar pick ou algo assim"*. Um campo `dd/mm/aaaa`
pede que a pessoa SAIBA a data; quem escolhe horizonte quer VER onde ela cai. (E o campo tinha um
defeito por cima: abria preenchido com dez caracteres sob `maxLength={10}`, então a primeira
tecla era engolida.)

O calendário é `Calendar` (`src/components/finance/calendar.tsx`), escrito à mão como o
`Segmented` e o `MonthSheet`, e **inline, nunca `Modal`** — ele mora dentro de um `Sheet`, e
`Modal` dentro de `Modal` no Android é a mesma armadilha que fez o `SelectField` abrir no lugar.
A aritmética da grade é `monthGrid` em `src/lib/dates.ts`, com teste.

**Campo de data em texto continua existindo em cinco formulários, e ele precisa de MÁSCARA**
— o caminho único é `DateField` (`src/components/ui/field.tsx`), nunca `TextField` cru: o teclado
`number-pad` do iOS **não tem a tecla "/"**, então um campo que espera a barra digitada só aceita
texto colado. Em 11/09/2026 havia SEIS campos de data e só um tinha máscara — e esse um carregava
uma cópia local dela. Os outros cinco estavam indigitáveis no iPhone, em silêncio, porque o
teclado numérico do Android TEM a barra e o defeito não aparece no emulador.

## Em qual fatura cai a compra feita NO dia do fechamento

**Não há padrão, e por isso é campo do cartão** (`accounts.closing_day_inclusive`,
`20260911140000`). A `20260909050000` cravou `<` ("a compra DO dia já é da próxima") com prova
boa — duas faturas reais do Nubank, nos dois sentidos —, e o erro não foi a conclusão, foi
generalizar um emissor para o sistema inteiro. Pesquisado em 11/09/2026: o Mobills escreve "a
partir do dia de fechamento entra na seguinte", a Serasa escreve "antes ou **no dia exato** do
fechamento entram na fatura do mês atual", e acrescenta que depende do horário da compra e do
sistema da instituição.

O default é `false` = o comportamento que já valia. **Trocar a chave não reescreve o passado**: o
trigger só roda em insert/update da transação, então compra já classificada mantém o
`invoice_id`. Remanejar retroativamente mexeria em fatura paga e em mês fechado.

**A borda anda UM dia, não o ciclo.** `p_inclusive` soma 1 à data de corte em vez de trocar
`<` por `<=` — uma expressão só, em vez de dois ramos que divergem. O teste confere que os dois
modos concordam nos outros 27 dias do mês.

**O trigger se chama `public.tg_transactions_set_invoice()`; `set_invoice` é o nome do
TRIGGER.** Escrever `create or replace function private.set_invoice()` CRIA uma função órfã —
sem erro, sem aviso, com a migration aplicando limpa — e a coluna nova nasce inerte. Quem pegou
foi `supabase/tests/regua_e_dia_do_fechamento.sql`, que insere a compra e confere o vencimento da
fatura em que ela caiu: testar `invoice_window` direto passava com o defeito de pé.

**`CREATE OR REPLACE FUNCTION` preserva dono e permissões — e SÓ isso.** Toda cláusula que a
definição nova não repetir é APAGADA: foi assim que o trigger perdeu `security definer` e
`cycle_now` perdeu o `set timezone` que a `20260911030000` tinha pendurado por `alter function`
(o bug das 21h–00h voltando em silêncio). **Fuso e `security definer` vão no CABEÇALHO**, nunca
por `alter` depois — pendurados, eles morrem no próximo replace.

## "Quanto sobrou" tem UMA definição, e ela inclui o que não é transação

**Nem tudo que sai do caixa é linha em `transactions`.** A parcela de financiamento sai do
CRONOGRAMA (`private.debt_schedule_for`) e a recorrente além do horizonte materializado sai da
REGRA (`private.recurring_projection_for`). Quem ignora essas duas fontes mostra um mês melhor do
que ele é — e não dá erro nenhum, só um número otimista.

Em 10/09/2026 existiam **três** respostas para "quanto sobrou em setembro" e uma estava errada:

| RPC | tela | setembro/2026 |
|---|---|---|
| `month_summary` (sobre `month_lines_for`) | O mês inteiro | **−358,75** |
| `cash_flow_forecast` | Projeção | acumulado, −707,92 no fim do mês |
| `monthly_cashflow` | Tendência mensal | **+1.126,25** ← lia só `transactions` |

A diferença de R$ 1.485,00 era uma linha só: `Parcela Carro (8/48)`, `origin='debt_schedule'`.
O gráfico dizia "sobrou mil reais" no mês em que o dono do produto estava no vermelho, e ele
reparou antes de nós. `monthly_cashflow` passou a agregar `month_lines_for`
(`20260911010000`): **existe uma fonte de linha do mês, e é ela.**

Custo medido em produção: 146–256 ms para 6–24 meses, contra ~20 ms da soma crua. É uma
chamada por montagem de tela, cacheada pelo TanStack Query.

**A hachura "a pagar" mudou de régua junto**, de `status='pending'` para `not settled` — a
mesma coluna de "O mês inteiro". A diferença é a compra de cartão com fatura em aberto: `cleared`
na linha, mas o dinheiro ainda não saiu. Setembro: 3.433,01 → 4.961,01. Para um gráfico de FLUXO
DE CAIXA a régua nova é a certa.

**Isto não reescreveu o passado, e o motivo é frágil:** `debt_schedule_for` devolve o
cronograma a partir da PRÓXIMA parcela. Se um dia ela passar a devolver as já pagas,
`private.debt_paid_in_month` não segura — ela procura transação com `debt_id`, e as 8 parcelas
pagas do carro moram só no cadastro (`debt_installments_undocumented`). Seria história reescrita
para baixo, em silêncio. Medido antes de aplicar: abril a agosto deram delta 0,00.

## O acumulado é o produto, não um detalhe da Projeção

A pergunta que faz o usuário manter uma planilha ao lado do app não é "quanto entrou e saiu neste
mês" — é *"o que de fato restou para eu gastar esse mês contando com o que restou do mês
anterior"*. Com salário caindo num mês e fatura vencendo no começo do outro, **mês isolado dá um
número que nunca existiu na conta dele.**

A série de caixa sempre foi cumulativa; o que faltava era o ponto de partida ESCRITO. `veioDe`
(`src/lib/forecast-months.ts`) sai por subtração (`saldo − entra + sai`) em vez de vir do mês
anterior no array: no primeiro mês não existe anterior, e o valor certo lá é o saldo em conta
ANTES dos vencimentos de hoje — nem o `hoje` do payload (que já os desconta), nem zero. Como é a
identidade da série, uma quebra futura aparece como número que não fecha.

Por isso o "E se…?" saiu do ÚLTIMO lugar da home do Financeiro para logo abaixo de "O mês
inteiro": o argumento antigo ("ninguém abre o app para simular") descrevia um simulador de
compra, não a única tela que responde quanto resta.

## Agregações

- Toda leitura agregada via RPC (padrão duplo interna/wrapper de `supabase.md`): `transactions_summary`, `monthly_cashflow`, `account_balances`, `budgets_status`. Não somar transações no cliente nem no agente.
- **Previsto e realizado são colunas SEPARADAS, e o total nunca muda de significado**
  (09/09/2026). `account_balances` ganhou `cleared_cents`/`pending_in_cents`/`pending_out_cents`,
  `transactions_summary` ganhou `pending_cents`, `monthly_cashflow` ganhou
  `income_pending_cents`/`expense_pending_cents` e `month_summary` ganhou
  `income_unsettled_cents`. `balance_cents` e `total_cents` continuam sendo o total —
  três telas e o agente somam eles, e trocar o que uma coluna quer dizer é a quebra que não dá
  erro, só número errado. O realizado sai por subtração.

  **A tela é que escolhe qual coluna usar, e o cartão é o motivo.** Numa conta de dinheiro o
  saldo honesto é `cleared_cents`; num `credit_card` a parcela futura `pending` **é** dívida já
  assumida e o número certo é `balance_cents`. Filtrar `cleared` dentro do agregado forçaria um
  `case` de tipo de conta na soma — regra de produto vazando para dentro do SQL.

  **`month_summary` tem TRÊS definições que se alinham por POSIÇÃO** (`select *` em
  `public.month_summary` e `public._month_summary` sobre `private.month_summary_for`). Coluna
  nova entra nas três, no mesmo lugar, ou a tela mostra despesa no lugar de receita sem erro
  nenhum.
- **`daily_spending(p_from, p_to)` é `transactions_summary` DIA A DIA** (`20260928220000`): sem
  transferência, pela data do lançamento, com o previsto dentro, todo dia da janela (zerado
  inclusive), até 62 dias — recusa, nunca corta. É a barra de cada dia da semana da Hoje, e a de
  hoje é o "saiu hoje": uma régua própria ali seria a segunda cópia que discorda.
  `supabase/tests/gasto_por_dia.sql` prende a igualdade nos dois lados (gasto e entrada).
- `expenses_summary(from_date, to_date)` é **wrapper de back-compat** lendo `transactions where kind='expense'` — manter assinatura enquanto houver app antigo em campo.

## Cartão de crédito

- **A regra de ciclo mora no banco, em UM lugar**: o trigger `set_invoice` em `transactions` chama `private.invoice_window(closing_day, due_day, occurred_at)` e resolve a fatura. App, WhatsApp e importação não recalculam nada — nunca duplicar essa lógica em TS.
- Compra **antes** do dia de fechamento cai na fatura do próprio mês; **no** dia do fechamento e
  depois, na do mês seguinte — a janela é `[fechamento anterior, fechamento atual)`. Dia 31 em mês
  curto cai no último dia (`private.day_in_month`).
  > Esse é o PADRÃO; o cartão que inclui o dia do fechamento liga `closing_day_inclusive` (ver
  > *Em qual fatura cai a compra feita NO dia do fechamento*). Prova do padrão, mesmo cartão: a
  > fatura Nubank de 10/09 ("Período vigente: 03 AGO a 03 SET") contém as compras de 03 AGO, e o
  > OFX da de outubro (`DTSTART 20260903`) contém as de 03 SET. Migration `20260909050000`,
  > conciliação em `docs/bugs/2026-09-09-conciliacao-setembro.md`.
- **Fatura corrente (`card_summary`) = a não paga de MENOR vencimento a partir de hoje**; sem nenhuma, a mais recente. `reference_month` é o mês do FECHAMENTO e não serve para isso: no cartão que fecha no último dia e vence dia 10 do mês seguinte, a de setembro (vence 10/10) era pulada em outubro (`20261005220000`, visto em produção). Vencida e sem pagar vai para `atrasadas`.
- Cartão é conta comum em partida dobrada: a compra deixa o saldo do cartão negativo (dívida) e o **pagamento da fatura é `transfer`** da conta pagadora para o cartão (RPC `pay_invoice`). Pagamento de fatura **nunca** é despesa nova — o gasto já contou na compra.
- **Pagar e quitar são efeitos diferentes e a interface tem que distinguir os dois.** `pay_invoice`
  move dinheiro (aceita valor parcial); `settle_invoice` marca a fatura como paga SEM criar
  transferência, para o pagamento que aconteceu fora do app. No app são dois botões; no WhatsApp,
  `pay_invoice` e `mark_paid` com a fatura como alvo. Confirmar "a fatura do Nubank" não separa os
  dois — a frase do SIM diz se o caixa se move.
- **Fatura ADIADA, ou paga EM PARTE e vencida, dá baixa nas compras e parcelas dela**
  (`20260927130000`, pedido do dono do produto): `paid_at` = o vencimento. O que faltou é saldo
  adiado ou atraso da FATURA, não da compra — em produção, a fatura adiada do Nubank de setembro
  tinha as 30 compras importadas pagas e as 7 parcelas do app "em aberto". Aplica o gatilho
  `linhas_da_fatura_liquidada` (adiar, desfazer, pagar ou apagar o pagamento) e a rodada de hora
  em hora (`_liquidar_faturas_vencidas`, a parcial que vence com o dia); deixando de estar
  liquidada, volta a `pending` o que ELA baixou (`paid_at` = vencimento, fora da importação).
  Nenhum número de caixa muda: projeção e "livre" leem a fatura, não o status da linha.
- **Linha da fatura é `private.conta_na_fatura(kind)`: despesa E transferência que sai do cartão**
  (`20260928230000`). O Pix no crédito para conta própria é `transfer` cartão → conta, PAGO (o
  dinheiro chegou): a fatura o soma (total, aberto, o que vence, projeção, aviso) e o caixa o vê
  como ENTRADA na conta no dia (`cash_events`, ramo 1b); gasto, orçamento e categoria não o
  contam. Antes, 20 leituras filtravam `kind = 'expense'` e a fatura ficava R$ 340 menor em
  silêncio. **Leitura nova de fatura usa o predicado**, nunca `kind = 'expense'` à mão.
  `supabase/tests/pix_no_credito.sql` prende o "uma vez de cada lado".
- **`card_summary` tem dois números da fatura corrente, e eles não são o mesmo**
  (`20260917120000`): `invoice_total_cents` é BRUTO (a soma das compras, o número grande do
  cartão) e `invoice_open_cents` é o que FALTA (líquido do `paid_cents`). Quem subtrai a corrente
  de `unpaid_total_cents` — que é líquido — usa o segundo; com o bruto, um pagamento parcial fazia
  "outras faturas" sair menor que o real (`outrasFaturas`, `lib/card-status.ts`).
- Parcelamento tem DUAS portas, nunca inserindo N linhas no app: `create_installment_plan` para
  a compra nova, e `convert_transaction_to_installments` (`20260920120000`) para adotar um
  lançamento QUE JÁ EXISTE como parcela 1 — o `id` não muda, e chamar de novo é recusa, nunca um
  segundo plano.

  **A parcela herda o nome do ESTABELECIMENTO quando não há descrição**
  (`20260915190000`). O texto de cada linha era `coalesce(p_description, 'Compra parcelada')`,
  que força nome próprio sempre: quem preencheu só "Estabelecimento" via **"Compra parcelada
  (1/2)"** na fatura, porque quem lê a linha é `tx.description ?? tx.merchant` e o primeiro
  termo nunca era nulo. Hoje é `coalesce(p_description, p_merchant, 'Compra parcelada')`.

  **E o app não mandava `p_merchant`.** `useCreateInstallmentPlan` monta o payload da RPC
  campo a campo e o 8º parâmetro não estava lá — o formulário tem o campo, a pessoa preenche, e
  o valor morria no hook, sem erro: a RPC tem default `null`, a compra entra no valor certo e na
  fatura certa, só o nome some. Medido em produção em 15/09/2026: de 311 transações UMA tinha
  `merchant` (e veio de `import`); dos 11 planos, ZERO. A queixa foi *"cadastrei o lançamento
  nuuvem wardog e nao encontrei nada no app, mas parece que esta contando no saldo do ciclo"* —
  e era exatamente isso.

  **Os dois defeitos precisam cair juntos**: só o app faria o nome chegar numa coluna que a
  fatura não lê; só o banco não teria o que ler. E `useSaveTransaction` (o caminho à vista)
  nunca teve o problema porque ele ESPALHA o objeto — **payload montado campo a campo é payload
  que esquece campo, em silêncio**.

  **O passado não é reescrito.** Plano que nasceu sem nome continua sem nome; o caminho é
  editar a parcela com escopo "esta e as futuras", que propaga `merchant`.

  **E o PLANO tem nome próprio, que também pode morar no `merchant`.** `_rotulo_plano` lia
  só `description`, e `_FONTES["planos"]` filtrava só por ela: "apaga a nuuvem por completo"
  não achava a compra inteira, e quando ela chegava pelo agrupamento das parcelas a pergunta
  saía escrita **"Tudo (2x) — compra parcelada"**. É a mesma régua da linha (`description ??
  merchant`).

  **A busca do agente tinha que acompanhar.** `resolve.por_transacao` casava só `description`
  e `category`, enquanto a busca do app (`use-finance.ts`) sempre casou os três — com o nome
  passando a existir em `merchant`, o agente responderia "não achei nada com «nuuvem»" para uma
  compra que existe. `FinanceAction` **não** ganha campo `merchant` (o schema está no teto
  medido de 252): o modelo já põe o nome em `description`, medido em 8 redações.

### Reparcelar: editar a COMPRA, não a parcela (`20260915210000`)

**O formulário do lançamento edita uma PARCELA, e por muito tempo esse era o único caminho.**
A queixa foi literal: *"eu queria colocar o valor total de novo e parcelado em 2x mas ele veio
com o valor 52,49 preenchido e nao consigo mudar a parcela"*. Total e número de parcelas são do
CONTRATO; quem os edita é `public.update_installment_plan`, pelo sheet "Editar a compra" de
Parceladas (`/finance/installments?edit=<plano>`).

**O VALOR, desde 23/09/2026, também se edita no formulário da parcela — com a unidade DITA.**
O campo era `readOnly` numa parcela (a pessoa digitava o total num campo que era da parcela), e
a queixa foi *"eu tento clicar e o campo parece ser desabilitado… tinha que ter a opção de
colocar o valor de cada parcela"*. Hoje os três lugares que recebem o valor de uma compra
parcelada — criar/converter em N×, editar a parcela e "Editar a compra" — têm **Cada parcela |
Total da compra** (`UnidadeDoValor`, `lib/finance-form.ts`, com teste):

- **criando/convertendo** a unidade REINTERPRETA o número ("250 é cada parcela" → total 250·N);
- **numa compra que existe** ela só troca a RÉGUA do campo: o total é a verdade
  (`ValorDaCompra`), "cada parcela" vale para as EM ABERTO (`travadoCents + x·abertas`, a mesma
  conta do `_perguntar_unidade` do agente) e trocar a unidade sem digitar não move um centavo;
- editar uma parcela pergunta **Só esta parcela | A compra toda** no topo do formulário
  (`lib/compra.ts`, campos em `components/finance/compra-form.tsx` — os MESMOS de "Editar a
  compra" em Parceladas). "Só esta" muda a linha (valor pela RPC de escopo `one`, que refaz o
  total do plano); "A compra toda" vai por `update_installment_plan`.

**É o padrão do nicho, e ele vem com uma qualificação que todos repetem** (pesquisado em
15/09/2026): o Organizze recebe total + parcelas na criação (e põe o resto da divisão na
PRIMEIRA parcela, onde este repo põe na ÚLTIMA); o Mobills edita com escopo; o **OnBalance
desabilita o número de parcelas depois do primeiro pagamento**; o Oracle Financials só atualiza
parcela com saldo em aberto. Daí as três regras:

1. **Parcela travada não se move** — nem data, nem conta, nem existência. **O VALOR muda**
   (`20260928235000`, *"mesmo que tenha sido paga, ele tem que mudar e alterar todos os lugares
   que esse valor é influenciado"*): corrigir quanto uma parcela custou não a tira da fatura. Quem
   mantém a fatura honesta é o gatilho `valor_corrigido_na_fatura`, em `transactions` — fatura
   PAGA: o total anda e o pagamento fica (é o que saiu da conta, confirmado no "Paguei"); ADIADA:
   o saldo levado à seguinte anda a mesma diferença (e a cascata é a recursão do gatilho); PAGA EM
   PARTE: o que falta anda, zerado ela vira paga, negativo recusa; paga por transferência e com o
   total acima do pago, REABRE com a diferença (a marcada como paga à mão segue paga). Vale para
   o valor da parcela ("Só esta"/"Esta e as próximas"/"Todas", `update_installment_scope`), da
   ocorrência de recorrente, da compra à vista e para o agente. O `update_installment_plan` ("Editar a
   compra" sem incluir as já pagas) continua repartindo o total só entre as em aberto.
   `supabase/tests/valor_em_fatura_fechada.sql`.
2. **Com parcela paga, o NÚMERO de parcelas muda** (as pagas ficam; o que falta do total se
   reparte entre as em aberto, nunca abaixo da última paga) e **as parcelas já pagas também**
   (`p_paid_installments`, `20260926130000`: aumentar dá baixa nas primeiras e quita a fatura
   vencida que só tem parcelas pagas desta compra; diminuir reabre, e reabre junto a fatura que o
   app quitou à mão por causa delas). **Data da 1ª e conta** só mudam sem parcela numa FATURA
   paga, adiada ou paga em parte — mudar a tiraria da fatura em que foi paga. A data nova vale
   para as EM ABERTO: a paga fora do cartão fica no dia em que venceu (`20260927120000`; ela ia
   junto, e a de 04/09 virava 30/09, paga e no futuro) — a conta dela acompanha. "À vista" com
   parcela paga continua recusado.
3. **A soma das parcelas é conferida no fim.** Não fechando com `total_cents`, a função levanta e
   a transação inteira volta — o modo de falha desta classe não é erro na tela, é um total que
   deixa de ser a soma do que está embaixo dele.

**"Travada" tem TRÊS causas, e a terceira é a que não aparece em teste nenhum**
(`private.parcela_travada`, régua única): `status = 'cleared'`; fatura `paid` ou `rolled`; e
fatura com **`paid_cents > 0`** — o pagamento PARCIAL, que deixa a fatura aberta e as linhas
pendentes. Baixar o total de uma compra ali derruba `private.invoice_open_cents`
(`sum(linhas) − paid_cents`) para negativo e `pay_invoice` passa a recusar a quitação com
`aberto <= 0`: a fatura fica impossível de fechar, sem uma linha de erro em lugar nenhum.

**`travadas = 0` fala do estado de ANTES, não do destino.** Recuar a data da primeira parcela
(ou trocar o cartão) faz o `set_invoice` pendurar uma parcela `pending` numa fatura já fechada —
e ali ela SOME de toda leitura de caixa, porque todas filtram `status not in ('paid','rolled')`.
É o espelho do bug que a `20260909071000` fechou. A função reconfere a régua depois de
reescrever e recusa.

**Omitir a conta não pode ZERAR a conta.** Os parâmetros têm `default null` para o chamador
não precisar mandar categoria nem estabelecimento; a conta é outra coisa — sem ela `set_invoice`
apaga o `invoice_id` das N parcelas e a compra de cartão vira despesa solta. A função recusa
quando o plano TINHA conta e o argumento veio nulo (plano que já nasceu sem conta continua
editável).

**A categoria muda em TODAS as parcelas, inclusive as pagas, e isso é decisão declarada.**
`update_transaction_scoped` diz "o passado só muda à mão", e ali está certo porque o que propaga
é VALOR. Aqui a categoria é atributo da COMPRA: deixar 3 parcelas em "eletrônicos" e 9 em "lazer"
parte o relatório dessa compra em dois para sempre. O efeito colateral conhecido é
`budgets_status_for` remanejar o orçamento de um mês fechado — para a verdade, e sem número
materializado.

**As parcelas em aberto são ATUALIZADAS, não recriadas.** Apagar e inserir trocaria os `id`s,
e o `last_write_id` do agente, um `pending_actions` pendente e qualquer referência futura
apontariam para linha morta. Insert só quando o número CRESCE; delete só quando ele encolhe.

**O título do plano é `description || merchant`, a mesma régua da linha.** Era
`merchant || description` só em `useInstallmentPlans`, então uma compra com os dois preenchidos
aparecia com um nome em Parceladas e outro na fatura.

**`p_installments = 1` é "À vista", e DISSOLVE o plano** (`20260920120000`). A parcela 1
sobrevive com o TOTAL e o MESMO `id` (referência viva para o agente e para o HITL); as outras
somem. A ordem importa por causa do `on delete cascade` de `transactions.installment_plan_id`:
solta o sobrevivente → apaga as parcelas irmãs → apaga o plano — apagar o plano primeiro levaria
o sobrevivente junto, em silêncio. **Com qualquer parcela travada o banco recusa** (o mesmo
guarda de `parcela_travada` que já protege o número de parcelas: `1 <> N` cai nele), o que torna
converter um lançamento JÁ BAIXADO uma operação de MÃO ÚNICA — daí o aviso destrutivo na tela.

**O agente REPARCELA desde 21/09/2026** (a exclusão anterior caiu a pedido do dono do
produto: *"ele tem que mudar diretamente pelo agente mesmo, sem eu precisar abrir o app"*). N
novo sai do `installments` que o schema já tinha — sobre a compra inteira, diferente do N atual —
e a frase do SIM mostra o contrato ("de 10x para 12x de R$ 250,00"); conta e data da 1ª parcela
também, sempre pela mesma RPC e só sem parcela travada (ver `agent.md`). **Corrigir o TOTAL da
compra (mesmo N) o agente FAZ**, pela mesma `update_installment_plan`, perguntando antes se o
valor dito é o total ou por parcela (`amount_unit`). Renomear a série, apagar a compra inteira e,
desde a mesma data, **parcelar um lançamento avulso que já existe** (`convert_transaction_to_installments`,
cartão obrigatório) continuam valendo por lá. **E desde 21/09/2026 o agente DESPARCELA** — o
"À vista" desta seção, `update_installment_plan` com `p_installments = 1` (`finance._desparcelar`),
com as mesmas recusas do banco levantadas antes do SIM (ver `agent.md`).

## Projeção de fluxo de caixa

- **Horizonte da projeção: até 10 anos, e o teto num lugar só** (`20260910235500`).
  `private.clamp_forecast_days` — piso 1, teto 3650, default 90.

  **"A regra envelhece" não é motivo para baixar o teto**: PocketSmith projeta 30 anos e o
  Monarch faz multi-ano; a alavanca contra a regra velha é o "E se…?". Custo também não: 10 anos
  com duas hipóteses custa **68 ms** (`20260910234500`).

  **A leitura do app passa por `forecast_json`, não pelas RPCs `setof`.** O PostgREST corta
  a resposta em **1000 linhas** e o corte é MUDO: a série chega menor, o app soma "entra/sai" e
  tira o saldo do fim em cima do pedaço, e escreve o rótulo do horizonte pedido por cima. Medido
  em 10/09/2026 pela API autenticada: pedindo 3.650 dias vinham 1.000, último dia 05/06/2029,
  saldo **R$ 16.164,60 otimista** — e 3, 5 e 10 anos mostravam todos a MESMA data. Já valia em
  produção desde o teto de 3 anos (1.096 linhas, R$ 613,30 de erro).
  `cash_flow_forecast`/`forecast_with_drafts` continuam para o AGENTE (fala com o Postgres
  direto, sem esse teto) e para APK antigo; `src/lib/anti-slop.test.ts` quebra o build se uma
  tela voltar a chamá-las. **Qualquer leitura nova que possa passar de 1000 linhas nasce
  agregada ou em JSON** — não dá para ver esse defeito no SQL, só na tela.

  **"O mês inteiro" NÃO tem teto, e isso é desenho, não esquecimento.** Já foi levantado
  duas vezes como inconsistência ("a Projeção para em N anos e o mês navega para sempre").
  Medido em produção em 10/09/2026: `month_lines_for` em março/2035 devolve as MESMAS 6
  entradas (R$ 7.566,52) de outubro/2026, com 15 linhas marcadas `projected` — a recorrente é
  expandida da REGRA em qualquer distância, então o mês distante não some com a receita. Não
  existe ali o modo de falha que derrubava a projeção. E o `MonthSheet` recusa teto de propósito
  ("um teto criaria a única fronteira do app que o usuário descobriria batendo nela"). O teto da
  Projeção limita o TAMANHO DA SÉRIE, não a honestidade do dado — são coisas diferentes.

  **Teto de LEITURA não é janela de ESCRITA.** O materializador segue gravando UM ano
  (`HORIZON_DAYS = 365`); tudo além é calculado. Subir o teto não grava uma linha.

  **Não crie um segundo teto em código de aplicação.** Já aconteceu duas vezes. Na
  primeira, o 365 estava cravado dentro de `cash_flow_forecast` E de `_cash_flow_forecast`: a
  tela parava em "6 meses", "O mês inteiro" navegava para 2028 e mostrava tudo, e o seletor de
  mês do rascunho — que só oferece os meses DA JANELA — tornava impossível supor uma receita em
  2028 com o dado existindo. Na segunda, o agente ganhou um espelho (`FORECAST_MAX_DIAS`) que
  durou poucas horas. Quem pede demais recebe o máximo, e a frase lê a data do último dia que
  VOLTOU — não há o que espelhar.

  Efeito colateral bom da centralização: `affordability` chama com 370 dias e filtra até
  `add_months(hoje, parcelas)`; com o teto em 365, parcelamento acima de 12 meses era truncado
  em silêncio e o "pior dia" saía otimista.

- **Rascunho de cenário: um motor, duas portas** (`20260910170000`). `private.draft_effect(drafts,
  dia)` é a ÚNICA aritmética de hipótese do sistema — receita soma, gasto subtrai, parcela cai de
  mês em mês e o resto da divisão vai na última. Dela saem `forecast_with_drafts` (o Rascunho da
  Projeção) e `affordability` ("Posso comprar isso?", que virou uma casca de UMA hipótese de
  gasto). Antes, `affordability` tinha a conta dentro de si e por isso **só sabia gasto**.
  `supabase/tests/draft_scenario.sql` prova que ele devolve o mesmo de antes — trocar o motor de
  uma feature que funciona sem provar equivalência é como ela quebra em silêncio.

  **Duas formas de hipótese, e confundi-las erra por um fator de N** (`20260910200000`):
  `mode: 'total'` reparte um total em N parcelas (3.000 em 6x = 500/mês, a COMPRA);
  `mode: 'monthly'` repete o valor cheio todo mês (1.500/mês, a RECORRÊNCIA). `mode` ausente cai
  em `total` — é o que mantém `affordability` intacta. Em `monthly` a função **não precisa saber
  onde a projeção termina**: ela é avaliada por dia, e "quantas vezes já repetiu até `d`" é
  aritmética de meses; quem corta é o horizonte de quem chama.

  **O bloco chama-se "E se…?", não mais "Posso comprar isso?"** — o nome antigo contava a
  limitação (a conta vivia dentro do `affordability`, que sempre subtrai). Com `kind`, o bloco
  responde entrada E saída, e o veredito sai da própria série simulada (`primeiroNegativo` sobre
  `serie`), não de uma segunda RPC.

  **Uma hipótese só, rápida, com o que o detalhe precisa** (spec
  `2026-09-29-e-se-hipotese-unica-e-detalhe-por-conta-design.md`, pedido do dono do produto: *"por
  que não só manter um [botão]?… quando ele aplicar aparece o forms completo"*). A folha pede tipo,
  forma (uma vez | parcelado | repete | financiamento), valor, parcelas ou frequência, **conta ou
  cartão** e **dia** — a conta decide de onde a fatura e a parcela saem, e o dia em qual fatura a
  compra cai. Título, categoria e o resto vêm no formulário COMPLETO — o único, `/finance/lancar`,
  no tipo da forma —, que o "Aplicar" abre pré-preenchido (`paramsDoAplicar`); salvar lá tira a
  hipótese PELO ID, pela promessa (a lista pode ter mudado com o formulário aberto). Parcelado e
  financiamento exigem conta; "sem conta" só muda a visão geral e a linha diz isso.

  **Toda hipótese vira REGISTRO de verdade em `public.simular`** (`registroDaHipotese`, pelos
  MESMOS construtores do salvar, `src/lib/escrita.ts`): cria numa subtransação, lê e desfaz. Fatura
  (`set_invoice`), cronograma de dívida e recorrência saem das regras reais — conferido no staging
  em 29/09/2026 criando cada forma de verdade: `accounts_horizon`/`cards_horizon` deram o MESMO
  JSON que a simulação, nas seis formas. Só o adiantamento continua `Draft` de cancelamento.
  Financiamento simulado se chama "Financiamento da hipótese N": `debts` tem nome ÚNICO no espaço,
  e dois chamados "Hipótese" faziam o segundo voltar 23505. Custo medido: ~0,5 s com 10 hipóteses
  em 10 anos, com o detalhe por conta.

  **"Onde muda" e o detalhe leem UMA fonte** (`20260929140000`/`150000`): `private.caixa_das_contas`
  e `private.eventos_de_caixa` (com `account_id`) — a soma das contas É o `cash_total`, e as duas
  `cash_flow_forecast` leem os mesmos eventos (a projeção do staging deu idêntica em 3.651 dias).
  O "antes" é `accounts_horizon`/`cards_horizon`; o "depois", as leituras `contas`/`cartoes` do
  `simular` — a mesma função privada dos dois lados. A tela `/finance/hipotese?conta=&dias=` recebe
  a janela da Projeção (a hipótese pode tê-la esticado só naquela visita). **Aviso que já existia
  diz que já existia** (`fraseDoLimite`, `fraseDoNegativo`): "passa do limite em R$ 11.460" num
  cartão que já devia R$ 8.460 além dele culpava a hipótese; "fica negativa mais cedo: em 28/02/2027
  (era 22/07/2030)". Cartão sem limite nunca "passa": diz "Sem limite cadastrado" e leva ao
  cadastro. **Toda mudança do rascunho parte do GRAVADO na hora** (`usePreferencia` por função).

  **Ele mora no APARELHO, por usuário, até aplicar ou limpar** (`useRascunho`, 29/09/2026 —
  decisão do dono do produto ao pedir hipóteses com o formulário completo: *"salvar no
  aparelho"*; antes, sair da tela apagava). Nunca no banco. "Limpar" tem "Desfazer". A hipótese
  nunca começa ANTES de hoje (a projeção começa hoje, e uma
  data passada entrava no saldo sem ter dia na janela para aparecer em "entra/sai").

  **Adiantar parcelas é a terceira forma, e ela MOVE dinheiro em vez de somar**
  (`20260921120000`, spec `2026-09-21-e-se-adiantar-parcelas-design.md`). Compra parcelada,
  financiamento e recorrente de saída: uma saída no dia do pagamento + um `mode: 'cancel'` (uma
  ocorrência, valor NEGATIVO) por parcela tirada, todos com o mesmo `grupo` — a lista mostra
  uma linha e "Tirar" leva o grupo. **O dia do cancelamento vem do banco**
  (`anticipation_candidates`), pela régua de `cash_flow_forecast`: parcela de cartão sai no
  vencimento da FATURA. Cancelar no dia da parcela criaria uma saída fantasma num dia e deixaria
  a verdadeira no outro — sem erro, só saldo errado. Provado no staging: pelo valor nominal, o
  saldo final é IDÊNTICO ao real nas 7 fontes do `dev@`, e nenhum dia fica com saída negativa.
  Só entra parcela que vence DEPOIS do pagamento (antes seria adiar). O valor sugerido do
  financiamento é o valor presente pela taxa do contrato, por meses inteiros (CDC art. 52 §2º),
  e é EDITÁVEL — é estimativa.


- **Receita atrasada sai da projeção depois de 3 dias; despesa atrasada NÃO** (`20260909200000`).
  `greatest(coalesce(due_at, occurred_at), current_date)` empurra todo previsto vencido para hoje.
  Para despesa está certo: você atrasou, mas ainda deve. Para receita era o anti-padrão que a
  prática de contas a receber nomeia — *"não assuma que o atrasado será pago mais rápido do que
  historicamente foi"* —, e na versão extrema: reassumia todo dia que chega HOJE. A janela de 3
  dias é a mesma cadência do alerta `income_to_confirm`: o app cutuca duas vezes e então deixa de
  contar. **Some do número, não da tela** — continua em "O que entra" com a pílula "não caiu".
- Modelo de caixa (não contar o mesmo gasto duas vezes): saldo inicial = contas **não-cartão**, só `cleared`; saídas futuras = (a) toda fatura não paga **na data de vencimento** + (b) `pending` sem fatura em `coalesce(due_at, occurred_at)`. Compra no cartão sai do caixa quando a fatura vence, não quando foi feita.
- `cash_flow_forecast(days)`, `upcoming_bills(days)` e `affordability(amount_cents, installments)` — pares interna/wrapper. `affordability` **compõe** com a projeção (interna chama interna, wrapper chama wrapper): não duplicar a query grande.
- **`transactions.auto_confirm` decide quem vira `cleared` sozinho na data** (`20260909110000`).
  A coluna mora na LINHA, não só na série: o materializador cria ocorrência com data passada já
  `cleared` (`scheduler.materialize_horizon`) sem passar pelo promote, então uma regra que vivesse só em
  `_promote_due_transactions` não cobriria esse caminho. A ocorrência HERDA o valor da série.
  **Receita nasce `false`** — Pix de terceiro precisa de comprovação; salário é o caso em que
  ligar faz sentido, e é escolha explícita do usuário, não inferência de categoria. Parcela de
  compra parcelada continua fora (espera pagamento).
- **Receita prevista que passou da data gera alerta `income_to_confirm`** — no dia e três dias
  depois, e para. Aberto (`occurred_at <= current_date`) mandaria o mesmo aviso todo dia, e no
  WhatsApp fora da janela de 24h isso é template PAGO.

## Nada foi pago num dia que ainda não chegou (`20260928237000`)

**No que mexe no caixa** (conta, dinheiro, sem conta), `paid_at` nunca passa de HOJE (o do
Brasil): o gatilho `set_paid_at` põe hoje no lugar de uma data futura, sem erro — "paguei" um
lançamento futuro é pagar adiantado. Achado por R$ 250 de diferença entre a Projeção (que parte do
saldo, e o saldo conta todo `cleared`) e o detalhe do ciclo (que põe o realizado no dia do
pagamento): um "Fone" de dezembro marcado como pago em 01/12. **A linha de cartão fica de fora**:
ali `paid_at` é a marca de que a fatura se liquidou, e desfazer pagamento/adiamento casa por ela
(uma fatura adiada antes de vencer tem as linhas "pagas" no vencimento, no futuro).
`supabase/tests/pago_nunca_no_futuro.sql`.

## "Paguei" confirma o valor (25/09/2026)

Dar baixa abre uma folha curta (`useConfirmarBaixa`, `components/finance/confirmar-baixa.tsx`):
quanto saiu (no previsto), quando, e — numa série com valor diferente — "Usar este valor nas
próximas". Outro valor CORRIGE antes (`update_transaction_scoped`, `one` ou `future`) e só então
dá a baixa: falhando a correção, nada é marcado como pago. O mesmo valor é o resultado de antes,
com um toque a mais. Por isso o "Paguei" do arrasto não tem mais "Desfazer": ele não grava sem
confirmar.

## Editar em série — "o passado só muda à mão"

- **Editar tem ESCOPO, igual apagar já tinha**: "só esta" ou "esta e as futuras"
  (`update_transaction_scoped` e `update_recurring_series`, migration `20260909070000`). A
  pergunta é feita no SALVAR e só quando um campo propagável mudou — perguntar na abertura seria
  perguntar sem saber se há o que propagar.
- **Futuro é `status = 'pending'` E `occurred_at >= a da âncora`, as duas juntas.** Cada condição
  sozinha deixa passar um caso: só o status pega a parcela ATRASADA (passado para o usuário); só a
  data pega a parcela paga ADIANTADA (já aconteceu, e pode estar numa fatura quitada).
  `supabase/tests/scoped_transaction_edit.sql` testa as duas separadas.
- **Campos propagáveis: valor, categoria, descrição, comerciante, conta.** `occurred_at` não —
  data é de cada ocorrência e propagar empilharia tudo no mesmo dia. `status` também não: baixa
  tem caminho próprio, com efeito em fatura e projeção.
- **A âncora é sempre a primeira parcela EM ABERTO**, nunca a primeira do plano: a RPC reescreve a
  âncora inclusive no escopo "futuras", e ancorar numa parcela paga mexeria num mês fechado.
- **Editar em lote recalcula `installment_plans.total_cents`** e **atualiza a regra da
  recorrência**. Sem o primeiro, a tela mostra um total que não é a soma do que está embaixo dele;
  sem o segundo, os 90 dias materializados ficam com o valor novo e o mês seguinte volta com o
  velho (o unique `(recurring_id, occurred_at)` impede o cron de reescrever).
- **Formulário não escreve campo que ele não mostra.** Em cartão o "vou pagar depois" não
  existe, e o form derivava `status` desse campo ausente: editar o NOME de uma parcela futura dava
  baixa nela, mudando a projeção e o total da fatura sem nada na tela dizer isso. Onde o campo não
  aparece, o valor é o que já era.

## Tudo que se cria se edita — e o que se faz com a fatura se desfaz (26/09/2026)

A régua é a de `frontend.md`: o formulário de editar tem os campos da criação, e a trava que
fica tem motivo lógico escrito na frase. O que isso mudou no domínio:

- **Pagamento da fatura** (`20260926180000`): `transactions.pays_invoice_id` liga a transferência
  à fatura, e o trigger `sync_invoice_payment` (AFTER UPDATE/DELETE, nunca INSERT — `pay_invoice`
  já soma) leva a diferença a `paid_cents`: editar o valor ou a data, ou apagar o pagamento, quita,
  reabre (as linhas que a quitação baixou voltam a `pending`) ou move a data de pagamento. Fatura
  ADIADA recusa mudar o pagamento ("desfaça o adiamento antes"), exceto em cascata (apagar a conta
  ou o espaço). "Marcar como paga" se desfaz (`unsettle_invoice`); "Jogar para a próxima" também
  (`unroll_invoice`: tira o saldo, os juros e o IOF da fatura seguinte — pela data, categoria e
  nome que `roll_invoice` dá; a que a pessoa renomeou fica), recusado se a seguinte já foi paga
  ou adiada, e no cartão que adia sozinho com a fatura vencida (o cron a adiaria de novo).
- **Cartão**: mudar fechamento, vencimento ou "compra no dia do fechamento" refaz as faturas
  ABERTAS e sem pagamento (datas novas, compras de novo pelo `set_invoice`, a vazia sai;
  `20260926170000`). Fechada, paga, paga em parte ou adiada fica. O tipo troca livre entre
  contas; cartão ↔ conta só sem lançamento (as compras do cartão moram em faturas).
- **`set_invoice` não mexe na linha quando conta, data e workspace não mudaram** — o formulário
  manda a linha inteira, e renomear uma compra de uma fatura adiada a levava para a seguinte.
- **Dívida**: o modo (parcela fixa ↔ com juros) muda — `camposNoOutroModo` leva parcela, o que
  falta e as pagas para o outro modo. Pagamento de dívida se edita e se apaga, qualquer um
  (`20260926140000`): data livre; apagar um antigo devolve o principal dele e renumera os
  seguintes; corrigir o valor de um antigo com juros desce a diferença pelo saldo dos seguintes.
  Recusado com motivo: pagamento antigo sem histórico de amortização, valor que não cobre os juros
  do mês, saldo negativo.
- **Orçamento**: `edit_budget` edita AQUELE limite (categoria e alcance), em vez do upsert que
  criava outro (`20260926150000`). **Meta**: o aporte tem data e se edita
  (`edit_goal_contribution`, mesma trava de não ficar negativa; `20260926160000`) — pelo agente,
  `resource_update goals` com os campos do aporte.
- **Parcelas já pagas pelo agente**: `update_transaction` com `already_paid_count` sobre a compra,
  pelo 9º argumento de `update_installment_plan` (para mais ou para menos).

## Mudar o tipo de um registro (`converter_registro`, 29/09/2026)

No formulário único (`frontend.md` → `/finance/lancar`), editar um registro e trocar o seletor
(Uma vez | Recorrente | Financiamento) e salvar CONVERTE: `public.converter_registro(origem,
alcance, destino)` encerra a origem pelo alcance e cria o destino **numa transação só** — qualquer
recusa desfaz tudo, e a tela fica aberta com o que foi digitado. O destino é o MESMO `{tipo,
dados}` de `registroDaHipotese` e nasce por `private.criar_registro_da_hipotese`, o caminho de
criação do `simular`: não existe uma segunda cópia da regra de criar.

**As opções dependem do que foi aberto** (`opcoesDaConversao`, `lib/lancar.ts`, com teste):

| origem | pergunta |
|---|---|
| lançamento avulso | **Converter** (`converter`) · Manter e criar um novo |
| série, compra ou dívida SEM passado | [Só esta] · **Converter** (`todas`) · Manter o atual e criar um novo |
| série, compra ou dívida COM passado | [Só esta] · Desta em diante · **Todas, apagando as anteriores** (confirma antes) · Manter o atual e criar um novo |

"Só esta" aparece só quando o que se abriu é uma ocorrência de recorrente.

- **`converter` é SÓ do avulso**: a própria linha vira o destino, com o MESMO id (lançamento,
  parcelada por `convert_transaction_to_installments`, 1ª ocorrência da série no dia do `dtstart`,
  ou 1º pagamento do financiamento se já estava paga). Sem passado, "Todas" e "Desta em diante"
  dão o mesmo resultado, e a tela escreve **"Converter"** mas manda `todas` — o banco recusa
  `desta_em_diante`/`todas` num avulso e `converter` numa série.
- **Só esta**: a ocorrência sai da série (a data fica pulada por `skip_recurring_occurrence`, e o
  agendador não a recria) e é convertida no lugar.
- **Desta em diante**: o passado fica como histórico. A série termina na véspera da âncora e as em
  aberto dali em diante saem; a compra perde as parcelas não travadas (sobrando uma, ela vira
  lançamento); a dívida é arquivada com os pagamentos. **A âncora é a próxima data em aberto**:
  aberta pela série, o `next_run_at` — a ocorrência ATRASADA antes dela fica como conta em aberto;
  aberta por uma ocorrência, a data dela (o vencimento fora do cartão, a data da compra nele).
- **Todas**: a origem some INTEIRA, pago incluído (dívida por `delete_debt`) — por isso confirma.
  Linha numa fatura paga, adiada ou paga em parte recusa com a frase e o caminho.
- **Manter**: nada muda na origem; só nasce o destino.

**"Tem passado" é palpite da rota, e a dúvida vale como "tem".** `passado=0` só vem de quem SABE
(o avulso; a lista de Dívidas por `installments_paid`), e sem o parâmetro o hospedeiro assume que
tem. Na dívida o hospedeiro confere a carregada: logo depois do "Paguei" a linha em cache ainda
diz 0, e o "Converter" sem confirmação viraria `todas`, apagando os pagamentos. A conferência é
de melhor esforço: ela lê o MESMO cache `['debts']` da lista, e só ajuda depois que a consulta
refez. **O banco não segura `todas` numa dívida com pagamento** — a tela é a última defesa.

**Origem de outro espaço recusa, em todo alcance** ("manter" inclusive): o destino nasce no espaço
PADRÃO de quem chama, e converter ligaria uma linha do espaço A a uma série do B, em silêncio.
`supabase/tests/converter_registro.sql` prende os alcances e as recusas. O agente não converte
(`docs/AGENTE-PARIDADE-COM-O-APP.md`).

## Rotativo — a fatura vencida que vai para a próxima

O usuário só tinha duas saídas para uma fatura que não pagou: deixá-la atrasada para sempre ou
marcá-la como PAGA. A segunda é mentira, e mentira que contamina tudo — saldo, projeção,
patrimônio. `roll_invoice` é a terceira (`20260911040000`).

**Encargos são ESTIMATIVA, e a tela não promete exatidão.**

- **IOF segue a fórmula da lei** — 0,38% + 0,0082% ao dia, teto 3,38% (Decretos 12.466/2025 e
  12.499/2025) — e ela acerta a ordem de grandeza, **não o centavo**. Medido contra a cobrança
  real do Nubank em agosto/2026: sobre R$ 333,72 a fórmula dá R$ 2,12 e o emissor cobrou
  R$ 2,13. A diferença é contagem de dias e arredondamento do banco, que não são públicos.
- **A taxa de juros NÃO fica num campo** (`20260911060000`). O dono do produto barrou o desenho
  antes de ir para produção: *"esse valor pode mudar também à medida que o tempo passa, por isso
  não queria deixar fixo"*. E os números dele provam: a cobrança real foi **12,876%**, não os
  15,5% que eu tinha usado de exemplo — um campo fixo erraria ~20% já no primeiro mês.

  `private.rotativo_rate_for` divide os juros efetivamente cobrados pelo saldo que os gerou, na
  última vez que isso aconteceu **naquele cartão**. Se atualiza sozinha a cada fatura importada.
  `accounts.rotativo_rate_monthly` sobrou como taxa de PARTIDA, só enquanto não há o que
  observar; sem as duas, o app não estima juros e diz isso.

  **Linha `(estimado)` não alimenta a estimativa.** Sem esse filtro o palpite de um mês vira
  a "observação" do seguinte e o número nunca mais se corrige — um laço que parece aprendizado
  e é só eco.

**Regra de terceiro não vira trava de digitação.** A primeira versão recusava adiar uma
fatura que já tinha recebido um saldo adiado, citando a Resolução CMN 4.549/2017 (o rotativo
dura um ciclo). O dono do produto apontou o furo — *"o Nubank consegue, ele mescla o pendente
na fatura como se fosse um lançamento"* — e ele estava certo: **a 4.549 obriga o BANCO**. Com a
trava, uma fatura que na vida real carregou saldo dois ciclos ficaria impossível de registrar, e
a única saída seria de novo marcar como paga uma fatura não paga. Hoje `roll_invoice` devolve
`segundo_ciclo` e a tela AVISA. A única recusa que ficou é adiar a MESMA fatura duas vezes, que
é idempotência de verdade.

**Duas contagens duplas, e as duas são mudas.**
1. **Caixa**: a fatura adiada continua `status <> 'paid'`, então ela pesaria no vencimento E o
   principal pesaria de novo na fatura seguinte. São **15 ocorrências em 9 funções** — o filtro
   virou `status not in ('paid','rolled')`. `supabase/tests/roll_invoice.sql` prende o
   "exatamente uma vez".
2. **Competência**: o principal adiado NÃO é gasto novo — é a mesma compra, já contada no mês em
   que foi feita. Ele precisa existir como lançamento (o total da fatura é a soma das transações
   dela), mas `month_lines_for` e `budgets_status_for` o excluem por
   `transactions.rollover_of_invoice_id`. Sem isso a compra de agosto inflaria setembro e comeria
   o orçamento duas vezes. **Juros e IOF são gasto novo e contam em todo lugar.**

**A interface nunca escreve "rolada".** O dono do produto recusou o jargão — *"eu não saberia
o que seria rolada"*. O status no banco é `rolled`; na tela é **"Adiada"**, e a linha diz
**"Foi para a fatura de 10/11"**, que é o que aconteceu.

**Fatura ADIADA não recebe cobrança nova — `set_invoice` segue a corrente.** Achado pelo
teste de três ciclos seguidos, e é dinheiro sumindo em silêncio: a adiada sai da projeção, então
os juros e o IOF REAIS que chegam na importação do extrato, datados dentro daquele ciclo, iam
para dentro dela e desapareciam. O emissor faz o mesmo que a correção: fechada a fatura e
mandado o saldo ao rotativo, o que vem depois é cobrado na próxima.

**`to_char(d, 'TMMonth')` escreve em INGLÊS aqui.** O `TM` traduz pelo `lc_time` da sessão, e
o Postgres do Supabase roda em `C`. Saiu "Saldo em rotativo de July" no primeiro teste com dados
reais. Quem traduz mês é `private.mes_pt` — array literal, exato, sem depender de configuração
global.

**Automático é por CARTÃO e nasce desligado** (`accounts.rotativo_auto`). Ligado para todos, um
cartão pago em dia nunca mais apareceria como atrasado. O cron roda um dia DEPOIS do vencimento
(`due_date < current_date`, nunca `<=`): pagar no próprio dia é o normal.

**O agente adia e desfaz pelo cadastro do cartão**, não por `FinanceAction` (teto de 252):
`resource_roll` adia; `resource_update cards` com `fatura_paga=false` / `fatura_adiada=false`
desmarca a quitação e desfaz o adiamento (`docs/AGENTE-PARIDADE-COM-O-APP.md`).

## Patrimônio

- `assets` + `asset_valuations` (marcação com data). Valor novo entra sempre por `update_asset_value`, que grava no histórico — nunca `update` direto na coluna.
- **Histórico é SNAPSHOT** (`net_worth_snapshots`, tirado pelo `finance-scheduler`), não reconstrução: não existe histórico de valor de imóvel/investimento/dívida, e reconstruir seria inventar número. A série começa quando o usuário começa a usar.
- **Caixa inclui transação sem conta.** `private.cash_total()` é a fonte única — usada por patrimônio e pela projeção. Lançamento do WhatsApp costuma vir sem conta; ignorá-lo zerava o caixa de quem só usa o WhatsApp (bug corrigido na `0028`).

## Alertas proativos

- Quem decide o que alertar é `_alerts_to_send()`; quem entrega é `POST /cron/alerts`
  (`agent/app/jobs/alerts.py`, Cloud Scheduler diário).
- **Dedupe por dia** em `alerts_sent` (workspace, tipo, ref, `sent_on`), reservado ANTES do envio. Cron rodando duas vezes não pode virar spam — no WhatsApp spam é template pago.
- Toda mensagem termina numa ação ("quer que eu remaneje?", "me manda paguei"). Alerta que só informa é o que faz o usuário desinstalar no segundo mês.

## Planos e limites

- **Limite de plano mora em `private.plan_limits`, num lugar só.** Espalhar número de plano pelo código é como o produto acaba cobrando de um jeito e entregando de outro.
- `plan_status()` devolve plano + consumo do mês + limites numa chamada: serve a tela E o gate da
  IA em `conversation.check_limits` (`agent/app/conversation.py`). O consumo do mês é `count(*)` de `ai_events` —
  o agente que não gravar lá derruba o paywall em silêncio.
- Cancelamento é **uma chamada, sem formulário** (`cancel_subscription`). Dificultar cancelamento é a reclamação nº1 contra os concorrentes no Reclame Aqui — não repetir.
- Convite de membro é por **telefone** (o mesmo vínculo do WhatsApp), normalizado com DDI para casar com `profiles.phone`.

## Regras de negócio

- Transferência não conta como receita nem despesa em resumos (excluir `kind='transfer'` das agregações de fluxo).
- Undo via WhatsApp (`undo_last`) apaga apenas a transação mais recente do usuário e responde o que apagou.
- Conta citada por nome que não casa com nenhuma, ou casa com mais de uma, vira pergunta (`conta_citada`, `agent.md` → *Na dúvida, PERGUNTA*); sem conta citada, vale a conta padrão do workspace, ou nenhuma.

## Importação de extrato/fatura — prévia e conciliação em cascata (22/09/2026)

Plano: `docs/superpowers/plans/2026-09-22-importacao-inteligente.md`.

- **A conta do lote é obrigatória e decide o SENTIDO.** No CSV de fatura a compra vem positiva
  (medido no Nubank: 26 de 30 compras viravam receita); o OFX diz se é cartão ou conta pelo bloco
  (`CREDITCARDMSGSRSV1`), e arquivo de cartão numa conta corrente é recusado com a frase certa.
- **"Já está no app?" é conciliação em cascata e 1-para-1**, em Python puro
  (`agent/app/domain/reconcile.py`, com teste): id do banco → idêntico → parcela k/N →
  saldo adiado → transferência/pagamento de fatura → mesmo valor em 3 dias → nome parecido →
  `talvez` (empate NUNCA escolhe: pergunta). Lançamento SEM conta (WhatsApp) é candidato.
- **Nome diferente E valor diferente: a camada SEMÂNTICA** (22/09/2026). Na fatura real da
  conta `teste@` três linhas passavam como novas: "ANDREA F M SILVA ODONTOLOGIA" R$ 193,57 ×
  "Manutenção dentista" previsto R$ 177,01; "RECEITA FEDERAL" 88,68 × "DAS" 88,85; rotativo
  371,66 × 371,64. Palavra nenhuma liga razão social a apelido. O que as camadas de estrutura não
  resolveram vai ao modelo numa chamada só (`pares_para_julgar` → `judge_statement_pairs`: par a
  até 10 dias e 30% de valor), e a cascata roda de novo. Só `mesmo` casa; com valor diferente o
  item fica `uncertain` (desmarcado) e a linha oferece **"Usar no app o valor do extrato"** —
  o previsto vira o que o banco cobrou (`useApplyImportToExisting`; na conta, baixa junto).
  Modelo fora do ar = fica o resultado da estrutura. O saldo adiado casa com ≤ 1% de diferença.
- **A prévia sugere, a pessoa decide.** Novo nasce marcado; já no app, talvez e "fora do
  financeiro" (crédito na fatura, transferência entre contas, aplicação, saldo anterior) nascem
  desmarcados com o motivo. A natureza vem da IA e só mexe na pré-seleção; sem IA, uma rede
  estrutural (entrou e saiu o mesmo valor no mesmo dia; o nome do titular) e um aviso na tela.
- **"Parcela k/N" em cartão vira a compra inteira** (`private.importar_parcelado`): 1..k−1 pagas
  (histórico), k..N pendentes, parcela antiga solta no app é ADOTADA (mesmas travas da conversão).
  Fatura criada só pelo histórico e já vencida nasce quitada — sem ela, "Atrasado" fantasma.
- **`finish_import_batch` grava o marcado e descarta o resto numa transação**, com `for update`
  no lote: dois toques não gravam duas vezes. Reimportar o mesmo arquivo dá zero novos (FITID, ou
  a impressão digital da linha de CSV).

## Previstas na lista, e o toque as grava (28/09/2026)

Lançamentos mistura por data o gravado e o que só existe na regra (`ledger_expected_lines`), no
MESMO desenho de linha — o bloco à parte foi recusado pelo dono do produto. Tocar numa recorrente
prevista grava a linha que o agendador gravaria (`materialize_recurring_occurrence`: adota a gêmea
solta, recusa estimativa retroativa, idempotente); "Apagar" nela é só a marca
(`skip_recurring_occurrence`, em `recurring_moved_occurrences`, que o agendador respeita).

**A leitura mostra UMA prevista por período** (a da versão mais nova da regra, escolhida ANTES das
exclusões), fora do trecho que o agendador gerou (1ª linha até `materialized_until`) e nunca num
período que já tem a cobrança real da série. Cada regra dessas fechou um fantasma visto na tela:
a versão velha ao lado da nova, o vencimento 30 ao lado da linha de 04, a apagada voltando. E o
`status` vem do banco: "entra como pago" com data passada nasce `cleared` — nada de "atrasado".

Data de pagamento de dívida com "Este e os próximos"/"Todos" muda o dia do CONTRATO
(`update_debt_payment_due_day`) e leva os pagamentos REGISTRADOS do alcance ao dia novo, cada um no
próprio mês (`20260928210070`, *"se ele colocou todos, os pagos têm que ir para essa data"*) — a
mesma régua de "Todos" na recorrente e de "Todas" na parcelada. No dia dela, a prevista vem ANTES das
gravadas e tem a mesma chave da linha gravada: tocar não a move nem a pisca. Parcela
fora do cartão aceita "último dia de todo mês" (`*_last_day`), e a data da compra não é contrato:
muda nos três alcances a partir da parcela de referência.

## Evolução financeira — 22 pontos (outubro/2026)

Decididos em 02/10/2026 (spec `docs/superpowers/specs/2026-10-02-evolucao-financeira-22-pontos-design.md`),
aceitos no staging em 05/10/2026; **produção não foi tocada**. Cada tema abaixo é uma regra de
domínio nova; o que o agente NÃO faz de cada um está em `docs/AGENTE-PARIDADE-COM-O-APP.md`.

### Padrão das escritas compostas (vale para todos os temas abaixo)

- **Uma intenção composta é UMA transação no servidor**, com `p_request_id uuid` (a intenção, que
  sobrevive ao retry de rede) e, ao editar, `expected_revision`. Mesma chave + mesmo payload devolve
  o resultado anterior; payload diferente é recusa. **Revisão velha é `PT409`** (recusa de negócio,
  HTTP 409), nunca `40001` — o PostgREST repetiria como falha transitória. Recusa de regra é
  `P0001`/`22023` com a frase e o caminho.
- **Recibo selado**: `private.*_receipts` sem grant ao cliente guarda payload e resultado. O helper
  genérico (`private.reserve_payment_request`/`finish_payment_request`) é atualizável pelo papel
  `authenticated`, então o resultado dele NÃO prova commit. Comandos novos (reserva, plano de metas,
  subcategoria, movimento de meta, investimento, plano de orçamento, encerrar série) selam o seu.
- **Tentativa ambígua** (resposta perdida) congela payload e UUID até haver recibo válido.
  `resolve_*_attempt` devolve o recibo existente ou sela o cancelamento **terminal** (uma requisição
  atrasada recebe o cancelamento antes de qualquer efeito). SQLSTATE genérico não libera a tentativa.
- Função pública nova: wrapper `invoker` chamando comando `definer` em `private`, `set search_path = ''`,
  **`set timezone to 'America/Sao_Paulo'` no cabeçalho**, `revoke ... from public, anon`. Dinheiro de
  resposta vai como **texto decimal** e o cliente valida antes de virar `number`.
- Migration escrita em paralelo é renomeada ao integrar, para ficar DEPOIS da última já aplicada no
  staging (várias do programa nasceram com timestamp anterior ao de uma vizinha já empurrada).

### Forma de pagamento (F01) e filtro por ela (F05)

- `payment_method` nullable em `transactions`, `recurring_transactions`, `installment_plans`,
  `debts`, `debt_installment_edits` e `import_items`: `pix | credit | debit | cash | bank_transfer |
  boleto`. **null é "Não informado" e nunca vira Pix nem crédito**; método não muda `kind`, status,
  data nem saldo. Crédito exige cartão; os outros filtram as contas compatíveis
  (`paymentMethodAccounts`, `src/lib/payment-method.ts`), sem apagar a conta já escolhida.
- Gravação atômica em `save_transaction_payment` (lançamento + juros do Pix + revisão + intenção) e
  `create_recurring_payment`; o escopo da série/parcela/dívida passa pelas RPCs `update_*` existentes.
  **O juro do Pix liga ao pai por FK explícita** (`pix_fee_for_transaction_id`): o lookup por
  conta/data/título associava o juro da compra errada quando duas compras caíam no mesmo dia.
- A entrada de uma compra parcelada é movimentação independente: tem a sua conta e o seu método, não
  herda o do financiamento. Importação e agente legados gravam null e **preservam** o valor conhecido
  ao corrigir outro campo.
- Filtro (F05): `paymentMethods=pix,boleto,not_informed` (`payment-method-filters.ts`). **O filtro roda
  no servidor ANTES da paginação** (filtrar as 50 primeiras no cliente esconde o resto), a previsão
  usa a mesma seleção (`filterExpectedLines`) e o resumo global some com qualquer recorte. Valor
  desconhecido no link é recusado, nunca vira "Não informado".

### Criar a origem no fluxo, saldo e limite no seletor, prévia (F02, F03, F04)

- `create_account(p_input, p_request_id)` é a criação atômica e idempotente de conta/cartão; a tela
  Contas e o lançamento usam os MESMOS campos (`AccountFormFields`, `src/lib/account-form.ts`). Nome
  igual é erro controlado, nunca "adotar a existente". Perda de confirmação conserva UUID e payload.
- O seletor mostra **Saldo no ProOps** (confirmado, sem previsto) ou **Limite disponível**
  (`card_limit_context`, invoker sobre o cálculo canônico de `card_summary`). Saldo inicial assinado
  no cartão, débito sem fatura e estorno sem vínculo dão `needs_review` e limite null — **nunca
  somar o saldo bruto**, que duplica principal adiado. Zero, negativo, limite null e dado ausente são
  quatro estados; ausência não vira zero. Insuficiência avisa e não bloqueia registro histórico.
- Prévia "Ao salvar" = `preview_finance_write`: roda a operação REAL numa subtransação com os mesmos
  argumentos da gravação (builders compartilhados com os hooks) e desfaz tudo antes de responder. A
  função recusa rodar sem o isolamento configurado. Distingue saldo confirmado, caixa previsto e
  limite. Não existe prévia de **edição por alcance**: o alcance só é escolhido ao salvar.
- **`create or replace` apagou guardas do `set_invoice` na F04** (`20261003002625` reescreveu o
  corpo para `private.invoice_target_for` e não repetiu "nada que decide a fatura mudou" nem
  `proops.refazer_fatura`); só a suíte SQL INTEIRA achou, na F14 (`20261005110000` devolveu). Ao
  reescrever função compartilhada, copie TODAS as guardas do corpo anterior e rode a suíte toda.

### Classificação do gasto e subcategorias (F06, F09)

- Duas dimensões independentes e opcionais, só em GASTO: `expense_pattern` (`fixed|variable`) e
  `expense_necessity` (`essential|discretionary`), cada uma com `*_source` (`explicit|category_default`).
  **`explicit` com valor null é a decisão de não classificar** e impede nova sugestão; quatro nulls =
  ausência de prova. Receita, transferência, pagamento de fatura e juro do Pix não recebem.
- É **snapshot** no registro, na série, no plano e na dívida. Mudar o padrão da categoria
  (`default_expense_pattern`/`..._necessity`, `save_category_configuration`) vale para cadastros
  novos; histórico só por backfill explícito com período, que respeita `explicit` e é auditado
  (`private.category_classification_backfill_audit`). Abrir um registro antigo não preenche nada.
  Totais, saldos e orçamento não mudam: só o recorte.
- Subcategoria: `public.subcategories` (UUID estável por workspace, pai TEXTO normalizado com
  `private.fold`), `subcategory_id` opcional nos registros. **Categoria continua texto livre**, sem FK
  obrigatória; null é "Sem detalhe" e ninguém adivinha filho. Trocar o pai limpa o filho. Mover,
  juntar e apagar (`write_subcategory`, `rename_category`/`delete_category` estendidas) são atômicos,
  com recibo selado; apagar o filho só zera a referência. `category_detail_breakdown`: filhos +
  "Sem detalhe" fecham o total do pai no centavo.
- O schema `FinanceAction` do Gemini continua no teto: o agente não escolhe subcategoria nem
  classificação por frase (só regras e propagação).

### Reserva de emergência (F07)

- Configuração por workspace (`emergency_reserves`) + vínculos em `financial_allocations`
  (`purpose='reserve'|'goal'`, conta OU ativo, `liquidity_confirmed`). **Alocar não move dinheiro,
  não cria transação nem aporte, e não aumenta caixa nem patrimônio.** Leitura:
  `emergency_reserve_state`; escrita: `save_emergency_reserve` (CAS por `edit_revision`,
  recibo selado) e `resolve_emergency_reserve_attempt`.
- Lastro por fonte é proporcional: `floor(alocação × min(disponível, total alocado) / total
  alocado)`; fonte arquivada ou sem liquidez confirmada contribui zero; **falta de lastro aparece
  como déficit, o gasto real nunca é bloqueado**. Duas finalidades na mesma fonte disputam o mesmo teto.
- Base manual (centavos > 0) ou observada: três meses civis completos, cada um **revisado** pela
  pessoa com fingerprint do consumo (nova importação ou reclassificação invalida a revisão). Mês
  revisado sem gasto vale zero; mês sem revisão é insuficiência; base total zero é insuficiente,
  nunca "infinito" nem "0 meses". Cobertura em décimos por divisão inteira (conservadora). Metas
  antigas sem origem exigem confirmação do valor lido (`unassigned_goals_ack_cents`).
- A métrica antiga da saúde financeira chama-se **Caixa cobre**, não reserva.

### Metas: planejamento, prazo, alocar/transferir, marcos (F08, F10, F11, F19)

- **Plano conjunto (F08)**: `goal_plans` + `goal_plan_items` (intenções futuras por meta).
  `goal_planning_state` projeta sobre `private.cash_total`/`eventos_de_caixa` do workspace (nunca a RPC
  pública, que agrega todos os espaços). **Salvar ou simular plano não cria aporte, transação nem
  alocação.** Disponível = caixa projetado − lastro identificado nas contas − intenções acumuladas;
  o último aporte nunca passa do restante; sem renda ou sem origem é qualificação explícita, nunca
  aprovação. Fingerprint velho = `PT409`. Prazo vencido não inventa mensalidade.
- **Prazo × contribuição (F10)** (`src/lib/goal-contribution.ts`, BigInt): Por prazo (`teto(restante
  / oportunidades)`, a última parcela menor) ou Por mês (quantidade = `teto(restante / mensal)`);
  o dia da âncora é preservado (31/01 → fim de fev → 31/03, nunca +30 dias). Aporte inicial é
  intenção com data, não depósito. **"Prazo do plano" é do cenário e não edita o prazo da meta.**
  Planos F08 ficam em modo `legacy` até escolha explícita. RPCs `*_v2` (`save_goal_plan_v2`,
  `goal_planning_state_v2`) mantêm as v1 para app antigo.
- **Guardar/Retirar de verdade (F11)**: `goal_money_command` com `allocate` (separa na conta, nada
  se move), `transfer_in` (cria UMA transferência real), `link_in` (vincula transferência já lançada
  ou importada), `release`, `transfer_out` e `undo`. Estado em `goal_money_state`, candidatos em
  `goal_link_candidates`, movimentos em `goal_money_movements`. Separação por (meta, conta) mora em
  `financial_allocations` como SOMA das movimentações (zerou, a linha sai). **Separar não passa do
  caixa realizado da conta** (`SALDO_INSUFICIENTE` diz quanto há livre); vincular e desfazer a
  liberação também conferem o caixa. Uma transferência vincula a UM movimento, de meta OU de
  investimento (gatilho nas duas tabelas). Desfazer apaga só a transferência que o movimento CRIOU
  (`created_transfer`); a vinculada volta solta. `edit_goal_contribution` recusa aporte que pertence
  a uma movimentação. A primeira operação recalcula `goals.saved_cents` pela soma do ledger (a
  regra é o ledger).
- **Marcos (F19)**: `goals.icon`, `goals.color` e `goal_milestones` (valor em centavos, único por meta,
  menor que o alvo; percentual digitado vira centavos ao salvar). **A etapa é derivada** do ledger
  (`marcos ≤ saved_cents`), nunca gravada: retirar devolve o marco. Alvo baixado guarda os marcos
  acima como "Acima do alvo", sem tocar o histórico. Escrita direta com RLS (`useSaveGoal`
  sincroniza a diferença: salvar a meta e os marcos são duas escritas).

### Investimentos: aporte, resgate e resultado (F12, F13)

- **A posição é a conta `type='investment'`** — não se cria ativo ligado a ela, e os bens de classe
  investimento são posições manuais separadas (nunca o mesmo dinheiro). Aplicar/resgatar =
  UMA transferência real (`investment_command`: `contribute|redeem|link|edit|undo`, tabela
  `investment_movements`, leituras `investment_positions`, `investment_movements_page`,
  `investment_link_candidates`). Não é consumo nem renda; o patrimônio não muda sem rendimento.
- **Resgate não passa do disponível da posição na data e em toda data posterior** (resgates
  futuros já lançados contam); vale ao editar para baixo e ao desfazer um aporte que um resgate
  consumiu ("desfaça o resgate de DD/MM antes"). A transferência criada pelo movimento é protegida
  por gatilho: editar ou apagar direto em Lançamentos é recusado ("edite ou desfaça pela posição").
- **Quatro operações diferentes** (`investment_value_command`): aporte/resgate (caixa), **Atualizar
  valor** (`investment_valuations kind='valuation'`, só patrimônio), **Rendimento recebido** (receita
  real, categoria `rendimentos`, entra no caixa) e **Informar aplicado** (`kind='opening'`, só
  corrige a abertura). Os números da posição saem de UMA função
  (`private.investment_position_numbers`, lida pela tela e pelo patrimônio): valor atual = última
  atualização por `as_of` + o que entrou/saiu depois; resultado = valor − aplicado, com qualidade
  `conhecido | estimado | indisponível` — **indisponível nunca escreve R$ 0,00**, e não há
  rentabilidade anualizada. `private.net_worth_now` põe a conta de investimento em Investimentos pelo
  valor atual; `cash_total`, projeção e reserva não mudam (ganho não realizado não é caixa).
- **Empate do mesmo dia: a ordem de REGISTRO decide** (`investment_valuations.recorded_at` contra
  `created_at` do movimento, `20261004163000`). Só contar movimento com data DEPOIS da atualização
  deixava "atualizei para R$ 850 e resgatei R$ 810 no mesmo dia" em R$ 850 (+347%).
- Bens: `update_asset_value` agora grava a marcação e deixa em `current_value_cents` a de `as_of`
  mais recente (retroativa não muda o valor atual; data futura vira hoje);
  `delete_asset_valuation` recalcula e recusa apagar a única.

### Plano percentual de orçamento (F14)

- `budget_plans` (versão imutável por salvar), `budget_plan_lines`, `budget_plan_applications`;
  comandos `budget_plan_command` (`save`/`apply`), `budget_plan_preview` (puro) e `budget_plan_state`.
  Percentual em **pontos-base** (0..10000 por linha, soma ≤ 10000, renda-base > 0). Reais por
  `floor(base × bp / 10000)`; os centavos de resto vão às linhas de maior resto, um por vez — a soma
  fecha a renda quando é 100%. Categoria em uma linha só, comparada por `private.fold`.
- **Mudar a renda depois NÃO reescreve limite aplicado**; só nova aplicação muda. `apply` usa a
  régua de `save_budget` (padrão ou do mês), preserva `rollover`, o mês novo herda o `rollover` do
  padrão e **recusa categoria que não existe mais no espaço**. Em "Só o mês", o "antes" é o limite
  PADRÃO que vale (não "sem limite"). Planejado e realizado dizem o denominador. `/finance/plan` é
  a assinatura e não é o orçamento pessoal.

### Por que o gasto mudou (F15)

- `spending_change(p_cur_from, p_cur_to, p_prev_from, p_prev_to, p_dimension)` com dimensão
  `category | subcategory | payment_method | pattern | necessity`. **Uma lente só, dita na tela**:
  gasto lançado por data, previsto incluído, sem transferência, sem pagamento de fatura e **sem o
  principal adiado** (`rollover_of_invoice_id`) — por isso pode diferir da rosca em mês com
  adiamento. As janelas chegam RESOLVIDAS (régua da tela); crédito/estorno não desconta. A soma das
  contribuições, com "Sem categoria/Sem detalhe/Não informado", fecha a diferença no centavo; item
  que mudou de categoria conta pela categoria ATUAL nos dois lados. Sem IA e sem causalidade
  ("contribuiu para a diferença"). Anterior zero: percentual indisponível, nunca ∞.

### Voz no Financeiro (F16)

- `POST /internal/finance/draft` (agente, JWT do app) **só interpreta**: mesmo `finance_node` e mesmo
  `FinanceAction` (sem campo novo), devolve `{tipo, params, perguntas, entendido}` sem ferramenta,
  sem `pending_actions`, sem `executed_actions` e sem mensagem. O app abre `/finance/lancar`
  pré-preenchido; **salvar é o caminho normal**. Conta/cartão só preenche quando o nome casa com UM
  registro do espaço; ambíguo vira pergunta. **A rota passa por `conversation.check_limits` e grava
  UMA linha em `ai_events`** — sem isso a voz era um jeito de usar a IA fora da cota do plano.

### Explicações e avisos que abrem o item (F17)

- O texto de "Como é calculado" sai de `src/lib/explicacoes.ts`, uma função por indicador, a partir
  do MESMO payload que desenhou o número: período, regra e qualidade nunca são escritos à mão. Se o
  payload não traz a base, a RPC passa a devolvê-la (coluna no FIM): `financial_health()` ganhou
  `window_from`/`window_to` (drop + create, porque o tipo de retorno mudou; só o app a chama).
  Sem número, sem (i).
- Alertas ganharam os alvos `invoice` e `transaction` (`ref` uuid) nos DOIS lados do contrato
  (`agent/app/services/push.py` `TARGETS`, `src/lib/push-routes.ts` `ALLOWED`; `push-targets-contract.test.ts` prende).
  `invoice_due` abre a fatura e `bill_due` o lançamento; `ref` que não é uuid cai na lista de antes.
  **Item ausente mostra "Isto não existe mais"** com o caminho para a lista, nunca skeleton infinito.
  Canais e dedupe não mudam.

### Transferência recorrente e encerrar série (F18)

- `recurring_transactions.counterparty_account_id` (FK `set null`): série `transfer` exige as duas
  contas, diferentes, do mesmo espaço, destino nunca cartão; nos outros tipos é null. A ocorrência é
  uma `transactions kind='transfer'` normal (mexe nas duas contas uma vez, consolidado zero); projeção
  e previstas mostram as duas pontas e saldo insuficiente na origem só AVISA. Tipo de série não troca
  em silêncio (`converter_registro`).
- **Encerrar não é pausar nem apagar** (`end_recurring_series(p_recurring_id, p_last_date,
  p_request_id)` + `end_recurring_series_preview`, ambos sobre `private.series_end_scope`): tira as
  ocorrências `pending` posteriores à data (pelo vencimento fora do cartão, pela data no cartão);
  **ficam as pagas, as atrasadas e as de fatura paga, adiada ou paga em parte** (contadas na
  resposta). A série continua consultável em "Encerradas", e reabrir é editar o fim. Idempotente.
- **O piso de "Termina em" é o início ORIGINAL (`dtstart`), não o próximo vencimento** — assinatura
  cujo próximo vencimento é no mês seguinte tem que poder encerrar hoje. Armadilhas da revisão: o
  piso lia o `dtstart` que a edição de calendário reescreve; reabrir recriava como PAGAS as
  cobranças do intervalo (o próximo vencimento vai para a próxima futura); encerrar tem que travar e
  reconferir o status antes de apagar; o fim editado também passa pela regra da fatura paga em parte.

### Acumulação e renda futura (F20)

- Sem banco e **sem efeito em caixa, orçamento, projeção ou saúde**: `src/lib/accumulation.ts` calcula
  no aparelho e a tela grava só as premissas (`usePreferencia`). Taxa anual → mensal equivalente
  `(1+a)^(1/12) − 1`, nunca `a/12`; taxa zero tem fórmula própria (`P + A·n`); aporte no início ou
  no fim; inflação deflaciona por `(1+inf_m)^n`. Domínio fechado (prazo 1..1200 meses, taxa −50%..+100%
  a.a., valores até R$ 1 bilhão); fora dele o campo explica e o cálculo não roda. Capital necessário
  = 12 × renda ÷ retirada. Rodapé fixo: simulação, não recomendação nem promessa de retorno.

### Primeiro cadastro (F21)

- Sem migration: conta, cartão e primeiro lançamento reusam `AccountFormFields`, `useCreateAccount`
  e `/finance/lancar`. **O saldo de hoje vai em `initial_balance_cents`; nenhuma receita artificial
  de abertura.** O progresso (`comecar:<workspace_id>`, só ids criados) mora no aparelho e o passo
  efetivo é RECALCULADO do dado real (`passoEfetivo`, `src/lib/comecar.ts`): id apagado ou arquivado
  sai e nada é recriado na retomada; o recibo do `useCreateAccount` impede segunda conta após rede
  que caiu depois do salvar.

### Duplicar e favoritos (F22)

- Duplicar copia só dado da pessoa (`paramsDaCopia`, `src/lib/duplicar.ts`); **nunca** `id`,
  fatura, plano, série, dívida, `pays_invoice_id`, `rollover_of_invoice_id`, juro do Pix, entrada,
  `status`/`paid_at`/`auto_confirm`, `due_at`, anexo, `source` nem chave de requisição. Parcela vira
  lançamento à vista no valor dela; pagamento de fatura, de dívida e juro do Pix não têm Duplicar.
  Cada duplicação é intenção nova (data de hoje); duplo toque no Salvar é um só.
- Favoritos = `public.transaction_templates` (por workspace, RLS de membro, nome único sem caixa
  entre não arquivados, `fields jsonb` lido só por `decodeModelo` em `src/lib/favoritos.ts`: chave
  desconhecida é ignorada, valor inválido zera o campo). Apagar favorito não toca lançamento; conta
  ou categoria arquivada vem vazia com aviso.
