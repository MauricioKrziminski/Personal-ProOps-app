# Hipóteses detalhadas no "E se…?", e aplicar a hipótese na conta

**Data:** 28/09/2026 · **Status:** aprovado em conversa, aguardando revisão do spec

## O pedido

> *"Se ele criar essas hipóteses e quiser aplicar, ele deve ter como (aí aplicando, salva na conta),
> então se tiver como criar essas hipóteses com financiamentos, parcelas, recorrentes, etc, seria
> melhor e com os mesmos campos que ele criaria manualmente cada um deles realmente."*
> — dono do produto, 28/09/2026

Decidido na conversa:

- **Dois tipos de hipótese convivem.** A **rápida** (valor + mês, a de hoje) continua; a
  **detalhada** é criada no formulário real de cada coisa. Aplicar a rápida abre o formulário
  completo pré-preenchido; aplicar a detalhada salva direto.
- **O rascunho fica salvo no aparelho** até aplicar ou limpar. Troca a decisão anterior ("sair da
  tela apaga", `finance.md`, *Rascunho de cenário*): com formulário completo, perder o que se
  digitou custa caro.
- **"Parcelas já pagas" e todos os outros campos existem na hipótese**, porque é o mesmo formulário.
  O caso real: assumir ou refinanciar um financiamento que já tem parcelas pagas.

## Critério de sucesso

1. Uma compra hipotética no cartão em 10× sai do caixa **no vencimento de cada fatura**, igual à real.
2. Um financiamento hipotético segue **o cronograma real** (juros, parcela fixa, último dia do mês).
3. Uma recorrente hipotética (mensal, semanal, anual) aparece na Projeção como a real.
4. Aplicar produz **exatamente** os registros que o formulário manual produziria.
5. Nada da hipótese fica no banco enquanto ela não é aplicada.

## 1. O motor: criar de verdade, ler, desfazer

**Uma função nova, `public.simular(p_registros jsonb, p_leituras jsonb) returns jsonb`**, `plpgsql`,
`security invoker`, `set timezone to 'America/Sao_Paulo'`, sem `execute` para `anon`.

Dentro de uma subtransação (`begin … exception … end`), ela:

1. **Cria cada registro** de `p_registros` pelo MESMO caminho do formulário:

   | `tipo` | o que o app faz hoje | o que `simular` faz |
   |---|---|---|
   | `lancamento` | `insert into transactions` (`useSaveTransaction`, `use-finance.ts:2920`), mais a linha de juros do Pix no crédito | o mesmo `insert` com o mesmo payload (as duas linhas quando houver juros) |
   | `parcelada` | `create_installment_plan_with_history` / `create_installment_plan_last_day` | a mesma RPC, com os mesmos argumentos |
   | `recorrente` | `insert into recurring_transactions` (`recurring.tsx:102`) | o mesmo `insert` |
   | `financiamento` | `insert into debts` (`useSaveDebt`, `use-finance.ts:2403`) | o mesmo `insert` |

   O `workspace_id` vem do default da coluna (`my_default_workspace()`, que lê `auth.uid()`), e
   `simular` roda como quem chama: RLS vale, e os gatilhos disparam como na criação manual
   (`set_invoice`, `set_paid_at`, histórico da dívida e da recorrente).

2. **Cada registro em sua própria subtransação interna.** O registro que falha (conta arquivada
   depois, valor inválido) é pulado e volta em `erros: [{indice, mensagem}]`. Os outros seguem.

3. **Roda as leituras pedidas** em `p_leituras`, numa lista fechada, com os argumentos de cada uma:
   - `forecast` → `forecast_json(days, drafts)`;
   - `meses` → `month_forecast_json(days, drafts, p_view)`;
   - `ciclo` → `cycle_series(de, ate, p_view)`;
   - `linhas_do_ciclo` → `cycle_lines(p_month, p_view)`.

   Os `drafts` das hipóteses rápidas vão junto nas duas primeiras, e as duas famílias somam na
   mesma série.

4. **Guarda o resultado numa variável e levanta um erro próprio** (SQLSTATE dedicado). O `exception`
   da subtransação o pega e desfaz TODAS as escritas. A função devolve
   `{ leituras: {...}, criados: [{indice, ids}], erros: [{indice, mensagem}] }`: `criados` diz
   quais linhas de cada leitura vieram de qual hipótese (seção 7). Os ids não existem mais depois
   da chamada, e servem só para marcar.

   Nada fica no banco. O Realtime não vê nada, porque transação desfeita não publica. O único
   rastro são números de sequência consumidos, que não importam.

**Por que assim, e não estendendo o motor do rascunho** (`private.draft_ocorrencias`): o motor do
rascunho só sabe "valor em N meses". Para a compra no cartão ele teria que saber em qual fatura ela
cai (a regra mora em `set_invoice`, num lugar só) e, para o financiamento, montar a Price (mora em
`debt_schedule_for`). Reescrever as duas seria a segunda cópia que diverge (`finance.md`). Criar e
desfazer usa as regras de verdade.

**Leituras que ficam de fora de `simular`:** o que só o agendador Python faz dentro da hora
(promover `pending` com `auto_confirm` já vencido, fechar e liquidar fatura). A hipótese é sobre o
futuro, e ali isso não acontece. Uma hipótese datada no passado aparece como "atrasada hoje", que
é o que o banco faria até a rodada.

## 2. Um payload, dois usos

Cada formulário passa a montar o que grava numa **função pura** que o salvar real e a hipótese
chamam igual:

- `payloadDoLancamento(form)`;
- `argsDaParcelada(form)`;
- `payloadDaRecorrente(form)`;
- `payloadDoFinanciamento(form)`.

Hoje esses payloads são montados dentro dos formulários e dos hooks, campo a campo (`finance.md`:
*"payload montado campo a campo é payload que esquece campo"*). A hipótese guarda o **payload
pronto**; aplicar é entregar esse mesmo payload ao hook que já salva. O que foi simulado é, byte a
byte, o que é aplicado.

## 3. Criar uma hipótese detalhada

- No card "E se…?", ao lado de "Supor um lançamento", **"Adicionar como…"** abre as opções
  Lançamento, Compra parcelada, Recorrente e Financiamento.
- Cada opção abre **o formulário real** com `?hipotese=1`:
  - `/finance/transaction-form?hipotese=1` para lançamento e compra parcelada, que são o mesmo
    formulário, com as parcelas dentro;
  - `/finance/recurring?create=1&hipotese=1`;
  - `/finance/debts?create=financing&hipotese=1`.
- Em modo hipótese:
  - o botão de salvar vira **"Adicionar à hipótese"**, e o título da tela diz "Nova hipótese";
  - o formulário **não escreve nada**: monta o payload (seção 2), guarda no rascunho e volta;
  - as validações são as mesmas do salvar real — hipótese que não passaria no formulário não
    entra no rascunho.

## 4. O rascunho

- **Uma lista só, no aparelho, por usuário.**
  - Onde mora: `usePreferencia` guarda texto; o rascunho vai como JSON numa chave
    `projecao:rascunho`, com uma versão para migrar o formato no futuro.
  - Cada item é uma de três coisas:
    - rápida — o `Draft` de hoje;
    - adiantar — o grupo de hoje;
    - detalhada — `{tipo, payload, titulo, resumo}`.
- **Cada linha mostra o título e o tipo**, por exemplo "Notebook · compra 10× · R$ 3.000,00".
  Tocar abre o formulário (detalhada) ou a folha de hoje (rápida) para editar.
- **Arrasto** (a régua do app, `design.md` §6):
  - direita: **"Aplicar"** (curto) — a rápida abre o formulário pré-preenchido, a detalhada
    confirma e salva;
  - esquerda: **"Tirar"**, com "Desfazer".
  - O "Adiantar" não tem "Aplicar" nesta versão (seção 6), então à direita ele fica só com o
    que já tem hoje.
- **"Aplicar todas"** no fim do card aplica as detalhadas em sequência. As rápidas pendentes ficam,
  com a frase dizendo quantas precisam de formulário.
- **"Limpar"** continua apagando tudo, com "Desfazer".

## 5. Aplicar

- **Detalhada:** confirmação curta ("Salvar Notebook na conta? Compra em 10× no Nubank"). Depois
  disso, o hook que já salva recebe o payload guardado.
  - Deu certo: sai do rascunho, e a Projeção passa a mostrá-la como real (a mesma linha, sem a
    marca de hipótese).
  - Falhou: continua no rascunho e a frase diz o motivo, que é o do banco, o mesmo do formulário.
- **Rápida:** abre o formulário completo **pré-preenchido**, em modo normal (salva de verdade).
  - Mapeamento:
    - `income`/`expense` vira o tipo;
    - o valor vai como está;
    - o mês vira a data;
    - `installments > 1` vira compra parcelada (unidade "total");
    - `mode: 'monthly'` vira recorrente mensal.
  - O form recebe um id da hipótese (`?deHipotese=<id>`) e, ao salvar, tira a hipótese do
    rascunho. Fechar sem salvar mantém a hipótese.

## 6. O que fica de fora nesta versão

- **Aplicar o "Adiantar".** Aplicar seria lançar os pagamentos antecipados das parcelas existentes —
  outro fluxo, com as travas de fatura. Continua como hipótese.
- **Hipótese detalhada pelo agente do WhatsApp.** O agente segue com as hipóteses rápidas
  (`simulate_scenario`). Linha nova em `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- **Conta e cartão hipotéticos.** Hipótese usa as contas que existem. Um cartão novo é criado de
  verdade antes.

## 7. O detalhe do ciclo com hipóteses

A Projeção passa o rascunho à tela do ciclo, como já faz. O ciclo:

- lê `ciclo` e `linhas_do_ciclo` por `simular` quando há hipótese detalhada;
- nesse caso, as linhas que vêm de registro hipotético saem marcadas e vão ao grupo "Hipóteses do
  rascunho", cada uma na forma que a real teria (a compra dentro da fatura, a parcela do
  financiamento);
- continua usando `draft_lines` (`20260928236000`) para as rápidas.

Para marcar a linha, `simular` devolve os ids criados de cada registro e a tela compara com o
`ref_id` das linhas. As hipóteses que falharam aparecem no topo do rascunho, com o motivo.

## 8. Erros e bordas

- **Payload velho no aparelho** (a conta foi arquivada, o cartão apagado): `simular` devolve em
  `erros`, a linha mostra "Não dá para aplicar: <motivo>" e a hipótese continua editável.
- **Conflito com o real:** aplicar duas vezes a mesma hipótese não acontece, porque ela sai do
  rascunho no sucesso e o botão fica desligado enquanto salva.
- **Desempenho:** o custo é a escrita, desfeita, mais a leitura normal. Medir no staging com 10
  hipóteses detalhadas e 10 anos de Projeção antes de subir. O teto da Projeção é o mesmo
  (`clamp_forecast_days`).
- **Várias leituras numa chamada:** a Projeção pede `forecast` e `meses` numa chamada só, para não
  criar e desfazer duas vezes.

## 9. Testes

- **SQL**, em `supabase/tests/simular.sql`:
  - uma compra 10× no cartão, um financiamento com parcelas pagas e uma recorrente semanal
    simulados devolvem a mesma série que devolveriam se criados de verdade (comparando com a
    criação real numa transação desfeita pelo teste);
  - depois de `simular`, o banco não tem nada novo;
  - um registro inválido volta em `erros` e não derruba os outros;
  - `anon` sem `execute`.
- **Tela**, em `simple-finance-ui.test.ts`:
  - cada formulário em modo hipótese não escreve (`writes.length === 0`) e entrega o payload ao
    rascunho;
  - "Aplicar" chama o hook com o payload guardado;
  - a rápida abre o formulário pré-preenchido.
- **Funções puras:** os `payloadDo…` com teste, e o mapeamento da rápida para o formulário.
- **No simulador e no emulador:**
  - o fluxo inteiro: criar as quatro, ver a Projeção e o ciclo, aplicar e ver virar real;
  - em fonte grande.

## 10. Ordem de subida

Migration de `simular` (staging, depois produção pelo Gabriel), depois o app. O agente não muda.
Pela régua de versão (`CLAUDE.md`), isso é **funcionalidade nova** e sobe numa versão MINOR
(`1.5.0`), porque a tela muda e o app passa a chamar RPC nova.
