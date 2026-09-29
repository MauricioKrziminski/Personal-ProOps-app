# "E se…?": uma hipótese só, e o detalhe por conta e cartão

**Data:** 29/09/2026 · **Status:** desenho aprovado em conversa, aguardando revisão do spec
**Substitui** a parte de criação do spec `2026-09-28-hipoteses-detalhadas-e-aplicar-design.md`
(o motor `simular` fica; o caminho "Adicionar como…" com o formulário completo sai).

## O pedido

> *"Está com dois botões, por que não só manter um? … pode adicionar de forma rápida, só para ele
> ver, e se ele quiser aplicar, aí quando ele aplicar aparece o forms completo para ele preencher
> tudo."* — dono do produto, 29/09/2026
>
> *"O e se mostra uma visão geral das contas, mas e se mostrar também uma visão detalhada de cada
> conta, cartão escolhido, etc? … na hora de ele preencher a hipótese (antes de aplicar) ele vai
> ter que preencher mais algumas coisas para que esse detalhado venha com os dados tudo correto."*

Decidido na conversa:

- **Um botão, "Nova hipótese"**, e UMA folha. Sai "Adicionar como…", "Aplicar todas" e o modo
  hipótese dos formulários de lançamento, recorrente e dívida.
- **Aplicar abre o formulário completo pré-preenchido** (lançamento, compra parcelada, recorrente
  ou financiamento). Salvar lá tira a hipótese do rascunho.
- **A folha pede o que o detalhe precisa para estar certo** (tabela da seção 2).
- **"Onde muda"** no card do "E se…" e uma tela **"Detalhe da hipótese"** por conta ou cartão.

## Critério de sucesso

1. Uma compra hipotética no cartão cai na fatura que a compra real cairia (pelo dia e pelo
   fechamento), e a fatura, o limite livre e o aviso de limite mostram isso.
2. Um financiamento hipotético sai da conta que paga, no dia do contrato, mês a mês.
3. A conta mostra saldo hoje, menor saldo (e o dia), saldo no fim e "fica negativa em" — iguais
   ao que a mesma hipótese daria criada de verdade.
4. Aplicar abre o formulário com tudo que a folha tinha; o salvo é o que a pessoa confirmou lá.
5. Cartão sem limite cadastrado, hipótese sem conta e conta/cartão que sumiu têm frase própria —
   nunca um número inventado.

## 1. O motor: toda hipótese vira registro de verdade na simulação

A hipótese rápida deixa de ser calculada pelo `draft_effect` (que só sabe "valor em N meses") e
passa por `public.simular`, que cria o registro, lê e desfaz (spec de 28/09, seção 1). É o que
põe a compra na fatura certa e o financiamento no cronograma — sem segunda cópia da regra.

- `rascunho.ts` ganha `registroDaHipotese(d)` (puro, com teste), que monta o registro com os
  construtores de `lib/escrita.ts` (os mesmos do salvar real), com título "Hipótese":
  | forma | registro |
  |---|---|
  | Uma vez (entra ou sai) | `lancamento` (`linhasDoLancamento`), `status` pendente fora do cartão |
  | Parcelado | `parcelada` (`argsDaParcelada`, 0 pagas) |
  | Repete | `recorrente` (`linhaDaRecorrente`, `rrule` pelo `montaRRule` do app) |
  | Financiamento | `financiamento` (`linhaDoFinanciamento`, parcela fixa, `first_due_date` = a data, `due_day` = o dia dela) |
- **O "Adiantar" não muda**: continua `Draft` com `mode: 'cancel'` e entra nas leituras como
  `drafts` (o `simular` já aceita).
- **Uma chamada só por tela.** A Projeção pede `forecast` (ou `meses`), `contas` e `cartoes`
  numa chamada; o ciclo pede `ciclo` e `linhas_do_ciclo`. Sem hipótese, as telas leem como hoje.
- `useForecastWithDrafts` sai da tela (a RPC `forecast_with_drafts` fica: o agente usa).

## 2. A folha "Nova hipótese"

| campo | quando | observação |
|---|---|---|
| **Entra · Sai · Adiantar** | sempre | `Segmented` (3) |
| **Como** | Sai: Uma vez · Parcelado · Repete · Financiamento; Entra: Uma vez · Repete | `Segmented` (≤ 4) |
| **Valor** | sempre (menos Adiantar, que já tem o dele) | Parcelado: total da compra; Financiamento: valor da parcela |
| **Parcelas** | Parcelado, Financiamento | `QuantityField` (2..72 no parcelado, 1..480 no financiamento) |
| **Repete** | Repete | Toda semana · Todo mês · Todo ano |
| **Conta ou cartão** | sempre (menos Adiantar) | `AccountPicker` com "Sem conta". **Obrigatório** em Parcelado e Financiamento; Financiamento só oferece conta (não cartão) |
| **Data** | sempre (menos Adiantar) | `Calendar`, piso = hoje, teto = fim do horizonte máximo |

- O botão da folha é **"Ver resultado"** (nova) e **"Salvar"** (editando), como hoje.
- Falta campo obrigatório → o botão diz por quê (régua de `frontend.md`).
- Título, categoria, estabelecimento, parcelas já pagas: só no formulário do Aplicar.

**O rascunho no aparelho passa à versão 2** (`Draft` ganha `forma`, `conta`, `data`, `repete`,
`parcelas`). Rascunho da versão 1 é lido e convertido: `mode: 'monthly'` → Repete todo mês, sem conta;
`total` com 1 parcela → Uma vez, sem conta; `total` com N > 1 → Parcelado **sem conta**, marcado
incompleto ("Escolha a conta para ver o resultado") e fora da simulação até ser editado;
`cancel` (Adiantar) fica como está. As hipóteses detalhadas da v1 (`detalhadas`) são descartadas
na leitura — o caminho que as criava some, e elas só existem no aparelho de quem testou.

## 3. A lista de hipóteses e o Aplicar

- Cada linha: "Sai R$ 3.000,00 em 10× · Nubank Cartão · a partir de 05/10". Sem conta: "… · sem
  conta (só a visão geral)".
- Arrasto (régua do app): **direita = Aplicar**, **esquerda = Tirar** (com Desfazer). Tocar edita.
- **Aplicar** abre o formulário completo, pré-preenchido por parâmetro (`deHipotese` + campos):
  | forma | formulário | pré-preenche |
  |---|---|---|
  | Uma vez | lançamento | tipo, valor, conta, data |
  | Parcelado | lançamento | tipo, valor total, conta, data, parcelas |
  | Repete | recorrente | tipo, valor, conta, início, frequência |
  | Financiamento | dívida (financiamento) | valor da parcela, parcelas, conta, próxima parcela |
  O formulário de dívida ganha a leitura desses parâmetros (hoje só existe `hipotese`, que sai).
  Salvar tira a hipótese pelo `deHipotese` **pelo identificador dela**, não pela posição (a lista
  pode ter mudado com o formulário aberto).
- Adiantar continua sem Aplicar.

## 4. "Onde muda" e "Detalhe da hipótese"

### Dados

Duas leituras novas, cada uma com porta pública (o "antes", sem hipótese) e leitura no `simular`
(o "depois"), **a mesma função privada nos dois**:

- **`private.contas_no_horizonte(ws, fim)`** → por conta NÃO cartão: `saldo_hoje`, `menor`,
  `dia_do_menor`, `saldo_fim`, `negativa_em` (primeiro dia < 0 ou null). Soma o saldo realizado de
  cada conta com os eventos de caixa de hoje até `fim`.
  **Os eventos de caixa passam a dizer a conta**: `private.cash_events` ganha `account_id` (última
  coluna): a conta do lançamento; na fatura, a `payment_account_id` do cartão (null quando não há);
  no pagamento de fatura, a conta que pagou; no Pix no crédito, a conta que recebeu. É a MESMA
  fonte de `cash_flow_forecast` — por isso "a soma das contas + sem conta" tem que dar a visão
  geral, e o teste confere isso.
- **`private.cartoes_no_horizonte(ws, fim)`** → por cartão: `limite` (null = sem limite),
  `livre` (a mesma conta do `card_summary`), `faturas` (JSON: vencimento, total pela régua
  `conta_na_fatura`, status) das faturas não pagas até `fim`.
- Públicas: `accounts_horizon(days)` e `cards_horizon(days)`; no `simular`, leituras `contas` e
  `cartoes`. `revoke execute … from public, anon` nas novas, `set timezone` no cabeçalho.

### "Onde muda" (no card do "E se…", abaixo da lista)

Uma linha por conta/cartão em que o "depois" difere do "antes":
- Conta: "fim de <mês> R$ A → R$ B"; "fica negativa em dd/mm" quando o depois tem um primeiro
  dia negativo e o antes não tem, ou tem um dia MAIS TARDE.
- Cartão: a primeira fatura que muda "fatura de dd/mm R$ A → R$ B"; "limite livre R$ A → R$ B";
  "passa do limite" quando o livre depois < 0; "sem limite cadastrado" quando `limite` é null.
- Hipótese sem conta aparece na própria linha da hipótese ("só a visão geral"), não aqui.
- Nada muda → o bloco não aparece.

### "Detalhe da hipótese" (tela empurrada, `/finance/hipotese?conta=<id>`)

Lê o rascunho do aparelho (não recebe JSON por parâmetro) e faz a mesma chamada da Projeção.
- **Conta:** três números (hoje, menor e o dia, no fim) antes → depois; aviso "fica negativa em";
  e as hipóteses que mexem nela.
- **Cartão:** limite livre antes → depois (ou "Sem limite cadastrado" + "Cadastrar o limite",
  que abre a edição do cartão); aviso "passa do limite em R$ X"; faturas mês a mês antes → depois,
  a que muda em destaque; as hipóteses que caem nele.
- Conta/cartão arquivado ou apagado depois da hipótese: a hipótese vira erro na linha ("A conta
  não existe mais") e a tela diz o mesmo — nunca número.
- Loading em esqueleto com a forma final; erro com "Tentar de novo"; fonte grande: tudo quebra
  linha, nenhum valor trunca (`design.md` §3/§7).

## 5. O que sai do código

- `forecast.tsx`: `adicionarComo`, `editarDetalhada`, `gravarDetalhada`, `aplicarDetalhada`,
  `aplicarTodas`, `salvando`, as linhas detalhadas, o parâmetro `detalhadas` do "Ver o ciclo".
- `transaction-form.tsx`, `recurring.tsx`, `debts.tsx`: o modo `?hipotese=` inteiro (título, botão,
  desvio do salvar, `guardada`, `paraHipotese`).
- `rascunho.ts`: `HipoteseDetalhada`, `detalhadasValidas`, `hipoteseDoLancamento`,
  `resumoDaHipotese` (dá lugar ao resumo da rápida), `registrosParaSimular` (dá lugar a
  `registroDaHipotese`). `motivoDaHipotese` fica.
- `use-rascunho.ts`: `adicionarDetalhada`, `trocarDetalhada`, `tirarDetalhada`.
- `cycle.tsx`: o parâmetro `detalhadas` (passa a receber as hipóteses rápidas e simular por elas).
- Testes que prendiam o caminho removido saem com ele.
- SQL: nada sai (`simular` segue; `criar_registro_da_hipotese` segue).

## 6. Bordas (cada uma com teste)

| caso | o que a pessoa vê |
|---|---|
| cartão sem limite | "Sem limite cadastrado" e o link; nenhum "passa do limite" |
| compra que passa do limite | "passa do limite em R$ X" no cartão |
| compra no dia do fechamento | cai na fatura que `closing_day_inclusive` manda |
| conta que fica negativa | "fica negativa em dd/mm" |
| conta que já ficava negativa | o menor e o fim mudam; "fica negativa" só se a data ficar mais cedo |
| hipótese sem conta | só a visão geral; a linha diz isso |
| Parcelado/Financiamento sem conta | o botão da folha diz "Escolha a conta" |
| conta/cartão apagado depois | erro na linha, nada somado |
| duas hipóteses no mesmo cartão | a fatura soma as duas |
| entrada numa conta | o saldo sobe; nada de "limite" |
| financiamento no dia 31 | parcela no último dia dos meses curtos |
| data no passado | a folha não deixa (piso hoje) |
| rascunho da versão 1 | convertido; incompleto pede a conta |
| 30 hipóteses | "Nova hipótese" diz o limite |
| Aplicar e voltar sem salvar | a hipótese continua |
| Aplicar com a lista mudada | tira a hipótese certa (por identificador) |
| fonte grande (iPhone a11y-large, Android 384dp × 1,3) | nada partido, nada cortado |

## 7. Testes

- **SQL** (`supabase/tests/`): `cash_events` com `account_id` (fatura na conta que paga, Pix no
  crédito na que recebe); `contas_no_horizonte` somando por conta = `cash_flow_forecast`;
  `cartoes_no_horizonte` com e sem limite; `simular` com `contas`/`cartoes` = criar de verdade;
  anon sem execute.
- **Funções puras:** `registroDaHipotese` (as quatro formas), a leitura da v1, o resumo da linha,
  o "Onde muda" (antes × depois → linhas e avisos).
- **Tela:** folha (campos por forma, bloqueios), Aplicar de cada forma (parâmetros), Tirar por id,
  "Onde muda" (cada aviso), Detalhe (conta, cartão com e sem limite, erro, loading).
- **Aparelho:** criar as quatro formas no staging, conferir Onde muda e Detalhe contra o banco,
  aplicar cada uma, em fonte normal e grande, no iPhone e no Android. Limpeza por ID anotado.

## 8. Subida

Migrations (staging; produção pelo Gabriel, antes do app) → app. MINOR. O agente não muda.
