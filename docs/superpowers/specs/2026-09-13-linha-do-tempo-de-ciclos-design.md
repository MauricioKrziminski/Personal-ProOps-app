# A linha do tempo de ciclos — design (13/09/2026)

Aprovado pelo dono do produto em 13/09/2026, depois de *"eu ainda estou 100% perdido no app,
muito perdido mesmo… ou unifica tudo isso de uma forma que mantém as telas bem minimalistas e
intuitivas, ou verifique uma maneira melhor de fazer tudo isso"*.

## O problema, medido

| sintoma | evidência |
|---|---|
| o mesmo rótulo com valores diferentes | `TENHO HOJE` em 3 telas: −370,92 (Hoje), **0,72** (Entradas e saídas), −370,92 (Projeção) |
| as mesmas seções em 2 telas | `Atrasado` / `O que vence` / `O que entra` na Hoje **e** na Projeção |
| a mesma pergunta com 2 respostas | "como fecha o mês X": Entradas e saídas conta o cartão **na data da compra**, Projeção **na data do pagamento** |
| 5 lugares que projetam | herói da Hoje, mini-gráfico do Financeiro, Entradas e saídas, Projeção *Por dia*, Projeção *Por mês* |

A causa não é layout: são **duas bases de cálculo** (competência × caixa) vivendo em telas
diferentes sem nada dizer qual é qual.

## O modelo

**Uma unidade de tempo: o ciclo.** Fecha no dia de `workspaces.cycle_close_day` (10 em
produção). **Uma base: o dia em que o dinheiro sai da conta** — compra no cartão entra no ciclo
em que a FATURA VENCE.

Todo ciclo conta a mesma história, passado ou futuro; muda o tempo verbal e o estado
(`fechado` / `em aberto` / `previsto`):

```
‹  OUTUBRO  ›                    [Gerenciar]
11/09 — 10/10 · em aberto

VOU FECHAR EM  −R$ 615,87
veio de −370,92 · entrou 7.566,52 · sai 8.183,11

O QUE ENTRA · O QUE SAI · FATURAS · ONDE O DINHEIRO FOI · ORÇAMENTO
```

**Ciclo fechado termina em DOIS números**, e isso é regra de produto, não formatação:

```
Sobrou na conta      R$ 0,72
Faltou pagar       R$ 371,64
```

⚠️ **Saldo em conta não abate dívida sozinho** — pedido explícito do dono do produto:
*"se eu não paguei nada com esse saldo, o saldo na conta permanece exatamente na conta e o que
faltou pagar continua faltando pagar"*. Um número só quando sobra positivo, porque aí a sobra
de fato entra no ciclo seguinte. Ver `docs/ideias/GUARDAR-DINHEIRO.md`.

## As telas

| hoje | depois |
|---|---|
| **Financeiro** (home de atalhos, 1.238 linhas) | **é a linha do tempo**, abre no ciclo atual |
| **Entradas e saídas** (`finance/month.tsx`) | some |
| **Projeção** (`finance/forecast.tsx`) | some |
| **Hoje** | agenda do dia + `na conta` / `falta pagar` + link para o ciclo |
| Contas, Cartões, Dívidas, Orçamentos, Metas, Recorrentes, Regras | **Gerenciar**, ícone no header |

Preservado: o **"E se…?"**, aplicado ao ciclo aberto e aos seguintes; a **curva diária** como
gráfico do herói; a lista "por dia" como ordem de `O QUE SAI`. Relatório anual e Patrimônio
ficam fora da linha do tempo, como estão.

`Por dia | Por mês` some (virou detalhe). `Mês | Ciclo` fica — e como passa a existir **um lugar
só** onde ele é mexido, nenhuma tela pode discordar de outra. Isso resolve a queixa
*"tem dois filtros?"* sem reverter a decisão de 11/09 (régua por tela).

## Os números — uma regra, um lugar

⚠️ **A regra "fatura no vencimento" já existe em `_cash_flow_forecast` e NÃO pode ser copiada.**
`finance.md` tem três registros de o que acontece quando uma regra financeira ganha segunda
cópia. O caminho é extrair, não duplicar:

- **`private.cash_events(ws_ids, ini, fim)`** — o fluxo de caixa de QUALQUER janela, passada ou
  futura, na base pagamento. Quatro fontes, as mesmas de hoje: fatura não paga no `due_date`,
  transação de caixa em `coalesce(due_at, occurred_at)`, parcela de dívida do cronograma,
  recorrente projetada além do materializado.
- **`_cash_flow_forecast` passa a ler ela** (com o clamp em `current_date` que ela já faz).
- **`_cycle_summary(uid, mes, view)`** — `comecei_com` (= `cash_total` na véspera do início),
  `entrou`, `saiu`, `sobrou_na_conta`, `faltou_pagar`, `estado`.
- **`_cycle_lines(uid, mes, view)`** — as linhas do ciclo na base pagamento, para os recortes.

Par interna/wrapper em todas, conforme `supabase.md`. Leitura que pode passar de 1000 linhas
nasce agregada ou em JSON (`finance.md`).

⚠️ **`budgets_status_for` não muda.** Orçamento é competência por decisão registrada em
`finance.md`; `ORÇAMENTO` na linha do tempo continua chamando a RPC de hoje.

## Fora de escopo (YAGNI)

Guardar dinheiro / caixinha (`docs/ideias/GUARDAR-DINHEIRO.md`), régua "por fatura", mexer em
orçamento, agente, notas, ou no Relatório anual.

## Como se verifica

Números, contra o que já está medido nesta sessão com os dados reais clonados no staging:

| ciclo | janela | fecha em |
|---|---|---|
| Setembro | 11/08 – 10/09 | **−370,92** (sobrou 0,72 · faltou 371,64) |
| Outubro | 11/09 – 10/10 | **−615,87** |
| Novembro | 11/10 – 10/11 | **+105,49** |

Telas: simulador iOS e emulador Android, claro e escuro, contagem anti-slop zerada
(`.claude/rules/design.md` §10 e §11).
