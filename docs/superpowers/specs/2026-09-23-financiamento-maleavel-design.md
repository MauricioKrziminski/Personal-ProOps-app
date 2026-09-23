# Financiamento maleável — primeira parcela, editar tudo, arquivadas, excluir e a linha do tempo

Itens 6 a 10 do lote de 23/09/2026 (tarde). Bug doc:
`docs/bugs/2026-09-23-tarde-calendario-busca-valor-financiamento.md`.

## O que o dono do produto pediu

6. A primeira parcela às vezes vem daqui a 3 meses: **seletor de data da primeira parcela**.
7. Financiamento arquivado some e não tem volta: **mostrar as arquivadas e desarquivar**.
8. **Excluir por completo**, tirando os lançamentos anteriores e os futuros.
9. A tela do financiamento tem letra pequena e uma tabela feia: **redesenho**, com o **"…" no
   alto** (Editar, Arquivar, Excluir) — as mesmas ações do toque longo na lista.
10. **Editar com todas as opções do criar**: valor TOTAL no lugar da parcela (também no criar),
    data de vencimento e quantas parcelas já foram pagas. Mudar a data ou as pagas tem que mudar
    o financiamento inteiro.

## Decisões já tomadas (Gabriel, 23/09/2026)

| pergunta | decisão |
|---|---|
| "Valor total" é o quê? | **Total a pagar**: a soma das parcelas, com os juros dentro (o "48× de R$ 1.470" do carnê). Parcela = total ÷ nº de parcelas. |
| Desenho do detalhe | **Linha do tempo**: herói com anel de progresso, parcelas por ano (pagas preenchidas, a próxima em destaque, futuras vazias). |
| Contrato com pagamento registrado pelo app ("Paguei") | **Libera e recalcula**: valor, nº de parcelas e pagas ficam editáveis mesmo com pagamento lançado. Os pagamentos antigos viram histórico solto — não se corrige nem se apaga mais um pagamento ANTERIOR à edição pelo app (o "Excluir por completo" continua apagando tudo). |

## Como o cronograma funciona hoje (o que muda e o que não)

`private.debt_schedule_for` é a fonte ÚNICA das parcelas futuras. Projeção (`cash_events`,
`_cash_flow_forecast`), "O mês inteiro" (`month_lines_for`), Hoje (`upcoming_bills`), ciclo,
"E se…" (`anticipation_candidates`) e ordem de ataque (`payoff_strategy_for`) passam por ela.
A próxima parcela é sempre a próxima ocorrência do `due_day` **a partir de hoje** (ou depois do
ciclo, se já pagou neste). Não existe âncora no futuro — é o item 6.

Mudar o `due_day` ou as `installments_paid` já move tudo o que vem dessa função, porque nada é
materializado. O que falta é: (a) a âncora futura, (b) a tela deixar editar, e (c) o banco não
barrar o contrato de parcela fixa com pagamento registrado.

## A. Banco — uma migration (`20260923160000_financiamento_maleavel.sql`)

### A1. `debts.first_due_date date` (nullable): a data da parcela nº 1 do contrato

A âncora do CONTRATO, não da tela. A parcela `n` do contrato vence em
`day_in_month(add_months(first_due_date, n − 1), due_day)`.

Em `debt_schedule_for`, o `primeiro` passa a ser

```
greatest(<o cálculo de hoje>,
         day_in_month(add_months(first_due_date, installments_paid), venc))   -- null é ignorado
```

| cenário | resultado |
|---|---|
| novo, 1ª parcela daqui a 3 meses, 0 pagas | começa na data escolhida (o `greatest` pega a futura) |
| pagou a 1ª no dia | a 2ª cai no mês seguinte (as duas regras concordam) |
| pagou a 1ª ADIANTADA, antes do vencimento | a 2ª continua no mês dela, não é puxada para frente |
| atrasado (a próxima do contrato já passou) | igual a hoje: a próxima ocorrência do dia a partir de hoje |
| dívida antiga, `first_due_date` null | nada muda |

`null` continua sendo o comportamento de hoje, então nenhuma dívida existente muda sem edição.

### A2. Contrato de parcela fixa editável com pagamento registrado

`tg_debts_calculation_mode` perde as duas travas de "já existe pagamento". Fica só "o modo de
cálculo não muda". O `check` de parcela fixa (`principal = parcela × N`,
`remaining = parcela × (N − pagas)`) continua segurando a aritmética.

- Pagamento NOVO depois da edição continua certo: o `INSERT` lê `installments_paid` e
  `remaining_cents` atuais, e o `tg_fixed_installment_payment` exige o valor NOVO da parcela.
- Pagamento ANTIGO vira histórico: o `DELETE`/correção de valor dele já recusa quando ele não é
  o mais recente e coerente com o saldo ("Corrija primeiro o pagamento mais recente"). É o custo
  aceito.

### A3. `public.delete_debt(p_debt_id uuid) returns int`

Apaga os pagamentos lançados (`transactions.debt_id`) e a dívida, numa transação. Devolve
quantos pagamentos saíram.

- **Por que uma RPC:** hoje apagar a dívida FALHA quando há pagamento. A FK é
  `on delete set null`, esse `UPDATE` dispara `tg_transactions_debt_payment`, e ele recusa
  "desvincular". E apagar os pagamentos um a um exige a ordem inversa e trava no histórico solto.
- **Como:** `set_config('proops.apagando_divida', p_debt_id::text, true)` (local à transação),
  e o trigger de pagamento devolve a linha sem tocar na dívida quando a GUC nomeia AQUELA dívida.
  Depois `delete from transactions where debt_id = …` e `delete from debts where id = …`.
- `security invoker`: no app a RLS limita as duas deleções ao workspace da pessoa. O agente passa
  por `ensure_owned` antes. `execute` para `authenticated`, sem `anon`.
- **Idempotente:** a dívida que já não existe devolve 0, sem erro.
- As parcelas FUTURAS não são linha: somem da projeção junto com a dívida.

Desarquivar é `update debts set archived = false`, sob RLS. Não precisa de RPC.

### A4. Teste SQL — `supabase/tests/financiamento_maleavel.sql`

1. `first_due_date` a 3 meses: a 1ª linha do cronograma é essa data, e nenhuma linha antes.
2. Com 1 paga adiantada: a próxima é `first + 1 mês`, e não a data original.
3. Mudar `installments_paid` de 8 para 10 muda a numeração (11ª) e a data.
4. Contrato de parcela fixa com pagamento registrado: o `update` passa, e um `Paguei` novo grava
   o `debt_payment_no` e o saldo coerentes com o contrato novo.
5. `delete_debt`: apaga N pagamentos e a dívida, e a 2ª chamada devolve 0. A projeção
   (`cash_events`) não traz mais nenhuma linha dela.
6. `has_function_privilege`: `authenticated` executa, `anon` não.

## B. App

### B1. Formulário (criar e editar, em `debts.tsx`)

**Parcela fixa** (o caminho rápido):

1. **Valor** com a unidade escrita, **Cada parcela | Total a pagar** (o mesmo `Segmented` do
   lançamento parcelado). Com "Total a pagar", parcela = `round(total / N)`, e o resumo mostra o
   contrato que será gravado ("48× de R$ 1.458,33 = R$ 69.999,84"): o `check` exige
   `total = parcela × N` em centavos inteiros. Trocar a unidade sem digitar não move dinheiro,
   a mesma régua do `ValorDaCompra`.
2. **Total de parcelas** — `QuantityField` (quantidade é campo aberto, `frontend.md`).
3. **Parcelas já pagas** — `QuantityField`, no criar E no editar. Mínimo = pagamentos
   registrados no app (dizer menos do que já foi lançado é contradição, e o campo assenta sozinho).
   Máximo = total.
4. **Primeira parcela** (0 pagas) / **Próxima parcela** (a `n`ª): a data, pelo `Calendar` inline.
   Grava `due_day = dia(data)` e `first_due_date = data − pagas meses` (`addMonthsISO`, que já
   existe em `lib/debt-history.ts`). Substitui o campo de texto "Vence dia". No editar, o campo
   abre na próxima parcela que o cronograma já mostra (`debt_schedule`, 1ª linha); mudar as pagas
   sem mexer na data mantém a data (a âncora é refeita a partir dela).
5. **Nome e conta que paga**: saem do botão fantasma "Adicionar detalhes (opcional)" (item 11)
   para uma linha que abre no lugar ("Nome e conta" + valores atuais + chevron). No editar ela já
   nasce aberta.

**Com juros ao mês**: continua com saldo, valor original, taxa e parcela. Ganha a mesma **data
da próxima parcela** e **parcelas já pagas** no editar.

O modo (fixa × com juros) só se escolhe ao criar — o banco não deixa mudar.

A aritmética nova é pura e vai para `lib/finance-form.ts` com teste em `node --test`:
`parcelaDoTotalDoContrato(total, n)`, `primeiraParcelaDoContrato(proxima, pagas)` e
`proximaParcela(first_due_date, pagas, due_day)`.

### B2. Lista

- **Arquivadas**: no fim da lista, uma linha "Arquivadas · N" que abre no lugar. Cada arquivada
  aparece esmaecida, e o toque longo oferece **Desarquivar** e **Excluir por completo**. Sem
  arquivadas, a linha não existe.
- **Arquivar** mostra o toast com **Desfazer** (o `useToast` já aceita `action`).
- **Toque longo** em ativa: Ver as parcelas, Editar, Arquivar, Excluir por completo.
- **Excluir por completo**: `confirmDestructive` com a consequência contada — "Apaga o
  financiamento, os 3 pagamentos já lançados (R$ 4.410,00, que voltam ao saldo das contas) e as
  parcelas futuras da projeção. Não dá para desfazer."

### B3. Detalhe — linha do tempo (continua `Sheet`)

- `TaskHeader` com o título e, no slot `action`, o botão **"…"** → `showItemActions` com
  Editar, Arquivar e Excluir por completo (a MESMA lista do toque longo, de uma função só).
- **Herói**: `RingGauge` com pagas/total, "9 de 48 pagas", o que falta a pagar e a próxima
  parcela (data + valor) com o botão **Paguei esta parcela**.
- **Linha do tempo por ano**: um trilho vertical. Pagas preenchidas (as registradas com a data
  do pagamento, as declaradas com "estimada"), a próxima com anel e destaque, futuras vazias.
  Cada linha diz "9ª · out" e o valor. No modo com juros, a linha também diz quanto é juro.
  Letra de corpo (`subhead`/`body`), nunca `footnote`.
- Continua `Sheet` (não vira tela empurrada): o `?id=` que abre o detalhe a partir do mês
  continua valendo, e o pagar e o editar continuam no mesmo arquivo.
- Movimento: a linha da próxima entra com o anel desenhando (uma vez, na abertura), e com
  Reduce Motion não há movimento. Nada de `LinearTransition` (`transicaoDeLayout`).

## C. Agente (paridade)

| app | agente |
|---|---|
| data da 1ª/próxima parcela | campo `first_due_date` no catálogo de `debts` (`resources.py`), YYYY-MM-DD, mais a linha do prompt ("a primeira parcela vence daqui a 3 meses") |
| editar pagas com pagamento lançado | cai o `reference_guard` que recusava `installments_paid` com pagamento |
| desarquivar | `resource_update archived=false` — conferir que a busca por nome acha a arquivada |
| excluir por completo | `resource_delete debts` com `trashed=true` (a mesma convenção de "apagar DE VEZ" das notas) → `delete_debt`, com a frase do SIM contando os pagamentos que saem |

Linhas novas em `docs/AGENTE-PARIDADE-COM-O-APP.md`. Sem campo novo no `FinanceAction` (teto
252): tudo é catálogo de `ResourceAction`.

## D. Validação (cada tarefa valida na hora, não no fim)

- `node --test` das funções puras; SQL no staging (transação com rollback); `pytest` do agente.
- Emulador Android e simulador iOS, claro e escuro, 384dp × 1,3:
  1. criar parcela fixa com "Total a pagar" e primeira parcela daqui a 3 meses → Projeção e "O
     mês inteiro" sem parcela antes dessa data;
  2. editar a data → o cronograma inteiro anda;
  3. editar pagas 0 → 5 → a numeração e o histórico mudam;
  4. com um "Paguei" registrado, mudar o valor → grava, e o próximo "Paguei" usa o valor novo;
  5. arquivar → toast "Desfazer" → volta; arquivar de novo → "Arquivadas · 1" → desarquivar;
  6. excluir por completo → os pagamentos somem de Lançamentos e o saldo da conta volta.
- Dado de teste no staging: criado e apagado pelo ID anotado.
- `migration-reviewer` na migration e `ui-polisher` nas telas.

## Fora do escopo

- Transformar o detalhe em tela empurrada.
- Mudar o modo de cálculo de uma dívida existente (o banco recusa de propósito).
- Parcela de financiamento virar `transactions` materializada.
