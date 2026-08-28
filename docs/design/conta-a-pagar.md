# Conta a pagar — modo do form, `src/app/finance/transaction-form.tsx`

**Fluxo novo, tela nenhuma.** Hoje o app sabe **dar baixa** numa conta prevista (`useMarkPaid`,
`use-finance.ts:460-473`) mas não sabe **criar** uma: todo `status='pending'` que existe no banco
nasceu do `finance-scheduler` (recorrentes materializadas 90 dias à frente), do
`create_installment_plan` (parcelas futuras, `0013:271-280`) ou do WhatsApp. Se o Jorge quer anotar
"boleto do IPTU, R$ 340, vence dia 10", não há caminho no app — e sem esse lançamento a projeção de
fluxo de caixa e o bloco "Vence hoje" da aba Hoje ficam otimistas por omissão.

## A decisão: modo do form, não tela própria

Uma conta a pagar **é** uma `transactions` com `status='pending'` e `due_at` preenchido
(`0013:139-140`) — mesma tabela, mesmas colunas, mesmo insert. Uma tela separada custaria um segundo
formulário com valor, categoria, conta e data (os mesmos quatro campos), um segundo schema zod, e a
pergunta "mas e se eu quiser marcar uma conta que eu já paguei?" viraria um terceiro caminho.

Concretamente:

- **`transaction-form.tsx` já é o único lugar do app com `react-hook-form` + `zod`** (linha 106). Um
  form novo duplicaria o padrão em vez de reusá-lo.
- **A extensão do `TransactionInput` já é obrigatória** por outro motivo (ver `transacao-form.md`):
  `status`, `due_at` e `merchant` precisam entrar de qualquer jeito. A conta a pagar pega carona.
- **As superfícies de leitura já existem**: o chip "Previstos" na lista (`transactions.tsx:140-144`),
  `upcoming_bills` alimentando "Vence hoje" (`use-finance.ts:430`) e `cash_flow_forecast` já lendo
  `pending` (`0014_forecast.sql`). O que falta é só a escrita.

Então: um **toggle "Vou pagar depois"** no bloco *Avançado* do form. Ligado, revela um campo
**"Vence em"**; o rótulo do botão não muda ("Salvar" — uma intenção, um rótulo). O insert vira
`status='pending'` com `due_at = <data escolhida>`.

## Pergunta que responde

> "Isso ainda vai sair da minha conta. Não deixa eu esquecer, e desconta da minha sobra."

## Persona

- **Primária: Jorge, 46** — boleto, IPTU, seguro. A pergunta dele ("o que vence e quanto?") só tem
  resposta se ele conseguir registrar o que vence.
- **Secundária: Rafa, 29** — renda irregular. Para ele o valor não está no lembrete: está em o
  "posso gastar isso?" já considerar o que ainda vai sair.
- **Terciária: Camila, 34** — planeja o mês inteiro no domingo.

## Entrada e saída

- **Entrada:**
  - FAB → form → *Avançado* → **"Vou pagar depois"**.
  - Atalho direto: menu do FAB (long press / `Link.Menu`) com **"Conta a pagar"**, que abre o mesmo
    modal com o toggle já ligado e o foco no valor. Duas entradas, um form.
- **Saída:** `router.back()`. O item aparece na hora em "Previstos", em "Vence hoje" quando a data
  chegar, e na curva de projeção.
- **Onde ele vive depois:** lista de lançamentos com o chip "Previstos"; aba Hoje quando vence;
  `/finance/forecast` como degrau da curva.

## Anatomia

Só o que muda no form (a anatomia completa está em `transacao-form.md`):

1. **Toggle "Vou pagar depois"** — dentro de *Avançado*, com uma linha de explicação:
   *"Entra na projeção e some quando você marcar como paga."* Sem essa frase, o toggle é um mistério.
2. **"Vence em"** — aparece só com o toggle ligado. `DateTimePicker` nativo, default: **hoje + 7
   dias** (chute útil de boleto; qualquer default é melhor que um campo vazio obrigatório).
3. **Rótulo do campo de data principal** — com o toggle ligado, "Data" continua sendo `occurred_at`
   (a data de referência do gasto) e "Vence em" é `due_at`. Quando o usuário não mexe em "Data",
   ela acompanha o vencimento — porque para uma conta a pagar as duas datas costumam ser a mesma, e
   `upcoming_bills` usa `coalesce(due_at, occurred_at)` (`0014_forecast.sql:264`) de qualquer
   forma.
4. **Aviso do cartão** — se a conta escolhida for `credit_card`, o toggle **desaparece** com uma
   linha explicando: *"Compra no cartão já entra na fatura de setembro — o caixa sai no vencimento
   dela."* O trigger `set_invoice` (`0013`) já resolve a fatura, e um `pending` manual em cima disso
   contaria o mesmo gasto duas vezes na projeção. **Essa é a regra que impede a conta a pagar de
   quebrar o modelo de caixa** descrito em `finance.md`.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Criar | `useSaveTransaction()` com `status`/`due_at` | — | insert em `transactions` (`use-finance.ts:1099`) | — |
| Dar baixa | `useMarkPaid()` | — | update `status='cleared'` (`use-finance.ts:460`) | `transactions` |
| Aparece em | `useUpcomingBills(7)` | `['upcoming-bills','7']` | RPC `upcoming_bills` | `transactions`, `card_invoices` |
| Aparece em | `useCashFlowForecast(dias)` | `['forecast', dias]` | RPC `cash_flow_forecast` | `transactions` |

Nenhum hook novo. Nenhuma migration nova. É a extensão do `TransactionInput`
(`use-finance.ts:1089-1097`) mais dois campos de UI — e é exatamente por isso que este fluxo é um
modo do form.

**Duas semânticas que precisam estar escritas, porque surpreendem:**

- **`upcoming_bills` só enxerga despesa** (`0014_forecast.sql:268`: `kind='expense'` e
  `invoice_id is null`). Receita futura marcada como `pending` entra na projeção de saldo, mas
  **não** aparece em "Vence hoje". Correto: "a receber" não é "a pagar". Se um dia o produto quiser
  contas a receber com cobrança, é outra RPC.
- **Dar baixa move a data.** `useMarkPaid` faz `update { status: 'cleared', occurred_at: paidAt }`
  (`use-finance.ts:464-467`). Um boleto de agosto pago em 3 de setembro **migra para setembro** nos
  relatórios de categoria. É a semântica de caixa (o dinheiro saiu em setembro), é consistente com o
  resto do domínio — e é diferente do que um usuário de regime de competência espera. A UI diz isso
  em uma linha no toast: *"Marcado como pago em 03/09."*

## Ação primária

**Registrar o que ainda vai sair.** Caminho mínimo: valor → toggle → data → Salvar. Quatro toques.

## Ações secundárias

- **"Paguei"** na linha (lista de lançamentos e aba Hoje) — a baixa é sempre um toque, nunca abre
  tela. Toast com desfazer.
- **Adiar** o vencimento pelo context menu da linha ("Vence em… +7 dias / escolher data"), que é só
  um `update` de `due_at`.
- **Virar recorrente**: no detalhe, "repetir todo mês" leva para o form de recorrentes com os campos
  preenchidos. Conta que se repete deve virar `recurring_transactions`, não dez pendentes na mão.

## Estados

- **Loading** — o do form (ver `transacao-form.md`). O toggle não tem estado próprio.
- **Empty** — o empty relevante não é deste fluxo, é do consumidor: quando não há nenhuma conta
  prevista, a aba Hoje diz *"Nada vence hoje."* e a lista com o chip "Previstos" diz
  *"Nenhuma conta prevista. Toca no + e marca 'Vou pagar depois' para não esquecer um boleto."* —
  a dica acionável que apresenta o fluxo a quem não sabe que ele existe.
- **Error** — validação: *"Escolha a data de vencimento."* e *"O vencimento não pode ser antes da
  data do lançamento."* (regra zod: `due_at >= occurred_at`). Falha de insert: toast + form
  preenchido.
- **Conteúdo longo** — nada específico.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Ligar o toggle | mudança de estado | campo "Vence em" entra com `LinearTransition` em `Motion.fast` (~180 ms); haptic `selectionAsync` |
| Aviso do cartão | explicação | cross-fade em `Motion.fast` quando a conta muda para cartão |
| Salvar | feedback | igual ao form; haptic `notificationAsync(Success)` |
| "Paguei" na linha | feedback | linha colapsa com `LinearTransition` `Motion.fast`; haptic `notificationAsync(Success)` |
| Curva de projeção | mudança de estado | o degrau novo anima com o path em `Motion.slow` — o usuário vê o efeito da conta que acabou de criar |

## Acessibilidade

- Toggle com `accessibilityRole="switch"`, `accessibilityState={{ checked }}` e hint que explica a
  consequência ("entra na projeção de fluxo de caixa").
- "Vence em" anuncia a data por extenso, não `10/09/2026`.
- O aviso do cartão é texto de verdade, não só um campo que sumiu: campo que desaparece sem
  explicação é o pior padrão de formulário que existe.
- Botão "Paguei" com `accessibilityLabel` explícito, alvo ≥ 44pt.

## Fora de escopo

- **Lembrete automático de vencimento.** Já existe caminho: `send-alerts` (cron diário) decide o que
  alertar por `_alerts_to_send()` (`0024_alerts.sql`) e o dedupe por dia protege do spam. Se conta a
  pagar precisar de alerta, é uma linha lá — não uma notificação agendada pelo app.
- **Pagar de dentro do app** (boleto, Pix, open finance). Outro produto, outra licença.
- **Anexar o boleto no ato da criação.** Anexo é ação do detalhe.
- **Parcelar uma conta a pagar.** Parcelamento é `create_installment_plan`, que exige conta/cartão.
- **Conta a receber com cobrança.** Marcar receita futura como `pending` funciona para a projeção; o
  resto é CRM.
