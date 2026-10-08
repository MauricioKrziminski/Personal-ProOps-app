# Lembrete de conta: avisar o vencimento de um registro específico

**Data:** 07/10/2026 · **Status:** desenho aprovado em conversa, aguardando revisão do spec

## O pedido

> *"Poder adicionar um lembrete em um lançamento específico, financiamento ou qualquer coisa que
> fizer sentido, para que quando chegar no dia do vencimento da parcela ou no dia de pagamento de
> algo, ele lembrar pelo celular ou pelo whatsapp, como tiver configurado... Isso para qualquer
> tipo de conta que tiver mostrando ali."* — dono do produto, 07/10/2026

Decidido na conversa:

- **O aviso automático continua, e o lembrete de conta soma a ele.** O automático (`bill_due`,
  `invoice_due` em `_alerts_to_send`) é global, desligado por padrão, às 9h, só hoje/amanhã (fatura:
  3 dias antes) e não cobre a parcela de financiamento. O lembrete de conta é por registro, com dias
  antes e hora escolhidos.
- **Num item de série, pergunta "Só esta | Todas as próximas"** ao criar.
- **Vários avisos por registro** (ex.: 3 dias antes às 8h E no dia às 9h).
- **O lembrete próprio SUBSTITUI o automático** para aquele registro: sem mensagem dobrada (e sem
  template pago dobrado no WhatsApp).
- **Abordagem: guardar a intenção, derivar o disparo** (abordagem A). Nada de `next_run_at`
  gravado: o vencimento muda por ~10 caminhos (`update_recurring_series`,
  `update_installment_plan`, `update_debt_payment_due_day`, `converter_registro`, `roll_invoice`,
  `set_invoice`, edição por escopo, pagar, apagar…) e uma data gravada seria a segunda cópia que
  diverge.

## Critério de sucesso

1. Um lembrete "1 dia antes às 9h" numa conta pendente avisa por push (e/ou WhatsApp) às 9h da
   véspera, uma vez, e o toque abre o registro.
2. Pagar a conta antes do aviso faz ele não tocar. Mudar o vencimento faz ele seguir a data nova.
3. "Todas as próximas" num financiamento avisa cada parcela do cronograma, inclusive as que ainda
   não são linha em `transactions`.
4. Parcela ou assinatura no cartão avisa pelo vencimento da FATURA, uma vez por fatura.
5. Com lembrete próprio ativo, o aviso automático não manda aquele registro; os outros seguem.

## 1. Modelo

Tabela nova **`public.bill_reminders`**, uma linha por AVISO:

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid not null | default `my_default_workspace()`, RLS de membro (cópia de `transactions`) |
| `user_id` | uuid not null | default `auth.uid()`; é quem RECEBE |
| `transaction_id` | uuid null | FK `on delete cascade` |
| `recurring_id` | uuid null | FK `recurring_transactions`, cascade |
| `installment_plan_id` | uuid null | FK, cascade |
| `debt_id` | uuid null | FK, cascade |
| `debt_installment_no` | int null | só com `debt_id`; null = todas as parcelas |
| `invoice_id` | uuid null | FK `card_invoices`, cascade |
| `days_before` | int not null | `check between 0 and 30` |
| `at_time` | time not null | hora local (America/Sao_Paulo) |
| `channel` | text not null | `push \| whatsapp \| both`, como `reminders.channel` |
| `created_at` | timestamptz | |

- **Exatamente um alvo**: `check (num_nonnulls(transaction_id, recurring_id, installment_plan_id,
  debt_id, invoice_id) = 1)`; `debt_installment_no` exige `debt_id`.
- **Apagar o registro apaga o lembrete** (`cascade`, não `set null` como `note_id`: sem registro,
  não há o que lembrar).
- **Mapa "o que abri → alvo"**:

  | aberto | "Só esta" | "Todas as próximas" |
  |---|---|---|
  | lançamento avulso | `transaction_id` | — (não pergunta) |
  | ocorrência de recorrente | `transaction_id` | `recurring_id` |
  | parcela de compra | `transaction_id` | `installment_plan_id` |
  | financiamento | `debt_id` + `debt_installment_no` | `debt_id` |
  | fatura | `invoice_id` | — |
  | compra à vista no cartão | `invoice_id` da compra ("Lembrar da fatura") | — |

  Ocorrência PREVISTA (só na regra) é materializada pelo toque, como já é hoje
  (`materialize_recurring_occurrence`), e vira `transaction_id`.
- Tabela em `supabase_realtime` (o app mostra a linha "🔔" no registro).
- **Escrita por RPC** `public.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)`:
  substitui ATOMICAMENTE o conjunto de avisos daquele alvo (apaga os do alvo + insere os novos);
  `p_avisos` vazio = remover. Confere que o alvo é do espaço de quem chama. Idempotente por
  natureza (substitui o conjunto). Wrapper `invoker` + comando `definer` em `private`,
  `search_path = ''`, `set timezone to 'America/Sao_Paulo'` no cabeçalho, `revoke ... from public,
  anon`.

## 2. Qual é o vencimento

**Uma fonte: a mesma de "O que vence"** (`_upcoming_bills`), sem segundo expansor:

- lançamento pendente fora do cartão → `coalesce(due_at, occurred_at)`;
- lançamento com `invoice_id` (parcela ou assinatura no cartão) → `card_invoices.due_date` da
  fatura, enquanto ela não estiver `paid`/`rolled`;
- financiamento → `private.debt_schedule_for(debt_id)` (data do CONTRATO, `installment_no`).

Para os alvos de série, a função expande: `recurring_id`/`installment_plan_id` → as `transactions`
pendentes da série/plano (o agendador materializa um ano à frente); `debt_id` → as linhas de
`debt_schedule_for` (filtradas por `debt_installment_no` quando houver). Várias ocorrências na MESMA
fatura dão UM vencimento (a fatura).

Se a leitura precisar de colunas que `_upcoming_bills` não devolve (`installment_no`, `recurring_id`,
`installment_plan_id`), a função compõe as MESMAS fontes privadas
(`debt_schedule_for`, `transactions`, `card_invoices`, `invoice_open_cents`, `conta_na_fatura`) —
nunca uma régua nova de "pendente".

## 3. Regra do disparo

`private.bill_reminders_due()` (definer, `set timezone to 'America/Sao_Paulo'`) devolve as linhas
`(bill_reminder_id, user_id, workspace_id, due_date, title, amount_cents, target, ref, channel)`
onde:

- a conta está em aberto (pendente / fatura não paga nem adiada / parcela do cronograma);
- `current_date = due_date − days_before`;
- `localtime >= at_time`;
- não existe envio reservado para `(bill_reminder_id, due_date)`.

Consequências declaradas:

- **Conta paga não toca.** Vencimento que mudou: o próximo minuto já enxerga a data nova.
- **Cron fora do ar**: o aviso sai atrasado no MESMO dia, nunca no dia seguinte.
- **Atrasada não insiste**: cada aviso toca uma vez por vencimento (o `invoice_due` automático já
  insiste na fatura).

**Dedupe**: tabela `private.bill_reminder_sends (bill_reminder_id, due_date, sent_at, attempts,
last_error)` com unique `(bill_reminder_id, due_date)`, **reservada ANTES do envio** (WhatsApp é
template pago). Vencimento que muda gera chave nova, e o aviso volta a valer para a data nova.
Sem grant ao cliente.

## 4. Entrega

- **O cron que já existe**: `/cron/reminders` (1 min) ganha um passo que chama
  `bill_reminders_due()` e entrega. Sem cron nem rota nova.
- **Texto** (push e WhatsApp), com o valor do momento do envio (fatura: o que falta,
  `invoice_open_cents`):
  - no dia: *"Fatura Nubank vence hoje · R$ 3.751,22"*
  - 1 dia: *"Aluguel vence amanhã · R$ 1.500,00"*
  - N dias: *"Parcela Carro (9/48) vence em 3 dias, 23/10 · R$ 1.485,00"*

  Título do push: "⏰ Lembrete". Dinheiro por `cents_to_brl`.
- **Canais: as regras do lembrete comum** (`reminders._entregar`): WhatsApp pelo
  `WA_REMINDER_TEMPLATE` existente (o texto inteiro é o parâmetro; sem template novo na Meta), só
  com `profiles.alerts_whatsapp_enabled`; push pedido e não entregue (sem token) cai para o
  WhatsApp. Falha: até 5 tentativas (`MAX_SEND_ATTEMPTS`), depois desiste e grava `last_error`.
- **O toque abre o registro**: alvo `transaction` (lançamento/parcela/ocorrência), `invoice`
  (fatura) e **`debt` (novo)** → `/finance/debts?id=`. O alvo novo entra nos DOIS lados
  (`agent/app/services/push.py` `TARGETS`, `src/lib/push-routes.ts` `ALLOWED`;
  `push-targets-contract.test.ts` prende). APK antigo que não conhece `debt` cai na tela inicial
  (comportamento atual para alvo desconhecido).

## 5. O próprio substitui o automático

`_alerts_to_send` deixa de emitir `bill_due` e `invoice_due` para um registro coberto por lembrete
de conta (direto, ou pela série/plano/dívida a que a ocorrência pertence; fatura coberta direto ou
por ocorrência dentro dela). Os outros tipos (`budget_*`, `negative_forecast`, `income_to_confirm`,
`cycle_closed`, `trial_ending`) não mudam.

**Cuidado**: `_alerts_to_send` é grande e `create or replace` já apagou guardas antes neste repo.
A reescrita copia o corpo VIGENTE inteiro (conferido no staging com `pg_get_functiondef`, não só
pela última migration) e acrescenta só o `not exists`. Suíte SQL inteira depois.

## 6. Telas

- **Onde aparece "Lembrar"** (vira "Editar lembrete" quando já existe):
  - menu do lançamento (`/finance/[txId].tsx`, `HeaderActions`) — avulso, parcela, ocorrência;
    compra no cartão mostra **"Lembrar da fatura"**;
  - ficha do financiamento (`debts.tsx?id=`, cabeçalho ao lado de "Editar", e `listaDaDivida`);
  - fatura (`/finance/invoice/[id].tsx`, menu);
  - Recorrentes (`acoesDaSerie`, cria direto em "Todas as próximas");
  - "Editar a compra" em Parceladas (menu).
- **Formulário**: o MESMO `reminder-form`, modo conta (`reminder-form?conta=<tipo>:<id>`, mais o
  contexto de série quando houver), não um quarto formulário:
  - topo: nome do registro, só leitura;
  - "Só esta | Todas as próximas" quando o aberto é ocorrência de série;
  - **"Avisar"**: lista de avisos, cada um com **"Dias antes"** (`QuantityField`, 0..30, 0 =
    "No dia") e **"Hora"**; "Adicionar aviso" e ✕; o primeiro vem *no dia, às 9h*;
  - **"Onde avisar"**: Push | WhatsApp | Os dois (os `CHANNELS` de hoje). WhatsApp desligado no
    Perfil → uma linha que diz isso e leva ao Perfil;
  - sem "Repetir" e sem data;
  - salvar → `save_bill_reminder`; **"Remover lembrete"** apaga os avisos daquele alvo; nenhum
    aviso na lista não salva (o botão explica).
- **Onde se vê**:
  - no registro: linha *"🔔 1 dia antes às 9h · no dia às 8h"* (tocar edita);
  - em Lembretes (`reminders.tsx`): seção **"Contas"**, cada conta lembrada com o próximo aviso;
    sem próximo vencimento (paga, série encerrada, quitada) mostra *"sem próximo vencimento"*.
    Tocar edita.

## 7. Fora do escopo

- **Agente não cria lembrete de conta** nesta fase → linha em `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- Ações na mensagem ("Paguei" no WhatsApp/push).
- Receita (lembrar de cobrar alguém) — `income_to_confirm` cobre parte; adicionar só se pedido.
- Fuso por usuário (o produto é fixo em America/Sao_Paulo).

## 8. Testes e verificação

- **SQL** `supabase/tests/lembrete_de_conta.sql`, sem depender do dado do banco: toca no dia
  `vencimento − N` só depois da hora; não antes, não no dia seguinte, não pago; fatura com várias
  parcelas avisa uma vez; vencimento editado (série e dia do financiamento) segue a data nova; "Só
  esta" não toca nas irmãs; "Todas" toca uma vez cada; reserva dupla = um envio; 21h30 de Brasília
  (já amanhã em UTC) não antecipa; `_alerts_to_send` exclui o coberto e mantém o resto; outro
  espaço não lê nem grava; `anon_sem_execute.sql` cobre as funções novas. **Suíte SQL inteira.**
- **Agente**: pytest do passo novo do cron (texto, canal, fallback, tentativas, alvo/ref do push),
  com dublês; `ruff check app --select F,E9`.
- **App**: unidade do mapa "aberto → alvo" e do texto "🔔"; contrato de alvos com `debt`;
  `simple-finance-ui.test.ts` do formulário em modo conta (salva os avisos; pergunta de série só em
  série; sem aviso não grava); `tsc`, lint, `npm test`.
- **Ponta a ponta no staging**: migration no staging; agente local com
  `docker-compose.sem-envio.yml`; pelo app no emulador (`dev@`), lembrete numa conta de teste para
  daqui a 2 min → push chega e abre o registro; repetir com financiamento; log confirma que o
  automático não mandou aquele registro; limpar pelos IDs anotados.
- **Produção** só com pedido: migrations → agente → app.

## Adendo 09/10/2026 — precedência e parcela da dívida (`20261009130000`)

- **O mais específico substitui o mais geral NAQUELE vencimento**, por espaço: fatura direta >
  uma ocorrência / uma parcela da dívida > série, compra, dívida inteira. No cartão, um "Só esta"
  numa compra (ou o lembrete da própria fatura) cala o da série/compra para aquela fatura. Não é
  silenciar: apagar o "Só esta" devolve o da série.
- **Um aviso por coisa a pagar**: lembretes que chegam ao mesmo vencimento, para a mesma pessoa,
  no mesmo dia e hora saem uma vez, com os canais somados; "já enviado" vale para todo lembrete
  que cobria aquele vencimento naquela hora (criar o "Só esta" depois do envio não reenvia).
- **A parcela da dívida tem "Lembrar"** na tela dela (`/finance/debt-installment`), com
  "Só esta / Todas as próximas"; só na próxima e nas futuras.
- **O salvar recusa o que nunca toca**: receita/transferência/pagamento de dívida ou de fatura,
  ocorrência já paga, parcela fora do contrato ou já paga. Remover sempre passa.
