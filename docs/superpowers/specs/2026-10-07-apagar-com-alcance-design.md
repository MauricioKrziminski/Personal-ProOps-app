# Apagar com alcance: "Só esta | Esta e as próximas | Todas"

**Data:** 07/10/2026 · **Status:** desenho aprovado em conversa, aguardando revisão do spec

## O pedido

> *"se eu quiser apagar um lançamento que for recorrente, eu tenho que ter as tres opcoes que nem
> se eu fosse editar e salvar, apagar somente aquela "parcela" do recorrente, todas inclusive as
> passadas e aquela e as futuras... Isso para tudo que nao é assim tambem, nao so recorrente."*
> — dono do produto, 07/10/2026

Decidido na conversa:

- A pergunta do APAGAR é a mesma do EDITAR (`editScopeChoices`): ocorrência aberta pergunta "Só
  esta / Esta e as próximas / Todas"; contrato aberto pergunta "Das próximas em diante / Todas".
- **"Todas" apaga inclusive o que foi PAGO**, depois de uma confirmação que escreve o estrago.
  Recusa só o que está em fatura paga, adiada ou paga em parte, com motivo e caminho.
- Agente não muda nesta fase.

## Hoje

Editar tem escopo (`askEditScope`, `update_transaction_scoped`, `update_recurring_series`,
`update_recurring_future`, `update_installment_scope`, `save_reminder_scoped`); apagar não tem
nenhum: todo "Apagar" é `confirmDestructive` sim/não, e cada tela apaga um alcance fixo.

| tipo | hoje |
|---|---|
| lançamento, ocorrência gravada, parcela, pagamento de dívida | `useDeleteTransaction`: delete direto da linha |
| ocorrência prevista | `skip_recurring_occurrence` (só esta) |
| série (Recorrentes) | delete de `recurring_transactions`; `recurring_drop_future` leva as futuras `pending` (passado e atrasada ficam) |
| compra (Parceladas / "Apagar a compra inteira") | `delete_installment_purchase` (recusa com parcela travada) |
| dívida | `delete_debt` (pagamentos + dívida) |
| lembrete | delete direto de `reminders` |

## 1. O que cada alcance faz

| aberto | Só esta | Esta e as próximas | Todas |
|---|---|---|---|
| ocorrência de recorrente | apaga a linha; a data não volta (`ocorrencia_apagada_nao_volta`) | **encerra a série** na véspera dela e apaga as em aberto dali em diante; pagas e atrasadas ANTES dela ficam | apaga a série e TODAS as ocorrências, pagas incluídas |
| parcela de compra | apaga a parcela; o total do plano passa a ser a soma das que ficam | **encurta a compra**: ela e as seguintes saem; as anteriores ficam; sobrando uma, vira lançamento à vista (régua do `update_installment_plan`) | apaga a compra inteira (`delete_installment_purchase`), pagas incluídas |
| pagamento de financiamento | desfaz esse pagamento (gatilho atual: devolve o principal, renumera) | desfaz esse e os seguintes, do MAIS RECENTE para trás; a dívida fica | apaga a dívida e todos os pagamentos (`delete_debt`) |
| ocorrência de lembrete | apaga essa vez (já existe) | encerra o lembrete antes dessa vez | apaga o lembrete inteiro |

- **Aberto pelo contrato** (Recorrentes, Parceladas, ficha da dívida, lista de lembretes): só "Das
  próximas em diante / Todas"; a âncora de "próximas" é o próximo vencimento em aberto (o
  `next_run_at` da série; a primeira parcela em aberto; o próximo pagamento do cronograma —
  pagamentos registrados depois de hoje).
- **Lançamento avulso** não pergunta: apaga com "Desfazer", como hoje.
- **"Esta e as próximas" da recorrente reaproveita o "Encerrar"** (`end_recurring_series`,
  `private.series_end_scope`): fim = véspera da âncora. Não nasce uma segunda régua do que sai e
  do que fica. A diferença é que, ABERTA por uma ocorrência paga ou atrasada, ela própria sai
  também (o pedido é apagar a partir dela).
- **"Todas" da recorrente** apaga a série E as linhas com `recurring_id` dela, de qualquer status
  (o trigger `recurring_drop_future` só leva as futuras em aberto).

## 2. Confirmação do estrago

Se o alcance escolhido inclui linha PAGA (`status='cleared'`, ou pagamento de dívida registrado),
uma segunda folha destrutiva diz o que vai sair antes de qualquer escrita:

> *"Isso apaga 8 pagamentos já feitos (R$ 9.590,00) e muda o saldo da Nubank e o histórico desde
> maio."*

O número vem de uma prévia do banco (`delete_scoped_preview`, mesma função que decide o alcance —
nunca contado no cliente), com: quantas linhas, quantas pagas, soma das pagas, contas afetadas e o
mês mais antigo.

## 3. Banco

- **Uma RPC por intenção, atômica**: `public.delete_scoped(p_tipo text, p_id uuid, p_alcance text,
  p_request_id uuid)` + `public.delete_scoped_preview(p_tipo, p_id, p_alcance)`.
  - `p_tipo`: `occurrence | installment | debt_payment | recurring | plan | debt | reminder`
    (`recurring`, `plan`, `debt` = aberto pelo contrato).
  - `p_alcance`: `one | future | all` (o mesmo `EditScope`).
  - Wrapper `invoker` + comando `definer` em `private`, `search_path = ''`, `set timezone to
    'America/Sao_Paulo'` no cabeçalho, `revoke ... from public, anon`. Confere o espaço do alvo.
  - Recibo selado + `p_request_id` (padrão das escritas compostas em `finance.md`): repetir com a
    mesma chave devolve o resultado anterior.
  - Devolve `{apagadas, pagas_apagadas, soma_pagas_cents}` para o toast.
- **Compõe as portas que já existem**, não reescreve: `end_recurring_series`,
  `delete_installment_purchase`, `delete_debt`, `update_installment_plan` (encurtar), o gatilho de
  pagamento de dívida (apagando do mais recente para trás, dentro da trava `proops.apagando_divida`
  quando aplicável), o escopo de lembrete (`save_reminder_scoped` / encerrar).
- **Travas**:
  - linha em fatura `paid`/`rolled`/`paid_cents > 0` (`private.parcela_travada`) → recusa a
    operação inteira com *"Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o
    pagamento da fatura antes."*;
  - **apagar que deixaria fatura paga em parte com total < pago passa a ser recusado também no
    delete comum** (o buraco descrito em `20260909090000`): guarda num gatilho BEFORE DELETE de
    `transactions` (ou no ponto único que o plano achar), que vale para todo caminho.
- Pagamento de dívida "esta e os próximos": apaga do mais recente até o escolhido, um por vez,
  para o gatilho devolver o saldo na ordem certa.

## 4. App

- **`askDeleteScope(kind, onSelect, opcoes?)`** em `src/lib/edit-scope.ts`, com os rótulos de
  `editScopeChoices` (`edit-scope-model.ts`) e título "Apagar"; `contrato: true` dá 2 opções.
- Hook `useDeleteScoped` (`use-finance.ts`): chama a prévia; com pagas, `confirmDestructive` com
  a frase da prévia; depois `delete_scoped`; invalida o que `useDeleteTransaction`,
  `useDeleteRecurring`, `useDeleteInstallmentPlan` e `useDeleteDebt` invalidam.
- **Pontos de "Apagar"** que passam a perguntar:
  - ocorrência: `finance/[txId].tsx` (o par "Apagar só esta parcela" / "Apagar a compra inteira"
    vira UM "Apagar"), `formulario-do-lancamento.tsx` (`onDelete`), `finance/transactions.tsx`,
    `(tabs)/finance/index.tsx`, `finance/invoice/[id].tsx` (menu e arrasto),
    `expected-ledger-lines.tsx` (prevista: "Só esta" segue `skip_recurring_occurrence`; os outros
    alcances vão por `delete_scoped` pela série);
  - contrato: `finance/recurring.tsx`, `finance/installments.tsx`, `finance/debts.tsx` (ficha e
    lista), `reminders.tsx`, `reminder-form.tsx`.
- Toast: *"5 ocorrências apagadas"*. Desfazer só no "Só esta" de linha (como hoje); os alcances
  maiores já foram confirmados.
- `import.tsx` não muda (lote de importação não é série).

## 5. Fora do escopo

- Agente: "apaga o aluguel daqui pra frente" segue como hoje (série inteira / compra / dívida) →
  linha em `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- Desfazer de alcance grande.

## 6. Testes e verificação

- **SQL** `supabase/tests/apagar_com_alcance.sql`, sem depender do dado do banco: cada tipo ×
  alcance apaga exatamente o prometido; pagas só saem em "Todas"; data apagada não volta pelo
  agendador; "Esta e as próximas" encerra a série (fim = véspera); total da compra = soma das que
  ficam; pagamentos de dívida desfeitos do mais recente para trás com o saldo certo; recusas de
  fatura paga/adiada/paga em parte com a frase; o delete comum também recusa derrubar fatura paga
  em parte abaixo do pago; mesma `p_request_id` = um efeito; prévia = o que a escrita apaga;
  outro espaço não apaga; `anon_sem_execute.sql`. **Suíte SQL inteira.**
- **App**: unidade dos rótulos de `askDeleteScope`; `simple-finance-ui.test.ts`: ocorrência abre
  três opções, contrato duas, avulso nenhuma, com paga aparece a confirmação ANTES de qualquer
  escrita, sem confirmar nada é gravado; `tsc`, lint, `npm test`.
- **Tela**: simulador/emulador com `dev@` no staging, série criada para o teste, apagada nos três
  alcances; limpar pelos IDs anotados.
- **Produção** só com pedido: migration → app.
