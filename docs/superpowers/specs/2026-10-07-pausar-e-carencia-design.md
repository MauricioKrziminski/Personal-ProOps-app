# Pausar com prazo (recorrente e lembrete) e carência no financiamento

**Data:** 07/10/2026 · **Status:** desenho aprovado em conversa, aguardando revisão do spec

## O pedido

> *"ao inves de apagar somente esta como opcao de apagar, por que nao colocar "pausar" onde ele
> define um tempo de dias e meses e quando vai começar a valer, assim ele tem mais "liberdade" e
> ele nao apagaria so essa, ele pausaria somente. Isso nao sei se faz sentido para parcelado,
> verifique se as opçoes que tem no parcelado faz sentido e se essas lógicas tambem se encaixariam
> em outros lugares."* — dono do produto, 07/10/2026

Decidido na conversa:

- **"Pausar…" é uma ação PRÓPRIA**, ao lado de Editar e Apagar. O Apagar continua com "Só esta /
  Esta e as próximas / Todas" (spec `2026-10-07-apagar-com-alcance-design.md`, que não muda): "Só
  esta" é o único jeito de tirar uma ocorrência lançada errado, e pausar não apaga nada.
- Vale para **recorrente**, **lembrete que repete** e **financiamento** (carência).
- **Parcelado no cartão não pausa**: o banco cobra a parcela na fatura de qualquer jeito. As três
  opções do Apagar fazem sentido ali como correção (só esta), compra cancelada/estornada/quitada
  antes (esta e as próximas) e apagar a compra (todas).
- **Carência depende do tipo da dívida**: parcela fixa só empurra; com juros, os juros dos meses
  parados somam ao saldo e as parcelas são recalculadas. Antes/depois na tela antes de confirmar.

## 1. Pausar recorrente e lembrete

**A ação** — "Pausar…" no menu da série (Recorrentes), no lançamento de uma ocorrência e no
lembrete que repete. Folha curta:

- **A partir de**: padrão = próxima ocorrência em aberto; aberta por uma ocorrência, a data dela.
- **Por quanto tempo**: N dias · N meses (`QuantityField`, campo aberto) · até uma data
  (`Calendar`) · **sem prazo**.
- Antes de confirmar, a frase do efeito, calculada no banco: *"Sai da projeção: Academia em 05/11 e
  05/12 (R$ 240,00). Volta em 05/01/2027."*

**Modelo** — a pausa é um PERÍODO na série, nunca ocorrência gravada/apagada uma a uma:

- `recurring_transactions.paused_from date`, `paused_until date` (null em ambos = sem pausa com
  prazo); idem em `reminders`. Check: `paused_until > paused_from`.
- **"Sem prazo" continua sendo `active = false`** — não nasce um segundo jeito de pausar
  indefinidamente.
- A projeção da regra (`private.recurring_dates_for` / `recurring_projection_for`) e o agendador
  (`agent/app/jobs/scheduler.py`) pulam datas em `[paused_from, paused_until)`. A regra de "pular
  datas" mora num lugar só de cada lado (helper SQL e helper Python), com teste dos dois.
- Pausar apaga as ocorrências **em aberto** (`pending`, fora de fatura paga/adiada/paga em parte,
  pela régua de `private.parcela_travada`) já gravadas dentro do período, sem marcá-las como
  "apagada não volta". Paga e atrasada não mudam.
- Retomar antes do fim ou encurtar a pausa zera `materialized_until` (como a série nova): o
  agendador regrava o que voltou no minuto seguinte (`materialize_horizon(so_novas=True)`).
- Lembrete: o cron de lembretes pula `next_run_at` dentro do período (avança pela RRULE até sair
  dele); no fim do período ele volta sozinho.
- O lembrete de conta (`bill_reminders`) segue sem mudança: ocorrência que não existe não vence.

**Escrita** — RPC atômica `public.pause_series(p_tipo text /* recurring | reminder */, p_id uuid,
p_from date, p_until date /* null = sem prazo */, p_request_id uuid)` + `pause_series_preview(...)`
(mesma função que decide o que sai, para a frase). Retomar = `resume_series(p_tipo, p_id,
p_request_id)`. Padrão das escritas compostas (`finance.md`): wrapper `invoker` + comando
`definer` em `private`, `search_path = ''`, `set timezone to 'America/Sao_Paulo'` no cabeçalho,
`revoke ... from public, anon`, recibo selado, `PT409` para revisão velha.

**Tela** — série mostra *"Pausada até 04/01/2027"* e entra no grupo "Pausadas" até a data;
"Retomar agora" desfaz. Lembrete idem em Lembretes ("Pausados").

## 2. Carência no financiamento

**A ação** — "Pausar pagamentos…" na ficha da dívida (menu "…"). Folha: **a partir de qual
parcela** (padrão: a próxima em aberto) e **quantos meses** (`QuantityField`).

**A conta**:

- **Parcela fixa** (sem `interest_rate_monthly`): o cronograma anda N meses — a parcela de 23/11
  vai para 23/02 e todas as seguintes andam junto; valor e quantidade iguais.
- **Com juros**: saldo novo = saldo × (1 + taxa)ᴺ (composto mês a mês, em centavos inteiros,
  arredondamento como `debt_schedule_for`); as parcelas restantes são recalculadas pela Price
  (`private.price_installment`) com o mesmo número de parcelas restantes.
- Antes de confirmar: *"Próxima parcela: 23/11 → 23/02/2027 · Parcela: R$ 1.485,00 → R$ 1.562,40 ·
  Saldo: R$ 38.500 → R$ 40.130 · Termina em 09/2029 → 12/2029"*, de uma prévia no banco.

**Modelo** — tabela `debt_pauses (id, workspace_id, debt_id, from_installment_no, months,
balance_before_cents, created_at)`, RLS de membro. `private.debt_schedule_for` lê as carências e
desloca as datas (e, com juros, parte do saldo capitalizado). Nenhuma segunda cópia do
cronograma: projeção, "O que vence" e lembrete de conta já leem `debt_schedule_for`.

- **Desfazer** enquanto nenhum pagamento foi registrado depois da carência: volta saldo e
  cronograma.
- **Recusas com frase**: carência que começa numa parcela já paga; carência sobreposta a outra
  ativa; dívida quitada/arquivada.
- RPC atômica `public.debt_pause(p_debt_id, p_from_installment_no, p_months, p_request_id)` +
  `debt_pause_preview(...)` + `undo_debt_pause(p_pause_id, p_request_id)`, no padrão das escritas
  compostas.
- **Cuidado**: `debt_schedule_for` é compartilhada (projeção, ciclo, upcoming, lembrete de conta);
  `create or replace` copia o corpo VIGENTE inteiro e a suíte SQL inteira roda depois.

## 3. Fora do escopo

- Agente pausando com prazo ou dando carência → linha em `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- Pausar compra parcelada (não existe na vida real).
- Pausar meta/plano de aportes.

## 4. Testes e verificação

- **SQL**: recorrente — datas do período somem da projeção e do agendador, retomar/encurtar traz
  de volta, paga/atrasada ficam, fatura paga trava; lembrete pula o período; carência fixa anda N
  meses com total igual; com juros, saldo e parcela batem com a conta à mão; desfazer restaura
  exatamente; recusas com a frase; prévia = efeito; outro espaço não pausa; fuso das funções novas;
  `anon_sem_execute.sql`. **Suíte SQL inteira.**
- **Agente**: pytest do agendador e do cron de lembretes pulando o período (helper de datas com
  teste).
- **App**: telas das três folhas em `simple-finance-ui.test.ts` (efeito antes de salvar, sem prazo
  = pausa de hoje, recusa com frase); `tsc`, lint, `npm test`.
- **Tela**: simulador com `dev@` no staging; limpar pelos IDs anotados.
- **Produção** só com pedido: migrations → agente → app.
