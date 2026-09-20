# Parcelar um lançamento que já existe (e desparcelar) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendada)
> ou `superpowers:executing-plans`. Os passos usam `- [ ]` para acompanhamento.

**Goal:** um lançamento simples vira compra parcelada (e uma compra parcelada volta a ser um
lançamento à vista) sem nunca duplicar nada, e a pílula "previsto" deixa de aparecer em cima de
uma compra que já aconteceu.

**Architecture:** a conversão é uma RPC nova no Postgres que **adota a transação existente como
parcela 1** (o `id` não muda) em vez de criar linha nova — é isso que torna a operação idempotente
e impossível de duplicar. A volta (N→1) entra como `p_installments = 1` na `update_installment_plan`
que já existe, dissolvendo o plano e devolvendo a transação sobrevivente. No app, o "previsto"
deixa de ser `status === 'pending'` e passa por uma função pura em `settle-labels.ts`, que é onde o
projeto já concentra o vocabulário de um lançamento previsto.

**Tech Stack:** Postgres/Supabase (plpgsql, `security invoker`, RLS por workspace), Expo SDK 57 +
expo-router + TypeScript, TanStack Query, `node --test`, testes SQL em `supabase/tests/*.sql`.

**Spec:** este documento. A investigação que o originou está resumida em "Diagnóstico" abaixo; as
regras de domínio que ele obedece estão em `.claude/rules/finance.md`, `.claude/rules/supabase.md`,
`.claude/rules/frontend.md` e `.claude/rules/design.md`.

---

## Diagnóstico (o que foi MEDIDO, não suposto)

### Queixa 1 — "não consigo editar o lançamento criado sem parcelar, colocando a parcela"

Verdadeira e a causa é uma linha:

```
src/app/finance/transaction-form.tsx:259
  const podeParcelar = kind === 'expense' && !!accountId && !editing;
```

`!editing` esconde a fileira de parcelas em modo edição, e o `onSubmit` repete a trava
(`:286  if (!editing && values.installments > 1 && ...)`). Mesmo forçando o valor não chegaria ao
banco: `installments` não existe em `TransactionInput` (`use-finance.ts:2140-2160`) e o caminho de
edição é um `.update(input)` cru (`:2177`).

**Não existe, em lugar nenhum do app, caminho de "simples → parcelado".** O caminho inverso
(parcelado → à vista) também não existe: `OPCOES_PARCELAS` em `installments.tsx:57` começa em 2, e a
RPC recusa `p_installments < 2`. O único jeito de desfazer é apagar a compra inteira.

### Queixa 2 — "quando eu consegui editar, ele duplicou"

O que a pessoa fez foi contornar a queixa 1 **lançando de novo**. As duas linhas do print são dois
planos diferentes, e o repositório já documenta a origem do primeiro
(`use-finance.ts:650-664`): antes de 15/09/2026 `useCreateInstallmentPlan` não mandava `p_merchant`,
então "nuuvem wardog" nasceu como **"Compra parcelada (1/2)"**. A pessoa não achou a compra pelo
nome, lançou outra vez com título, e ficou com as duas.

Conferido nos dois bancos em 20/09/2026: **nenhum dos dois planos existe mais** (ela apagou), e
**nenhum plano tem inconsistência** — nos 10 planos de produção e nos 16 do staging, o número de
parcelas bate com `installments` e a soma bate com `total_cents`, sem órfão. Ou seja: **não há bug
de duplicação no código de edição hoje.** O que há é a ausência do caminho, que produz a duplicação
pelas mãos do usuário. Este plano fecha isso.

### Queixa 3 — "veio com a tag previsto se hoje é 19 de setembro e ali está dia 15 e 14"

Verdadeira, e a régua certa **já está escrita no repositório**, aplicada só numa tela:

```
src/app/finance/invoice/[id].tsx:156-162
  ⚠️ **O corte é a DATA, nunca o `status`** — a régua está escrita em `finance.md`: compra de
  cartão fica `pending` até a fatura ser paga, então filtrar por `cleared` chamaria de
  "previsto" a compra que a pessoa fez semana passada.
```

A lista de Lançamentos faz o contrário: `transactions.tsx:696  const previsto = tx.status === 'pending'`.
Medido em produção, workspace `2dc0cbb7`, no período do print:

| lançamento | data | status | conta | fatura |
|---|---|---|---|---|
| Controle (mãe) (4/4) | 15/09 | pending | credit_card | open |
| DAS | 20/09 | pending | credit_card | open |
| Salário CLT (1ª parte) | 20/09 | **cleared** | checking | — |
| Carro Peças (2/3) | 22/09 | pending | credit_card | open |

O `pending` das três compras de cartão está **certo** (o dinheiro sai quando a fatura vencer); o que
está errado é a palavra em cima delas.

### "Em produção tem lançamento faltando"

**Não tem.** Diff completo por `id`, workspace `2dc0cbb7` (o único com dado), em 20/09/2026:

- produção: **309** transações / 10 planos · staging: **311** / 11.
- A diferença são exatamente as **2 parcelas do plano "Wardogs"** que existem só no staging
  (criado lá em 16/09 durante teste).
- As três linhas de rotativo de 10/09 aparecem nos dois com `id` diferente — cada banco rodou o
  próprio cron, não é dado perdido.
- As ocorrências de "Salário CLT" existem nos dois, com os **mesmos `id`**; o que difere é o
  RÓTULO: a série de R$ 1.148,00 (dia 20) chama-se "1ª parte" em produção e "2ª parte" no staging,
  e vice-versa para a de R$ 1.488,02 (dia 5). É uma renomeação feita depois da cópia, não perda.
- `schema_migrations` bate nos dois: `20260918220000`.
- A tag `v1.3.41` **contém** o commit `e3a2408` (o fix do `p_merchant`), então "Compra parcelada"
  sem nome não se reproduz mais no app publicado.

Nada a corrigir em dado. Isto fica registrado aqui e é o que se responde ao dono do produto.

### Achados extras da auditoria (entram no plano, com teste)

- **A.** `transaction-form.tsx:345` escreve `auto_confirm: adiado ? values.auto_confirm : false`.
  Em cartão e em transferência o campo "vou pagar depois" não existe, então `adiado` é sempre
  `false` e **toda gravação apaga o `auto_confirm`** — inclusive "só corrigi o nome da parcela". É
  o mesmo defeito que o comentário de `:317-323` descreve para o `status`, uma linha acima, e que
  lá já foi consertado.
- **B.** `gravar('one')` numa linha de série vai pelo `.update()` cru, carregando `kind` —
  colunas que `update_transaction_scoped` recusa de propósito. O `Segmented` de tipo continua
  renderizado numa parcela, então dá para virar uma parcela de cartão em receita.
- **C.** (não é bug) o `pending → cleared` pelo formulário não escreve `paid_at`, mas o trigger
  `set_paid_at` (`0046`, `before insert or update of status, paid_at, occurred_at`) preenche
  sozinho. Conferido no staging: o trigger existe e está armado. **Nada a fazer.**
- **D.** `transactions.tsx:779` manda "Editar" de uma PARCELA para o formulário da linha, enquanto
  `[txId].tsx:443-448` manda para o editor da compra. Duas telas, duas respostas para a mesma
  palavra.

---

## Global Constraints

Valem para todas as tarefas. Vêm das regras do projeto e não se negociam por tarefa.

- **Dinheiro é `amount_cents` bigint inteiro.** Nunca float, nunca `parseFloat`, nunca divisão em
  ponto flutuante. Divisão inteira e **o resto vai na ÚLTIMA parcela** — é a régua deste repo
  (`finance.md`), e é o que faz a soma das parcelas fechar com o total.
- **A soma das parcelas É o total.** Toda função que mexe em parcela confere isso no fim e
  levanta se não fechar, desfazendo a transação inteira.
- **Migration nova nasce aplicada no STAGING.** Produção (`kwriuifcwyvdrxtspjiz`) só com pedido
  explícito do Gabriel, com o número dito em voz alta. Os dois estão hoje em `20260918220000`.
  Escrever usa `--project-ref`, nunca `link → push → link`.
- **RPC nova é `security invoker`, `set search_path = public`,
  `revoke execute ... from public, anon` + `grant ... to authenticated, service_role`.** Todo
  `update`/`delete` filtra `workspace_id` além da RLS — o agente Python conecta com papel que
  IGNORA RLS.
- **`create or replace function` apaga toda cláusula que a definição nova não repetir.** Fuso e
  `security definer` vão no CABEÇALHO, nunca por `alter` depois.
- **O trigger `set_invoice` escuta `account_id, occurred_at, due_at, workspace_id`.** Mencionar
  qualquer uma dessas colunas num `update` reclassifica a fatura. Renomear não dispara.
- **Zero hex e zero `fontSize` solto em tela**; cor só por `useTheme()`, texto só por
  `ThemedText type=`, espaçamento só por `Space`/`Radius`. `src/lib/anti-slop.test.ts` quebra o
  build.
- **Texto de UI em pt-BR informal.** Uma intenção, um rótulo.
- **Portão antes de commitar:** `npx tsc --noEmit`, `npx expo lint`, `npm test` — os três limpos.
  Olhe o **código de saída**, não a contagem: `node --test` imprime `pass` e `fail` em linhas
  separadas.
- **Commits: conventional, UMA linha, sem corpo e SEM co-autor.**
- **NÃO criar tags.** Tag dispara build e é decisão do Gabriel.

### Como rodar cada suíte

### Decisões do dono do produto (20/09/2026) — não reabrir sem ele

1. **Converter um lançamento já baixado é PERMITIDO**, com aviso destrutivo na tela, e o custo
   aceito é a irreversibilidade. Detalhe na decisão 3 da Tarefa 1.
2. **Os rótulos de `status` mudam nos DOIS lugares** — filtro da lista e formulário —, e o verbo
   sai de `settle-labels.ts` porque ele depende do lado (receita cai, despesa sai). Tarefa 3
   Step 5.
3. **Execução tarefa a tarefa, com revisão entre elas.**

### ⚠️ O que o harness de tela CONSEGUE e o que ele NÃO consegue (medido em 20/09/2026)

Isto foi verificado rodando de verdade, não deduzido — e muda a estratégia de teste das Tarefas
3, 5 e 6. Quem executar o plano **não deve** tentar "só adicionar um caso" nessas telas.

| | consegue? | prova |
|---|---|---|
| montar `transactions.tsx`, `budgets.tsx`, `debts.tsx`, `forecast.tsx`, `invoice/[id].tsx`, `net-worth.tsx`, `(tabs)/finance/index.tsx` | **sim** — já são montadas hoje | `simple-finance-ui.test.ts:413-569` |
| ver o CONTEÚDO de uma linha de lista | **não** | `visit()` não invoca `renderItem`; os testes de `transactions.tsx` hoje só olham **tipos de nó** (`tipos(ui)`), nunca uma `Row` |
| montar `transaction-form.tsx` | **não** | o `visit()` para no gate (`TransactionFormScreen` devolve `<TransactionForm/>`, cujo `type` é uma FUNÇÃO). Descendo nela à força, `useForm` estoura: `TypeError: Cannot read properties of null (reading 'useRef')` — o `react-hook-form` importa o React REAL por conta própria (não pelo `require` do VM), e o React real exige um renderer. |
| montar `installments.tsx` | não foi testado, mas ela também é react-hook-form/estado local com sheet | mesma classe |

**A saída é a que o próprio repo já usa:** a DECISÃO sai da tela e vira função pura em
`src/lib/finance-form.ts` — que existe exatamente para isso (`installmentHistory`, `debtTerm`,
`simpleDebtValues` já moram lá, com `finance-form.test.ts` do lado). A tela passa a chamar a
função; o `node --test` testa a função; o device (Tarefa 7) prova a renderização. Para a classe
"nenhuma tela pode voltar a decidir isso sozinha", o idioma do repo é o **scanner de texto-fonte**
do `anti-slop.test.ts` (é assim que as regras 19 e 27 já funcionam).

**Não** reescrever o harness para suportar react-hook-form: seria um renderer React caseiro dentro
de um teste, e a primeira coisa que ele faria é divergir do React de verdade.

### Como rodar cada suíte

| suíte | comando | onde |
|---|---|---|
| unit + telas | `npm test` | raiz |
| tipos | `npx tsc --noEmit` | raiz |
| lint | `npx expo lint` | raiz |
| SQL | `agent/.venv/bin/python scripts/sql-test.py supabase/tests/<arquivo>.sql` | raiz (ver Tarefa 0) |
| agente | `agent/.venv/bin/pytest` | `agent/` |

---

## Estrutura de arquivos

**Criar**

| arquivo | responsabilidade |
|---|---|
| `scripts/sql-test.py` | roda um `supabase/tests/*.sql` contra o STAGING dentro de uma transação que SEMPRE volta. Existe porque o Docker local não está de pé e o caminho documentado (`docker exec … psql`) não roda hoje. |
| `supabase/migrations/20260920120000_parcelar_um_lancamento_que_ja_existe.sql` | `private.valor_da_parcela`, `public.convert_transaction_to_installments`, e a `update_installment_plan` aceitando `p_installments = 1`. |
| `supabase/tests/converter_parcelamento.sql` | a matriz de conversão e dissolução, incluindo as recusas. |

**Modificar**

| arquivo | o que muda |
|---|---|
| `src/lib/settle-labels.ts` | ganha `estadoDaLinha()` — a única régua de "previsto / atrasado / nada". |
| `src/lib/settle-labels.test.ts` | casos de `estadoDaLinha`. |
| `src/hooks/use-finance.ts` | ganha `useConvertToInstallments`; `useUpdateInstallmentPlan` passa a aceitar `installments: 1`. |
| `src/app/finance/transaction-form.tsx` | fileira de parcelas em modo edição; submit roteia para a conversão; `auto_confirm` preservado (achado A); `kind` não se edita em série (achado B). |
| `src/app/finance/installments.tsx` | `OPCOES_PARCELAS` ganha `1` ("À vista"), com confirmação destrutiva. |
| `src/app/finance/transactions.tsx` | `estadoDaLinha` no lugar de `status === 'pending'`; "Editar" de parcela abre a compra (achado D); rótulos do filtro de status. |
| `src/app/finance/invoice/[id].tsx` | `estadoDaLinha`. |
| `src/app/finance/[txId].tsx` | `estadoDaLinha` na faixa de estado. |
| `src/lib/finance-form.ts` | ganha as DECISÕES do formulário como funções puras: `podeParcelar`, `planoDeSalvar`, `opcoesDeParcelas`. |
| `src/lib/finance-form.test.ts` | casos dessas três. |
| `src/lib/anti-slop.test.ts` | regra nova: tela de finanças não decide "previsto" a partir do `status`. |
| `src/lib/database.types.ts` | regenerado (`gen types`) depois da migration. |
| `.claude/rules/finance.md` | a seção nova sobre converter/dissolver, no padrão do arquivo. |

---

## Tarefa 0: o runner de teste SQL

**Files:**
- Create: `scripts/sql-test.py`

**Interfaces:**
- Produces: `agent/.venv/bin/python scripts/sql-test.py <caminho .sql>` — sai 0 se passou, 1 se
  falhou, e **nunca** deixa nada gravado.

**Por que existe:** os `supabase/tests/*.sql` são documentados para rodar em
`docker exec -i supabase_db_app-proops psql …`, e o Docker/OrbStack não está de pé nesta máquina.
Cada arquivo já é `begin; … rollback;`; este runner tira o controle de transação de dentro do
arquivo e o põe por fora, com `rollback` num `finally` — um `rollback` esquecido no arquivo deixa
de ser a única garantia. Medido em 20/09/2026: `scoped_transaction_edit`, `reparcelar_a_compra`,
`parcela_paga_no_ciclo`, `regua_e_dia_do_fechamento`, `roll_invoice` e `partial_invoice_payment`
passam por aqui contra o staging, e o total de linhas do banco não muda.

⚠️ **`income_pending.sql` FALHA por aqui, e não é bug de código.** Ele chama
`public._promote_due_transactions()`, que promove o banco INTEIRO, e conta quantas linhas
promoveu. Com dado pré-existente a conta nunca fecha. Teste que chama função global precisa de
banco vazio — fica documentado no cabeçalho do runner e não se "conserta" mexendo no teste.

- [ ] **Step 1: escrever o runner**

```python
#!/usr/bin/env python3
"""Roda um `supabase/tests/*.sql` contra o STAGING dentro de uma transação que SEMPRE volta.

    agent/.venv/bin/python scripts/sql-test.py supabase/tests/roll_invoice.sql

## Por que isto existe

O caminho documentado (`docs/AMBIENTES.md`) é `docker exec -i supabase_db_app-proops psql …`, e
ele depende do Supabase local de pé. Quando não está, os testes SQL simplesmente não rodam — que é
como uma migration de dinheiro vai para o staging sem nenhuma prova.

## Por que é seguro apontar para o staging

O controle de transação sai de DENTRO do arquivo e vem para cá: `begin;`/`commit;`/`rollback;` são
removidos do texto e a conexão abre com `autocommit=False`, com `rollback()` + `close()` num
`finally`. Não existe caminho de saída que grave — nem sucesso, nem exceção, nem `sys.exit`.

⚠️ **`with psycopg.connect(...)` COMMITA na saída limpa, e isso não é teoria.** Medido em
20/09/2026 contra o staging: um `insert` dentro de `with psycopg.connect(u, autocommit=False) as
con:` sem `rollback` **ficou gravado**. É por isso que este runner **não usa a conexão como
context manager** — ele abre, e fecha num `finally` com `rollback()` antes do `close()`. Com o
context manager, bastaria alguém mover o `rollback` para fora do bloco (ou um `return` novo passar
por cima) para o teste passar a gravar no banco em silêncio. A trava não pode depender de onde uma
linha está escrita.

⚠️ **Só staging, e a asserção é no REF.** Nome de projeto não basta: são dois projetos com nome
parecido e a confusão já custou duas migrations anunciadas no lugar errado.

⚠️ **Teste que chama função GLOBAL não roda aqui.** `income_pending.sql` chama
`_promote_due_transactions()`, que promove o banco inteiro e devolve a contagem total; com dado
pré-existente a asserção nunca fecha. Esse precisa de banco vazio (Docker local). Não é defeito do
teste nem do código.

⚠️ **O fuso é fixado em `America/Sao_Paulo`**, como `scoped_transaction_edit.sql` faz na primeira
linha: desde a `20260911030000` as funções de finanças avaliam `current_date` em BRT enquanto a
sessão fica em UTC, e entre 21h e a meia-noite um teste que compara com o `current_date` da SESSÃO
falha por um dia sem nada estar errado.
"""
from __future__ import annotations

import pathlib
import re
import sys

import psycopg

RAIZ = pathlib.Path(__file__).resolve().parent.parent
STAGING_REF = "utkqoiigimqzeenxkxdl"


def url() -> str:
    """O DATABASE_URL do staging — `agent/.env` é o ambiente descartável (ver `agent.md`)."""
    arquivo = RAIZ / "agent/.env"
    for linha in arquivo.read_text().splitlines():
        if linha.startswith("DATABASE_URL="):
            valor = linha.split("=", 1)[1].strip().strip('"')
            if STAGING_REF not in valor:
                raise SystemExit(f"recusado: {arquivo} não aponta para o staging ({STAGING_REF})")
            return valor
    raise SystemExit(f"sem DATABASE_URL em {arquivo}")


def corpo(arquivo: pathlib.Path) -> str:
    """O SQL sem as diretivas do psql e sem o controle de transação do próprio arquivo.

    ⚠️ **Controle de transação fora do padrão é RECUSA, nunca filtro silencioso.** Tirar só a
    linha que casa exatamente `begin;`/`commit;`/`rollback;` deixa passar `COMMIT ;`,
    `commit; -- fecha` e qualquer variação — e um `commit` que passa GRAVA no staging, onde o
    rollback de fora não alcança mais. Conferido em 20/09/2026: nenhum dos 28 arquivos de
    `supabase/tests/` tem `commit;` hoje. É por isso mesmo que a trava entra agora, antes de o
    primeiro aparecer.

    O `begin`/`end` SEM ponto-e-vírgula dos blocos plpgsql não é controle de transação e passa
    intacto — o que se procura é a linha inteira.
    """
    fora = {"begin;", "commit;", "rollback;"}
    limpas: list[str] = []
    for numero, linha in enumerate(arquivo.read_text().splitlines(), 1):
        nua = linha.strip()
        if nua.startswith("\\"):
            continue
        if nua.lower() in fora:
            continue
        if re.match(r"^(begin|commit|rollback|end)\s+transaction\b", nua, re.I) or re.match(
            r"^(commit|rollback)\s*;\s*(--.*)?$", nua, re.I
        ):
            raise SystemExit(
                f"recusado: {arquivo.name}:{numero} controla a transação fora do padrão "
                f"(«{nua}»). Quem abre e desfaz é o runner — ver o cabeçalho."
            )
        limpas.append(linha)
    return "\n".join(limpas)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    arquivo = (RAIZ / sys.argv[1]).resolve()
    if not arquivo.is_file():
        raise SystemExit(f"não achei {arquivo}")

    avisos: list[str] = []
    # ⚠️ SEM `with` na conexão, de propósito — ver o ⚠️ do cabeçalho.
    conexao = psycopg.connect(url(), connect_timeout=20, autocommit=False)
    conexao.add_notice_handler(lambda aviso: avisos.append(aviso.message_primary))
    falhou: str | None = None
    try:
        with conexao.cursor() as cursor:
            cursor.execute("set local timezone to 'America/Sao_Paulo'")
            cursor.execute(corpo(arquivo))
    except Exception as erro:  # noqa: BLE001 — qualquer falha é falha do teste
        falhou = f"{type(erro).__name__}: {erro}"
    finally:
        # Nesta ordem, e em QUALQUER saída: é o que garante que nada ficou gravado.
        conexao.rollback()
        conexao.close()

    print("\n".join(avisos))
    if falhou:
        print(f"FALHOU: {arquivo.name}\n  {falhou}")
        sys.exit(1)
    print(f"PASSOU: {arquivo.name}")


main()
```

- [ ] **Step 2: provar que ele roda e que nada fica gravado**

⚠️ **Contar linhas de `transactions` NÃO basta** — só pega `insert`. O teste novo faz
`update public.card_invoices set status = 'paid'`, e um commit que vazasse por `update` passaria
batido. A impressão digital abaixo cobre as quatro tabelas que esta entrega toca, incluindo o
ESTADO das faturas.

Criar `scripts/_impressao-do-banco.py` (temporário, apagado no fim do passo):

```python
import pathlib, psycopg
u = [l.split('=', 1)[1].strip() for l in pathlib.Path('agent/.env').read_text().splitlines()
     if l.startswith('DATABASE_URL=')][0]
with psycopg.connect(u) as c, c.cursor() as k:
    k.execute('''
      select (select count(*) from public.transactions),
             (select coalesce(sum(amount_cents), 0) from public.transactions),
             (select count(*) from public.installment_plans),
             (select coalesce(sum(total_cents), 0) from public.installment_plans),
             (select count(*) from public.card_invoices),
             (select md5(string_agg(id::text || status || paid_cents::text, ',' order by id))
                from public.card_invoices),
             (select count(*) from public.accounts),
             (select count(*) from public.workspaces)
    ''')
    print(k.fetchone())
```

```bash
cd /Users/gabrielalmeidadias/Documents/Empresas/ProOps/DEV/Personal-ProOps-app
antes=$(agent/.venv/bin/python scripts/_impressao-do-banco.py)
for f in reparcelar_a_compra roll_invoice scoped_transaction_edit partial_invoice_payment \
         parcela_paga_no_ciclo regua_e_dia_do_fechamento; do
  agent/.venv/bin/python scripts/sql-test.py supabase/tests/$f.sql || exit 1
done
depois=$(agent/.venv/bin/python scripts/_impressao-do-banco.py)
[ "$antes" = "$depois" ] && echo "OK: nada gravado" || { echo "GRAVOU:"; echo "$antes"; echo "$depois"; exit 1; }
rm scripts/_impressao-do-banco.py
```

Esperado: seis `PASSOU:` e `OK: nada gravado`.

⚠️ **Por que o `with` da conexão foi embora, com a fonte na mão.** No psycopg 3,
`connection.py:164-172` faz `if exc_type: self.rollback() else: self.commit()` — a saída LIMPA
comita. Com o `rollback()` num `finally` DENTRO do `with`, o `commit` do `__exit__` viraria no-op
(`_connection_base.py:582`: `if transaction_status == IDLE: return`), então nada gravaria. Mas
isso seria verdade por ORDEM DE EXECUÇÃO, não por desenho: mover o `try` para fora do `with`,
trocar o `finally` por um `return` ou envolver tudo em outro bloco passa a comitar no staging sem
um aviso. Sem o `with`, esse caminho não existe.

Medido em 20/09/2026 contra o staging, para não ficar em teoria: um `insert` dentro de
`with psycopg.connect(u, autocommit=False) as con:` **sem** `rollback` ficou GRAVADO.

- [ ] **Step 3: commit**

```bash
git add scripts/sql-test.py
git commit -m "chore(test): rodar teste SQL no staging dentro de transacao que sempre volta"
```

---

## Tarefa 1: a migration — converter e dissolver

**Files:**
- Create: `supabase/migrations/20260920120000_parcelar_um_lancamento_que_ja_existe.sql`
- Test: `supabase/tests/converter_parcelamento.sql`

**Interfaces:**
- Produces:
  - `private.valor_da_parcela(p_total_cents bigint, p_installments int, p_indice int) returns bigint`
  - `public.convert_transaction_to_installments(p_transaction_id uuid, p_total_cents bigint,
    p_installments int, p_first_occurred_at date, p_description text default null,
    p_category text default null, p_merchant text default null, p_account_id uuid default null)
    returns uuid` — devolve o `id` do plano.
  - `public.update_installment_plan(...)` passa a aceitar `p_installments = 1`, dissolvendo o
    plano e devolvendo `1`.

### Já foi PROVADO antes de virar plano (20/09/2026)

O SQL desta tarefa não é hipótese. DDL no Postgres é transacional, então os dois blocos da
migration mais o teste novo foram montados num arquivo só e rodados contra o **schema real do
staging** dentro de uma transação que voltou:

- `converter_parcelamento.sql` passou de primeira, com a migration aplicada na mesma transação —
  inclusive a fixture (`auth.users`, `profiles`, `workspaces`, `workspace_members`, `accounts`,
  `recurring_transactions`), que roda como está escrita, e o `set_invoice` atribuindo fatura
  sozinho.
- As cinco suítes que já existiam e tocam nesse código —
  `reparcelar_a_compra`, `parcela_paga_no_ciclo`, `scoped_transaction_edit`, `roll_invoice`,
  `partial_invoice_payment` — passaram **com a `update_installment_plan` já reescrita**. É a
  prova de não-regressão que o dono do produto pediu, e ela é o motivo de o piso virar 1 no lugar
  de uma função nova.
- `select count(*)` de `transactions` e de `installment_plans` no staging: **397 / 16 antes e
  397 / 16 depois**. Nada foi gravado.
- O cascade foi medido nos dois sentidos (ver o ⚠️ da ordem, no cabeçalho da migration).

Isto **não dispensa** os passos abaixo: o `db push` de verdade ainda tem que acontecer, e o teste
tem que estar no repositório para pegar a próxima mudança. O que isto dispensa é descobrir um erro
de sintaxe ou de fixture depois de escrever a migration.

### Decisões declaradas (não são descuido — são escolha, com motivo)

1. **A transação existente é ADOTADA como parcela 1; o `id` não muda.** É o que impede a
   duplicação de existir: o `last_write_id` do agente, um `pending_actions` esperando confirmação e
   qualquer referência futura continuam apontando para a mesma linha. É a mesma regra que
   `update_installment_plan` já escreveu ("as parcelas em aberto são ATUALIZADAS, não recriadas").
2. **Chamar duas vezes é recusa, não segundo plano.** `installment_plan_id is not null` → erro. É a
   idempotência do caminho: uma retentativa (rede caiu no meio, dedo duplo no botão) nunca cria um
   plano a mais.
3. **Parcela 1 pode estar `cleared` — decisão do dono do produto em 20/09/2026, com o custo
   aceito na mesma frase.** Converter é a correção de uma compra lançada errado ("paguei 300 no
   mercado" que na verdade era 3x); a primeira parcela já ter sido paga é o caso NORMAL, não a
   exceção. Ela mantém o status; 2..N nascem `pending`.

   ⚠️ **O custo é a IRREVERSIBILIDADE, e ela é real.** O plano nasce com `travadas = 1`, então
   `1 <> plano.installments` faz o desparcelar ser RECUSADO — a mesma trava que protege o
   contrato. Quem converter uma linha já paga não desfaz pela tela; o caminho é apagar a compra
   inteira e lançar de novo. **Por isso a tela AVISA antes**, e o aviso é parte da entrega:

   > Este lançamento já foi baixado. Parcelando, a 1ª parcela continua paga e as outras ficam
   > pendentes — e isso **não dá para desfazer** depois.

   Um `confirmDestructive` (`design.md §6`), não um `hint`: a ação é de mão única.
   **A trava que fica é a da FATURA**: se a linha está numa fatura `paid`, `rolled` ou com
   `paid_cents > 0`, a conversão é recusada — mexer ali derruba `invoice_open_cents` e a fatura
   nunca mais fecha (é o terceiro caso de `private.parcela_travada`, o que não aparece em teste
   nenhum).
4. **Não existe `p_paid_installments` na conversão.** O histórico ("3 das 12 já foram pagas") é da
   CRIAÇÃO, onde a pessoa está cadastrando uma compra antiga. Aqui existe um lançamento real com
   um status real, e inventar um segundo jeito de dizer a mesma coisa é como as duas cópias
   divergem. Quem precisa de histórico apaga e cadastra pela criação, que já pergunta isso.
5. **Parcela com data PASSADA nasce `pending`, e isso é escolha.** Converter uma compra de
   junho em 3x hoje cria parcelas em junho, julho e agosto, todas `pending` — e, fora do cartão,
   a Tarefa 2 vai pintá-las de **"atrasado"**. É o certo: ninguém as pagou, e `installmentHistory`
   (`src/lib/finance-form.ts`) já diz com todas as letras que *"data passada não conta como
   pagamento"*. O `auto_confirm` nasce `false`, então o cron não promove nenhuma delas. Quem
   precisa registrar histórico de pagamento usa a CRIAÇÃO, que pergunta "quantas parcelas iniciais
   já foram pagas?" — ver a decisão 4.
6. **Dissolver (N→1) entra na `update_installment_plan`, não numa função nova.** Ela já é o dono
   do contrato da compra, já tem o `for update`, já tem as travas e já é quem a tela de Parceladas
   chama. Uma função nova seria a segunda cópia das travas.
7. **Dissolver só com ZERO parcela travada, e a trava já existia.** O guarda
   `if p_installments <> plano.installments then raise` cobre `1 <> N` sozinho — a mensagem que
   já está lá ("o número de parcelas não muda mais") é a certa.
8. **A ordem do dissolve é: soltar o sobrevivente → apagar os irmãos → apagar o plano.**
   `transactions.installment_plan_id` é `on delete cascade`: apagar o plano primeiro levaria a
   linha sobrevivente junto, em silêncio.
9. **`installment_plans.installments` tem `check between 2 and 72`.** Por isso o ramo do dissolve
   roda ANTES do `update installment_plans`, e termina apagando o plano — nunca gravando `1` nele.

- [ ] **Step 1: escrever o teste SQL (vai falhar — as funções não existem)**

Criar `supabase/tests/converter_parcelamento.sql`:

```sql
-- Converter um lançamento simples em compra parcelada, e desparcelar de volta.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/converter_parcelamento.sql
--
-- ⚠️ **`if`/`raise`, nunca `assert`** — como nos seis testes vizinhos. `assert` do plpgsql
-- obedece a GUC `plpgsql.check_asserts`; com ela desligada o arquivo inteiro fica verde sem
-- conferir uma linha. Um teste que pode ser desligado por configuração não é trava.
--
-- ⚠️ **Toda recusa confere a FRASE, e o `raise` de controle é prefixado com `FALHOU:`.** É o
-- padrão de `reparcelar_a_compra.sql`, e ele existe porque o jeito ingênuo passa por acaso: se a
-- frase de controle ("converter dentro de fatura paga deveria ter sido recusado") contém a
-- palavra que o `like` procura ("fatura"), o teste fica VERDE com a trava ausente.
--
-- ⚠️ `set local timezone` na primeira linha: desde a `20260911030000` as funções de finanças
-- avaliam `current_date` em BRT enquanto a sessão fica em UTC, e entre 21h e a meia-noite um
-- teste que compare com o `current_date` da SESSÃO falha por um dia sem nada estar errado.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  usr uuid;
  ws uuid;
  ws_outro uuid;
  cartao uuid;
  corrente uuid;
  conta_outra uuid;
  tx uuid;
  tx_sobrevivente uuid;
  plano uuid;
  serie uuid;
  divida uuid;
  fat uuid;
  n int;
  soma bigint;
  quantas int;
  txt text;
begin
  -- ── fixture própria: nada depende do que já existe no banco ───────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'converter-' || gen_random_uuid() || '@proops.test', '',
          now(), now(), now())
  returning id into usr;

  insert into public.profiles (id) values (usr) on conflict do nothing;

  insert into public.workspaces (name, owner_id) values ('Converter', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, usr, 'owner') on conflict do nothing;

  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, usr, 'Cartão', 'credit_card', 3, 10) returning id into cartao;
  insert into public.accounts (workspace_id, user_id, name, type)
  values (ws, usr, 'Corrente', 'checking') returning id into corrente;

  -- ══ 1. converter: 1 linha de R$ 300,00 vira 3x de R$ 100,00 ═══════════════
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, category, description, merchant,
     account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'mercado', 'Mercado do mês', 'Zaffari',
          cartao, '2026-06-05', 'app', 'pending')
  returning id into tx;

  plano := public.convert_transaction_to_installments(
    tx, 30000, 3, '2026-06-05', 'Mercado do mês', 'mercado', 'Zaffari', cartao);

  if plano is null then raise exception '1. a conversão não devolveu o plano'; end if;

  -- 1a. a linha ORIGINAL continua existindo, com o MESMO id, como parcela 1. É esta asserção
  --     que torna a duplicação impossível: não há linha nova para a compra virar duas.
  if (select installment_plan_id from public.transactions where id = tx) is distinct from plano then
    raise exception '1a. a transação original não foi adotada pelo plano';
  end if;
  if (select installment_no from public.transactions where id = tx) <> 1 then
    raise exception '1a. a transação original deveria ser a parcela 1';
  end if;
  if (select amount_cents from public.transactions where id = tx) <> 10000 then
    raise exception '1a. parcela 1 deveria valer 10000, veio %',
      (select amount_cents from public.transactions where id = tx);
  end if;
  txt := (select description from public.transactions where id = tx);
  if txt <> 'Mercado do mês (1/3)' then raise exception '1a. parcela 1 com nome errado: %', txt; end if;

  -- 1b. são 3 parcelas e a soma É o total.
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano;
  if n <> 3 then raise exception '1b. deveriam ser 3 parcelas, vieram %', n; end if;
  if soma <> 30000 then raise exception '1b. a soma deveria ser 30000, veio %', soma; end if;

  -- 1c. as datas andam de mês em mês e 2..N nascem pendentes.
  if (select occurred_at from public.transactions
      where installment_plan_id = plano and installment_no = 3) <> '2026-08-05' then
    raise exception '1c. a parcela 3 deveria cair em 05/08';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano and installment_no > 1 and status <> 'pending') <> 0 then
    raise exception '1c. as parcelas 2..N deveriam nascer pendentes';
  end if;

  -- 1d. o plano guarda o contrato, e o trigger resolveu a fatura de cada parcela.
  if (select total_cents from public.installment_plans where id = plano) <> 30000 then
    raise exception '1d. o plano não guardou o total';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano and invoice_id is null) <> 0 then
    raise exception '1d. toda parcela de cartão precisa de fatura';
  end if;

  -- ══ 2. idempotência: converter de novo é RECUSA, nunca segundo plano ══════
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Mercado do mês', 'mercado', 'Zaffari', cartao);
    raise exception 'FALHOU: 2. converter uma parcela tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já é uma compra parcelada' in sqlerrm) = 0 then
      raise exception '2. recusa errada (esperava «já é uma compra parcelada»): %', sqlerrm;
    end if;
  end;

  -- ══ 3. dissolver: 3x volta a ser UM lançamento de R$ 300,00 ══════════════
  quantas := public.update_installment_plan(
    plano, 30000, 1, '2026-06-05', 'Mercado do mês', 'mercado', 'Zaffari', cartao);
  if quantas <> 1 then raise exception '3. dissolver deveria devolver 1, devolveu %', quantas; end if;

  if (select count(*) from public.installment_plans where id = plano) <> 0 then
    raise exception '3a. o plano deveria ter sumido';
  end if;
  if (select count(*) from public.transactions
      where workspace_id = ws and description like 'Mercado%') <> 1 then
    raise exception '3a. deveria ter sobrado UMA linha';
  end if;

  -- 3b. o SOBREVIVENTE é a linha original — mesmo id —, solta, com o total e sem o "(1/3)".
  --     Esta é a asserção que pega o `on delete cascade` na ordem errada.
  if (select count(*) from public.transactions where id = tx) <> 1 then
    raise exception '3b. o cascade levou a linha que deveria sobreviver';
  end if;
  if (select amount_cents from public.transactions where id = tx) <> 30000 then
    raise exception '3b. a linha solta deveria valer 30000, veio %',
      (select amount_cents from public.transactions where id = tx);
  end if;
  txt := (select description from public.transactions where id = tx);
  if txt <> 'Mercado do mês' then raise exception '3b. a linha solta ficou com o sufixo: %', txt; end if;
  if (select installment_plan_id from public.transactions where id = tx) is not null
     or (select installment_no from public.transactions where id = tx) is not null then
    raise exception '3b. a linha solta continua apontando para o plano';
  end if;

  -- ══ 4. parcela 1 já paga: converte, e ela CONTINUA paga ═════════════════
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Pneu', corrente, '2026-06-05', 'app', 'cleared')
  returning id into tx;

  plano := public.convert_transaction_to_installments(
    tx, 30000, 3, '2026-06-05', 'Pneu', null, null, corrente);
  if (select status from public.transactions where id = tx) <> 'cleared' then
    raise exception '4. a parcela 1 já paga não podia virar pendente';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano and status = 'pending') <> 2 then
    raise exception '4. as outras duas deveriam ficar pendentes';
  end if;

  -- 4a. e com parcela paga o número de parcelas trava — inclusive para dissolver.
  begin
    perform public.update_installment_plan(plano, 30000, 1, '2026-06-05', 'Pneu', null, null, corrente);
    raise exception 'FALHOU: 4a. dissolver com parcela paga tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('não muda mais' in sqlerrm) = 0 then
      raise exception '4a. recusa errada (esperava «não muda mais»): %', sqlerrm;
    end if;
  end;

  -- ══ 5. fatura FECHADA recusa a conversão ════════════════════════════════
  -- 5a. fatura `paid`.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Geladeira', cartao, '2026-07-05', 'app', 'pending')
  returning id into tx;
  select invoice_id into fat from public.transactions where id = tx;
  update public.card_invoices set status = 'paid', paid_at = current_date where id = fat;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-07-05', 'Geladeira', null, null, cartao);
    raise exception 'FALHOU: 5a. converter dentro de fatura paga tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já foi paga, adiada ou paga em parte' in sqlerrm) = 0 then
      raise exception '5a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 5b. fatura `rolled`.
  update public.card_invoices set status = 'rolled', paid_at = null where id = fat;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-07-05', 'Geladeira', null, null, cartao);
    raise exception 'FALHOU: 5b. converter dentro de fatura adiada tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já foi paga, adiada ou paga em parte' in sqlerrm) = 0 then
      raise exception '5b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 5c. ⚠️ pagamento PARCIAL: a fatura fica `open` e as linhas `pending`. É o caso que não
  --     aparece em teste nenhum, e o que torna a fatura impossível de fechar se passar.
  update public.card_invoices set status = 'open', paid_cents = 1000 where id = fat;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-07-05', 'Geladeira', null, null, cartao);
    raise exception 'FALHOU: 5c. converter em fatura paga em PARTE tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já foi paga, adiada ou paga em parte' in sqlerrm) = 0 then
      raise exception '5c. recusa errada: %', sqlerrm;
    end if;
  end;
  update public.card_invoices set status = 'open', paid_cents = 0 where id = fat;

  -- ══ 6. as recusas de forma ══════════════════════════════════════════════
  -- 6a. receita não parcela.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
  values (ws, usr, 'income', 30000, 'Salário', corrente, '2026-06-05', 'app')
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Salário', null, null, corrente);
    raise exception 'FALHOU: 6a. receita parcelada tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('Só gasto vira compra parcelada' in sqlerrm) = 0 then
      raise exception '6a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6b. ocorrência de série recorrente: quem manda na divisão é a REGRA.
  insert into public.recurring_transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, rrule, dtstart, next_run_at)
  values (ws, usr, 'expense', 30000, 'Vivo', corrente, 'FREQ=MONTHLY;BYMONTHDAY=5',
          '2026-06-01', '2026-07-05')
  returning id into serie;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at,
     source, recurring_id)
  values (ws, usr, 'expense', 30000, 'Vivo', corrente, '2026-06-05', 'recurring', serie)
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Vivo', null, null, corrente);
    raise exception 'FALHOU: 6b. ocorrência de recorrência tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('série recorrente' in sqlerrm) = 0 then
      raise exception '6b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6c. parcela de FINANCIAMENTO: quem manda é o cronograma da dívida.
  insert into public.debts
    (workspace_id, user_id, name, kind, principal_cents, remaining_cents, interest_rate_monthly)
  values (ws, usr, 'Carro', 'financing', 100000, 100000, 0.0199)
  returning id into divida;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, debt_id)
  values (ws, usr, 'expense', 30000, 'Parcela Carro', corrente, '2026-06-05', 'app', divida)
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Parcela Carro', null, null, corrente);
    raise exception 'FALHOU: 6c. parcela de financiamento tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('financiamento' in sqlerrm) = 0 then
      raise exception '6c. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6d. ⚠️ saldo ADIADO de fatura: é `expense` comum, sem `debt_id` e sem `recurring_id`, então
  --     passa por todas as guardas de cima. Ele já foi contado quando as compras foram feitas —
  --     `rollover_of_invoice_id` é o que o mantém fora da competência, e as parcelas 2..N não
  --     herdariam a coluna: o principal voltaria como gasto NOVO em N−1 meses.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source,
     status, rollover_of_invoice_id)
  values (ws, usr, 'expense', 30000, 'Saldo em rotativo', cartao, '2026-09-05', 'app', 'pending', fat)
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-09-05', 'Saldo em rotativo', null, null, cartao);
    raise exception 'FALHOU: 6d. saldo adiado tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('saldo adiado' in sqlerrm) = 0 then
      raise exception '6d. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6e. sem conta não há fatura para resolver.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, occurred_at, source)
  values (ws, usr, 'expense', 30000, 'Avulso', '2026-06-05', 'app')
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Avulso', null, null, null);
    raise exception 'FALHOU: 6e. conversão sem conta tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('Escolha a conta ou o cartão' in sqlerrm) = 0 then
      raise exception '6e. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6f. conta de OUTRO workspace (IDOR). Para o agente Python, que ignora RLS, esta é a única
  --     barreira.
  insert into public.workspaces (name, owner_id) values ('Outro', usr) returning id into ws_outro;
  insert into public.accounts (workspace_id, user_id, name, type)
  values (ws_outro, usr, 'De outro', 'checking') returning id into conta_outra;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Avulso', null, null, conta_outra);
    raise exception 'FALHOU: 6f. conta de outro workspace tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('conta ativa' in sqlerrm) = 0 then
      raise exception '6f. recusa errada: %', sqlerrm;
    end if;
  end;

  -- ══ 7. os limites de forma ══════════════════════════════════════════════
  -- 7a. 1x não é conversão — 1x já é o que ele é.
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 1, '2026-06-05', 'Avulso', null, null, corrente);
    raise exception 'FALHOU: 7a. converter para 1x tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('pelo menos 2 parcelas' in sqlerrm) = 0 then
      raise exception '7a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 7b. 73 passa do teto.
  begin
    perform public.convert_transaction_to_installments(
      tx, 730000, 73, '2026-06-05', 'Avulso', null, null, corrente);
    raise exception 'FALHOU: 7b. 73 parcelas tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('no máximo 72' in sqlerrm) = 0 then
      raise exception '7b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 7c. o total precisa sobrar um centavo por parcela.
  begin
    perform public.convert_transaction_to_installments(
      tx, 2, 3, '2026-06-05', 'Avulso', null, null, corrente);
    raise exception 'FALHOU: 7c. total menor que o número de parcelas tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('centavo' in sqlerrm) = 0 then
      raise exception '7c. recusa errada: %', sqlerrm;
    end if;
  end;

  -- ══ 8. a aritmética: divisão INTEIRA com o resto na ÚLTIMA ══════════════
  -- 8a. 100,00 em 3x = 33,33 / 33,33 / 33,34. Divisão exata (300/3) nunca exercita o resto.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 10000, 'Resto', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(
    tx, 10000, 3, '2026-12-05', 'Resto', null, null, cartao);
  if (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 1) <> 3333
     or (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 2) <> 3333
     or (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 3) <> 3334 then
    raise exception '8a. o resto não foi para a última parcela: %/%/%',
      (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 1),
      (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 2),
      (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 3);
  end if;

  -- 8b. total MÍNIMO: 3 centavos em 3x. Nenhuma parcela pode nascer zero — `amount_cents > 0` é
  --     CHECK de tabela, e um insert que o viole derruba a transação inteira.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 3, 'Mínimo', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(tx, 3, 3, '2026-12-05', 'Mínimo', null, null, cartao);
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano;
  if n <> 3 or soma <> 3 then raise exception '8b. total mínimo: % parcelas somando %', n, soma; end if;

  -- 8c. o TETO (72x), e dissolver de volta.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 100000, 'Teto', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(tx, 100000, 72, '2026-12-05', 'Teto', null, null, cartao);
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano;
  if n <> 72 or soma <> 100000 then raise exception '8c. 72x: % parcelas somando %', n, soma; end if;
  if (select amount_cents from public.transactions
      where installment_plan_id = plano and installment_no = 72) <> 1452 then
    raise exception '8c. o resto da divisão não foi para a última parcela';
  end if;
  quantas := public.update_installment_plan(plano, 100000, 1, '2026-12-05', 'Teto', null, null, cartao);
  if quantas <> 1 or (select amount_cents from public.transactions where id = tx) <> 100000 then
    raise exception '8c. dissolver o 72x não devolveu o total para o sobrevivente';
  end if;
  if (select count(*) from public.transactions where installment_plan_id = plano) <> 0 then
    raise exception '8c. sobraram parcelas depois de dissolver';
  end if;

  -- ══ 9. o pós-check do destino: a data não pode jogar parcela em fatura fechada ══
  --     `travadas = 0` fala do estado de ANTES. Recuar a primeira parcela para dentro de uma
  --     fatura já paga faz a linha sumir de toda leitura de caixa (todas filtram
  --     `status not in ('paid','rolled')`), sem erro nenhum.
  update public.card_invoices set status = 'paid', paid_at = current_date where id = fat;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Recuar', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3,
      (select closing_date - 1 from public.card_invoices where id = fat),
      'Recuar', null, null, cartao);
    raise exception 'FALHOU: 9. data caindo em fatura fechada tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('fatura já fechada' in sqlerrm) = 0 then
      raise exception '9. recusa errada: %', sqlerrm;
    end if;
  end;
  update public.card_invoices set status = 'open', paid_at = null where id = fat;

  raise notice 'OK: converter e dissolver — 9 grupos de asserção';
end $$;

rollback;
```

⚠️ O `declare` do bloco precisa de `ws_outro uuid;` e `conta_outra uuid;` além das variáveis já
listadas.

- [ ] **Step 2: rodar e ver falhar**

```bash
agent/.venv/bin/python scripts/sql-test.py supabase/tests/converter_parcelamento.sql
```

Esperado: `FALHOU:` com `UndefinedFunction: function public.convert_transaction_to_installments(...) does not exist`.

- [ ] **Step 3: escrever a migration**

Criar `supabase/migrations/20260920120000_parcelar_um_lancamento_que_ja_existe.sql`:

```sql
-- Parcelar um lançamento que já existe — e desparcelar de volta.
--
-- A queixa foi literal (19/09/2026): *"não consigo editar o lançamento criado sem parcelar,
-- colocando a parcela"*, e logo em seguida *"quando eu consegui editar, ele duplicou"*. As duas
-- frases são a mesma coisa: **o caminho não existia**, e o jeito de contornar era lançar outra
-- vez — o que deixa as duas compras na fatura. O print mostrava "Wardogs Nuuvem (1/2)" e
-- "Compra parcelada (1/2)", 52,49 cada, em dias diferentes.
--
-- ⚠️ **A transação existente é ADOTADA como parcela 1. O `id` não muda.** É isto que torna a
-- duplicação impossível por construção, e é a mesma regra que a `20260915210000` escreveu para o
-- reparcelamento: apagar e inserir trocaria os `id`s, e o `last_write_id` do agente, um
-- `pending_actions` esperando confirmação e qualquer referência futura apontariam para linha
-- morta.
--
-- ⚠️ **Converter DUAS VEZES é recusa, não segundo plano.** A linha já parcelada é rejeitada pelo
-- `installment_plan_id is not null`. Uma retentativa — rede que caiu depois do commit, dedo duplo
-- no botão — nunca cria um plano a mais. Num caminho de dinheiro, a idempotência não é conforto:
-- é a diferença entre remandar e gravar duas compras que ninguém fez.
--
-- ⚠️ **Parcela 1 já paga é o caso NORMAL, e por isso ela é liberada.** Converter é a correção de
-- uma compra lançada errado ("300 no mercado" que era 3x), e a primeira parcela normalmente já
-- aconteceu. Ela mantém o status; 2..N nascem `pending`. O que NÃO se libera é a FATURA fechada:
-- `paid`, `rolled` ou `paid_cents > 0` recusam, porque baixar o valor de uma compra ali derruba
-- `private.invoice_open_cents` (`sum(linhas) − paid_cents`) para negativo e `pay_invoice` passa a
-- recusar a quitação com `aberto <= 0` — a fatura fica impossível de fechar, sem uma linha de erro
-- em lugar nenhum. É o terceiro caso de `private.parcela_travada`, o que não aparece em teste
-- nenhum.
--
-- ⚠️ **Desparcelar entra na `update_installment_plan` como `p_installments = 1`**, não numa função
-- nova: ela já é a dona do contrato da compra, já tem o `for update` e já tem as travas. Uma
-- segunda função seria a segunda cópia delas. E o guarda que já existia
-- (`p_installments <> plano.installments`) cobre sozinho o caso perigoso: com qualquer parcela
-- paga, `1 <> N` recusa com a mensagem certa.
--
-- ⚠️ **A ORDEM do dissolve é o que impede apagar o dado.** `transactions.installment_plan_id` é
-- `on delete cascade`: apagar o plano primeiro levaria a linha sobrevivente junto, em silêncio.
-- Solta o sobrevivente → apaga os irmãos → apaga o plano.
--
-- MEDIDO no staging em 20/09/2026, com um plano de 3 parcelas criado pela RPC de criação e o
-- `id` da parcela 1 guardado antes: com a ordem certa o sobrevivente CONTINUA existindo
-- (`count = 1`); apagando o plano primeiro, o mesmo `id` devolve `count = 0`. Não é risco
-- teórico — é o dado do usuário indo embora sem erro nenhum.
--
-- ⚠️ **`installment_plans.installments` tem `check between 2 and 72`**, então o ramo do dissolve
-- roda ANTES do `update installment_plans` e termina apagando o plano — nunca gravando `1` nele.
--
-- ⚠️ **`create or replace` preserva dono e permissões e APAGA o resto.** A
-- `update_installment_plan` é reescrita inteira aqui, com `security invoker` e
-- `set search_path = public` no CABEÇALHO. Ela nunca teve `set timezone` (não usa `current_date`),
-- e continua sem.

-- --------------------------------------------------------------------------
-- o valor de UMA parcela — uma régua, três chamadores
-- --------------------------------------------------------------------------
-- A conta estava escrita à mão em `create_installment_plan_with_history` e em
-- `update_installment_plan`; com a conversão seriam TRÊS cópias da mesma expressão, e o modo de
-- falha dela é mudo: um total que deixa de ser a soma do que está embaixo dele.
create or replace function private.valor_da_parcela(
  p_total_cents bigint, p_installments int, p_indice int
)
returns bigint
language sql
immutable
set search_path = public
as $$
  -- Divisão INTEIRA (nunca float) e o resto na ÚLTIMA parcela: é o que faz a soma fechar.
  select case
    when p_indice = p_installments
      then p_total_cents - (p_total_cents / p_installments) * (p_installments - 1)
    else p_total_cents / p_installments
  end;
$$;

revoke execute on function private.valor_da_parcela(bigint, int, int) from public, anon;
grant execute on function private.valor_da_parcela(bigint, int, int) to authenticated, service_role;

comment on function private.valor_da_parcela(bigint, int, int) is
  'O valor da i-ésima parcela: divisão inteira, com o resto na última. Régua única da criação, da edição e da conversão.';

-- --------------------------------------------------------------------------
-- converter: o lançamento que existe vira a parcela 1 de uma compra parcelada
-- --------------------------------------------------------------------------
create or replace function public.convert_transaction_to_installments(
  p_transaction_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_first_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null,
  p_account_id uuid default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  tx record;
  acc record;
  plano uuid;
  nome text;
  i int;
  soma bigint;
begin
  -- `security invoker`: a RLS de `transactions` já responde "não é seu" como "não existe".
  --
  -- ⚠️ `for update` porque o estado da linha é MEDIDO num statement e usado em outro: em READ
  -- COMMITTED cada statement pega snapshot novo, e um `pay_invoice` que commita no meio mudaria o
  -- que se está convertendo. Mesmo cinto de `update_installment_plan`.
  select t.* into tx from public.transactions t where t.id = p_transaction_id for update;
  if tx.id is null then
    raise exception 'Não achei esse lançamento.';
  end if;

  -- A idempotência do caminho. Ver o ⚠️ do cabeçalho.
  if tx.installment_plan_id is not null then
    raise exception 'Esse lançamento já é uma compra parcelada. Edite a compra inteira em Parceladas.';
  end if;
  if tx.kind <> 'expense' then
    raise exception 'Só gasto vira compra parcelada.';
  end if;
  if tx.recurring_id is not null then
    raise exception 'Esse lançamento é uma ocorrência de uma série recorrente: edite a série, não a ocorrência.';
  end if;
  if tx.debt_id is not null then
    raise exception 'Esse lançamento é a parcela de um financiamento: o cronograma dele manda na divisão.';
  end if;
  -- ⚠️ **O saldo adiado de uma fatura NÃO é compra nova.** Ele é `expense` comum, sem `debt_id`
  -- e sem `recurring_id`, então passaria por todas as guardas acima — e a coluna que o mantém
  -- fora da competência (`rollover_of_invoice_id`, lida por 11 leituras desde a `20260911040000`)
  -- NÃO seria copiada para as parcelas 2..N. O principal, já contado quando as compras foram
  -- feitas, voltaria como despesa NOVA em N−1 meses, comendo orçamento, sem erro nenhum.
  if tx.rollover_of_invoice_id is not null then
    raise exception 'Esse lançamento é o saldo adiado de uma fatura: ele não é uma compra nova para parcelar.';
  end if;

  if p_installments is null or p_installments < 2 or p_installments > 72 then
    raise exception 'Escolha pelo menos 2 parcelas (e no máximo 72).';
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'O total precisa sobrar pelo menos um centavo para cada parcela.';
  end if;
  if p_first_occurred_at is null then
    raise exception 'Informe a data da primeira parcela';
  end if;

  -- ⚠️ Conta é obrigatória aqui, ao contrário da edição do plano. A compra parcelada existe para
  -- cair numa fatura; sem conta, o `set_invoice` deixa as N linhas soltas e a divisão não tem onde
  -- acontecer. Na criação isso é impossível (a busca não acha conta nula); aqui é explícito.
  if p_account_id is null then
    raise exception 'Escolha a conta ou o cartão desta compra.';
  end if;
  select a.id, a.workspace_id into acc
  from public.accounts a where a.id = p_account_id and not a.archived;
  if acc.id is null or acc.workspace_id <> tx.workspace_id then
    raise exception 'Escolha uma conta ativa.';
  end if;

  -- A trava da FATURA, e só ela: o status `cleared` da linha original é liberado de propósito.
  -- `'pending'` no primeiro argumento isola o lado da fatura da régua.
  if private.parcela_travada('pending', tx.invoice_id) then
    raise exception 'A fatura desse lançamento já foi paga, adiada ou paga em parte: ele não pode ser parcelado agora.';
  end if;

  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (tx.workspace_id, coalesce((select auth.uid()), tx.user_id), p_account_id,
          p_description, p_merchant, p_category, p_total_cents, p_installments,
          p_first_occurred_at)
  returning id into plano;

  -- A ADOÇÃO. `occurred_at` e `account_id` estão no `set`, então o `set_invoice` roda e
  -- reclassifica a fatura desta linha — que é o efeito desejado: a data da primeira parcela pode
  -- ter mudado no mesmo formulário.
  update public.transactions t set
    installment_plan_id = plano,
    installment_no      = 1,
    amount_cents        = private.valor_da_parcela(p_total_cents, p_installments, 1),
    occurred_at         = p_first_occurred_at,
    description         = nome || ' (1/' || p_installments || ')',
    merchant            = p_merchant,
    category            = p_category,
    account_id          = p_account_id,
    -- ⚠️ O `due_at` do lançamento antigo não vale mais. Em cartão o trigger o reescreve com o
    -- vencimento da fatura; FORA do cartão, um vencimento preenchido à mão ficaria velho enquanto
    -- as parcelas 2..N nascem nulas — e a projeção, que lê `coalesce(due_at, occurred_at)`,
    -- jogaria a parcela 1 num mês e as outras noutro.
    due_at              = null
  where t.id = p_transaction_id and t.workspace_id = tx.workspace_id;

  -- 2..N nascem pendentes, como na criação.
  for i in 2..p_installments loop
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, installment_plan_id, installment_no)
    values (tx.workspace_id, coalesce((select auth.uid()), tx.user_id), 'expense',
            private.valor_da_parcela(p_total_cents, p_installments, i),
            p_category, nome || ' (' || i || '/' || p_installments || ')',
            p_merchant, p_account_id,
            private.add_months(p_first_occurred_at, i - 1),
            'app', 'pending', plano, i);
  end loop;

  /*
   * ⚠️ **O estado de ANTES não fala do destino.** Mudar a data da primeira parcela (ou a conta)
   * pode pendurar uma parcela `pending` numa fatura já paga, adiada ou parcialmente paga — e ali
   * ela some de toda leitura de caixa, porque todas filtram `status not in ('paid','rolled')`. É
   * a mesma checagem que a `20260915210000` faz depois de reescrever.
   *
   * A parcela 1 entra com `'pending'` forçado no primeiro argumento: o status `cleared` dela já
   * foi liberado lá em cima, e o que se confere aqui é só onde ela CAIU.
   */
  if exists (
    select 1 from public.transactions t
    where t.installment_plan_id = plano
      and t.workspace_id = tx.workspace_id
      and private.parcela_travada(
            case when t.installment_no = 1 then 'pending' else t.status end, t.invoice_id)
  ) then
    raise exception 'Essa data (ou essa conta) joga uma parcela dentro de uma fatura já fechada. Escolha outra.';
  end if;

  -- A invariante do modelo: a soma das parcelas É o total. Falhar aqui desfaz tudo.
  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t
  where t.installment_plan_id = plano and t.workspace_id = tx.workspace_id;
  if soma <> p_total_cents then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, p_total_cents;
  end if;

  return plano;
end;
$$;

revoke execute on function
  public.convert_transaction_to_installments(uuid,bigint,int,date,text,text,text,uuid)
  from public, anon;
grant execute on function
  public.convert_transaction_to_installments(uuid,bigint,int,date,text,text,text,uuid)
  to authenticated, service_role;

comment on function
  public.convert_transaction_to_installments(uuid,bigint,int,date,text,text,text,uuid) is
  'Transforma um lançamento simples em compra parcelada ADOTANDO a linha existente como parcela 1 (o id não muda). Recusa linha que já é parcela, receita, ocorrência de recorrência, parcela de financiamento, e linha em fatura paga/adiada/paga em parte. Chamar duas vezes é recusa, nunca um segundo plano.';
```

E, no MESMO arquivo, a `update_installment_plan` reescrita — **igual à `20260915210000` em tudo,
com o ramo do dissolve acrescentado logo depois das validações de entrada**:

```sql
-- --------------------------------------------------------------------------
-- editar a compra inteira — agora aceitando 1x, que DISSOLVE o plano
-- --------------------------------------------------------------------------
create or replace function public.update_installment_plan(
  p_plan_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_first_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null,
  p_account_id uuid default null
)
returns int
language plpgsql security invoker
set search_path = public
as $$
declare
  plano record;
  acc record;
  travadas int;
  travado_cents bigint;
  editaveis int;
  restante bigint;
  nome text;
  i int;
  ordem int;
  soma bigint;
  parcela record;
  sobrevivente uuid;
begin
  select p.* into plano from public.installment_plans p where p.id = p_plan_id for update;
  if plano.id is null then
    raise exception 'Não achei essa compra parcelada.';
  end if;

  /*
   * ⚠️ **O lock que importa é nas PARCELAS, não no plano — e a versão anterior travava a linha
   * errada.** O comentário da `20260915210000` dizia que o `for update` no plano protegia contra
   * "um `pay_invoice` que commita no meio". Ele NÃO protege: `pay_invoice` escreve em
   * `card_invoices` e em `transactions` e **nunca toca em `installment_plans`** (conferido na
   * `20260911070000`), então o lock não serializa nada.
   *
   * A janela real: mede `travadas = 0` → um `pay_invoice` concorrente commita na fatura de uma
   * parcela irmã (soma `paid_cents`, marca as linhas) → o `update`/`delete` daqui mexe numa linha
   * de fatura já paga → `private.invoice_open_cents` (`sum(linhas) − paid_cents`) fica NEGATIVO e
   * `pay_invoice` passa a recusar a quitação com `aberto <= 0`. A fatura fica impossível de
   * fechar, sem uma linha de erro em lugar nenhum — é o terceiro caso de `parcela_travada`,
   * justamente o que o cabeçalho da `20260915210000` chama de "o que não aparece em teste nenhum".
   *
   * Travando as LINHAS antes de medir, o `pay_invoice` concorrente espera. `for update` não vale
   * em consulta com agregado, então é um `perform` à parte.
   */
  perform 1 from public.transactions t
   where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
   for update;

  -- ⚠️ O piso virou 1: `1` é "à vista", e ele DISSOLVE o plano (ramo mais abaixo).
  if p_installments is null or p_installments < 1 or p_installments > 72 then
    raise exception 'O número de parcelas precisa ficar entre 1 e 72.';
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_first_occurred_at is null then
    raise exception 'Informe a data da primeira parcela';
  end if;

  select count(*) filter (where x.travada),
         coalesce(sum(x.amount_cents) filter (where x.travada), 0),
         count(*) filter (where not x.travada)
    into travadas, travado_cents, editaveis
  from (
    select t.amount_cents, private.parcela_travada(t.status, t.invoice_id) as travada
    from public.transactions t
    where t.installment_plan_id = p_plan_id
  ) x;

  -- Regra 2 do cabeçalho da 20260915210000: com parcela paga, só o dinheiro em aberto se
  -- redistribui. Como `1 <> plano.installments` sempre, este mesmo guarda RECUSA o dissolve
  -- quando há parcela paga — que é exatamente o que se quer, com a mensagem que já existia.
  if travadas > 0 then
    if p_installments <> plano.installments then
      raise exception
        'Esta compra já tem % parcela(s) paga(s): o número de parcelas não muda mais. Dá para corrigir o total, o nome e a categoria.',
        travadas;
    end if;
    if p_first_occurred_at <> plano.first_occurred_at then
      raise exception 'Esta compra já tem parcela paga: a data da primeira parcela não muda mais.';
    end if;
    if p_account_id is distinct from plano.account_id then
      raise exception 'Esta compra já tem parcela paga: a conta não muda mais.';
    end if;
    if editaveis = 0 then
      if p_total_cents <> travado_cents then
        raise exception 'Todas as parcelas já foram pagas: o total não muda mais.';
      end if;
    elsif p_total_cents - travado_cents < editaveis then
      raise exception
        'O total precisa cobrir as % parcela(s) já paga(s) e sobrar pelo menos um centavo para cada parcela em aberto',
        travadas;
    end if;
  end if;

  -- ⚠️ **Omitir a conta não pode ZERAR a conta.** Os parâmetros têm `default null` para o
  -- chamador não precisar mandar categoria nem estabelecimento; a conta é outra coisa — sem ela
  -- `set_invoice` apaga o `invoice_id` das N parcelas e a compra de cartão vira despesa solta,
  -- em silêncio.
  if p_account_id is null and plano.account_id is not null then
    raise exception 'Informe a conta desta compra.';
  end if;
  if p_account_id is not null then
    select a.id, a.workspace_id into acc
    from public.accounts a where a.id = p_account_id and not a.archived;
    if acc.id is null or acc.workspace_id <> plano.workspace_id then
      raise exception 'Escolha uma conta ativa.';
    end if;
  end if;

  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  /*
   * ── 1x: a compra deixa de ser parcelada ───────────────────────────────────
   *
   * Só chega aqui com `travadas = 0` (o guarda acima recusa `1 <> N` com parcela paga).
   *
   * ⚠️ **A ORDEM é o que impede apagar o dado.** `transactions.installment_plan_id` é
   * `on delete cascade`: apagar o plano primeiro levaria o sobrevivente junto, em silêncio.
   * Solta o sobrevivente → apaga os irmãos → apaga o plano.
   *
   * ⚠️ **O sobrevivente é a parcela 1**, não uma linha nova: mesmo motivo de sempre — o `id` é
   * referência viva para o agente e para o HITL.
   *
   * ⚠️ **`installment_plans.installments` tem `check between 2 and 72`**, então este ramo roda
   * ANTES do `update` do plano. Nada grava `1` ali.
   *
   * ⚠️ **O sufixo "(1/N)" tem que SAIR.** Ele é derivado; deixar "Mercado (1/3)" num lançamento
   * que não é mais parcelado é mentira na linha da fatura.
   */
  if p_installments = 1 then
    select t.id into sobrevivente
    from public.transactions t
    where t.installment_plan_id = p_plan_id
      and t.workspace_id = plano.workspace_id
    order by t.installment_no
    limit 1;
    if sobrevivente is null then
      raise exception 'Essa compra não tem parcela nenhuma para virar lançamento.';
    end if;

    update public.transactions t set
      installment_plan_id = null,
      installment_no      = null,
      amount_cents        = p_total_cents,
      occurred_at         = p_first_occurred_at,
      description         = nome,
      merchant            = p_merchant,
      category            = p_category,
      account_id          = p_account_id
    where t.id = sobrevivente and t.workspace_id = plano.workspace_id;

    -- ⚠️ `t.id <> sobrevivente` é cinto: sem ele, a ORDEM destas três linhas é a única coisa
    -- entre o dado do usuário e o `on delete cascade`. Custa nada e tira o peso da ordem.
    delete from public.transactions t
     where t.installment_plan_id = p_plan_id
       and t.workspace_id = plano.workspace_id
       and t.id <> sobrevivente;

    delete from public.installment_plans p
     where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

    -- Mesma checagem de destino do outro ramo: a data nova não pode jogar a linha numa fatura
    -- já fechada.
    if (select private.parcela_travada('pending', t.invoice_id)
        from public.transactions t where t.id = sobrevivente) then
      raise exception 'Essa data (ou essa conta) joga o lançamento dentro de uma fatura já fechada. Escolha outra.';
    end if;

    return 1;
  end if;

  update public.installment_plans p set
    description       = p_description,
    merchant          = p_merchant,
    category          = p_category,
    account_id        = p_account_id,
    total_cents       = p_total_cents,
    installments      = p_installments,
    first_occurred_at = p_first_occurred_at,
    updated_at        = now()
  where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

  if travadas = 0 then
    delete from public.transactions t
     where t.installment_plan_id = p_plan_id
       and t.workspace_id = plano.workspace_id
       and (t.installment_no is null or t.installment_no > p_installments);

    for i in 1..p_installments loop
      update public.transactions t set
        amount_cents = private.valor_da_parcela(p_total_cents, p_installments, i),
        occurred_at  = private.add_months(p_first_occurred_at, i - 1),
        description  = nome || ' (' || i || '/' || p_installments || ')',
        merchant     = p_merchant,
        category     = p_category,
        account_id   = p_account_id
      where t.installment_plan_id = p_plan_id
        and t.workspace_id = plano.workspace_id
        and t.installment_no = i;

      if not found then
        insert into public.transactions
          (workspace_id, user_id, kind, amount_cents, category, description, merchant,
           account_id, occurred_at, source, status, installment_plan_id, installment_no)
        values (plano.workspace_id, coalesce((select auth.uid()), plano.user_id), 'expense',
                private.valor_da_parcela(p_total_cents, p_installments, i),
                p_category, nome || ' (' || i || '/' || p_installments || ')',
                p_merchant, p_account_id,
                private.add_months(p_first_occurred_at, i - 1),
                'app', 'pending', p_plan_id, i);
      end if;
    end loop;

    if exists (
      select 1 from public.transactions t
      where t.installment_plan_id = p_plan_id
        and t.workspace_id = plano.workspace_id
        and private.parcela_travada(t.status, t.invoice_id)
    ) then
      raise exception 'Essa data (ou essa conta) joga uma parcela dentro de uma fatura já fechada. Escolha outra.';
    end if;
  else
    update public.transactions t set
      description = nome || ' (' || t.installment_no || '/' || p_installments || ')',
      merchant    = p_merchant,
      category    = p_category
    where t.installment_plan_id = p_plan_id
      and t.workspace_id = plano.workspace_id
      and t.installment_no is not null;

    if editaveis > 0 then
      restante := p_total_cents - travado_cents;
      ordem := 0;
      for parcela in
        select t.id from public.transactions t
        where t.installment_plan_id = p_plan_id
          and t.workspace_id = plano.workspace_id
          and not private.parcela_travada(t.status, t.invoice_id)
        order by t.installment_no
      loop
        ordem := ordem + 1;
        update public.transactions t
           set amount_cents = private.valor_da_parcela(restante, editaveis, ordem)
         where t.id = parcela.id and t.workspace_id = plano.workspace_id;
      end loop;
    end if;
  end if;

  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id;
  if soma <> p_total_cents then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, p_total_cents;
  end if;

  return p_installments;
end;
$$;

revoke execute on function public.update_installment_plan(uuid,bigint,int,date,text,text,text,uuid)
  from public, anon;
grant execute on function public.update_installment_plan(uuid,bigint,int,date,text,text,text,uuid)
  to authenticated, service_role;

comment on function public.update_installment_plan(uuid,bigint,int,date,text,text,text,uuid) is
  'Edita a compra parcelada inteira: total, número de parcelas, nome, estabelecimento, categoria, conta e data da primeira. `p_installments = 1` DISSOLVE o plano e devolve um lançamento à vista (a parcela 1 sobrevive, com o mesmo id). Parcela já paga (ou em fatura paga, adiada ou parcialmente paga) nunca muda de valor, data ou conta; com qualquer parcela paga, o número de parcelas, a data e a conta ficam travados e só o saldo em aberto se redistribui. Grava o plano INTEIRO — quem chama manda todos os campos.';
```

⚠️ **O corpo acima é CANÔNICO — escreva-o, não "copie o antigo e aplique uma lista".** A
primeira versão deste plano mandava copiar de
`supabase/migrations/20260915210000_reparcelar_a_compra.sql:83-314` e aplicar "só cinco
mudanças"; com a correção do lock e o cinto do `delete` já são sete, e quem seguisse a lista
produziria a função **sem o `perform … for update`** — ou seja, sem a correção do bug de
concorrência que esta migration existe em parte para fechar.

As diferenças contra a `20260915210000`, para quem revisar lado a lado:

1. `p_installments < 2` → `< 1`, e a mensagem vira "entre 1 e 72".
2. **`perform 1 from public.transactions … for update` ANTES de medir `travadas`** — o lock que
   o antigo colocava na tabela errada. Ver o ⚠️ no corpo.
3. `nome := coalesce(...)` sobe para antes do ramo novo.
4. o bloco `if p_installments = 1 then … return 1; end if;`.
5. `and t.id <> sobrevivente` no `delete` dos irmãos.
6. as três expressões `case when ... then p_total_cents - base * (...) else base end` viram
   `private.valor_da_parcela(...)`, e `base` sai do `declare`.
7. `sobrevivente uuid` entra no `declare`.

⚠️ **E os comentários de invariante da `20260915210000` vão JUNTO** — eles são o que a próxima
pessoa lê. Os três que não podem sumir do corpo, com o texto original:

- antes do `update public.installment_plans`:
  `-- `workspace_id` em todo update/delete daqui para baixo: para o APP a RLS já resolve, mas o`
  `-- agente Python conecta com papel que a IGNORA — ali a única barreira seria o `ensure_owned``
  `-- do outro lado. É o mesmo cinto de `update_transaction_scoped`.`
- antes do pós-check do ramo `travadas = 0`: o bloco **"⚠️ `travadas = 0` fala do estado de
  ANTES, não do destino"**, inteiro.
- antes do `update` de nome/categoria do ramo `travadas > 0`: o bloco que declara que **a
  categoria propaga para parcela PAGA** e por quê (o relatório da compra partido em dois é pior
  que o orçamento de um mês fechado se remanejar para a verdade).

- [ ] **Step 4: aplicar no STAGING e rodar o teste**

```bash
cd /Users/gabrielalmeidadias/Documents/Empresas/ProOps/DEV/Personal-ProOps-app
scripts/supabase-target.sh                       # confirma o alvo ANTES
npx supabase db push --project-ref utkqoiigimqzeenxkxdl
agent/.venv/bin/python scripts/sql-test.py supabase/tests/converter_parcelamento.sql
```

Esperado: `PASSOU: converter_parcelamento.sql`.

- [ ] **Step 5: provar que nada regrediu no que já existia**

```bash
for f in reparcelar_a_compra roll_invoice scoped_transaction_edit partial_invoice_payment \
         parcela_paga_no_ciclo regua_e_dia_do_fechamento draft_scenario month_forecast \
         recurring_drop_future linha_do_tempo; do
  agent/.venv/bin/python scripts/sql-test.py supabase/tests/$f.sql || echo "!! $f"
done
```

Esperado: dez `PASSOU:`. **`reparcelar_a_compra.sql` é o que prende a não-regressão da
`update_installment_plan`** — ele tem que continuar verde depois da reescrita.

- [ ] **Step 6: regenerar os types**

```bash
npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/lib/database.types.ts
npx tsc --noEmit
```

Esperado: `tsc` limpo, e `git diff src/lib/database.types.ts` mostrando
`convert_transaction_to_installments` acrescentada.

- [ ] **Step 7: commit**

```bash
git add supabase/migrations/20260920120000_parcelar_um_lancamento_que_ja_existe.sql \
        supabase/tests/converter_parcelamento.sql src/lib/database.types.ts
git commit -m "feat(finance): lancamento que ja existe vira compra parcelada, e volta"
```

---

## Tarefa 2: `estadoDaLinha` — "previsto" deixa de ser o `status`

**Files:**
- Modify: `src/lib/settle-labels.ts`
- Test: `src/lib/settle-labels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EstadoDaLinha = 'previsto' | 'atrasado' | 'não caiu' | null;
  export function estadoDaLinha(
    tx: {
      kind: string;
      status: string;
      occurred_at: string;
      due_at: string | null;
      invoice_id: string | null;
    },
    hoje: string,
  ): EstadoDaLinha;
  ```
  (datas em ISO `YYYY-MM-DD`, comparáveis como string — é como o resto do app já compara data.)

  ⚠️ **`due_at` e `invoice_id` são OBRIGATÓRIOS no tipo, e essa é a metade que importa.** Com eles
  opcionais, o TypeScript aceita `InstallmentParcel` (`use-finance.ts:2487-2495`), que **não tem
  `due_at`** — e a parcela de um plano SEM cartão (a RPC aceita conta corrente) passaria a ler
  "atrasada" onde hoje lê "prevista", sem uma linha de erro. Obrigatórios, o compilador força
  `installments.tsx` a escrever `due_at: null` de propósito, e a decisão fica na tela em vez de
  escondida numa interrogação da assinatura.

- [ ] **Step 1: escrever os testes (vão falhar)**

Acrescentar ao fim de `src/lib/settle-labels.test.ts`:

```ts
import { estadoDaLinha } from './settle-labels.ts';

/**
 * ⚠️ **"previsto" é DATA, nunca `status`.** A régua já estava escrita e aplicada em UMA tela
 * (`finance/invoice/[id].tsx`): *"compra de cartão fica `pending` até a fatura ser paga, então
 * filtrar por `cleared` chamaria de 'previsto' a compra que a pessoa fez semana passada"*. A
 * lista de Lançamentos fazia o contrário, e a queixa foi literal (19/09/2026): *"veio com a tag
 * previsto se hoje é 19 de setembro e ali está dia 15 e 14"*.
 */
const HOJE = '2026-09-19';

test('compra de cartão que já aconteceu não é previsto, mesmo pendente', () => {
  assert.equal(
    estadoDaLinha(
      { kind: 'expense', status: 'pending', occurred_at: '2026-09-15', due_at: '2026-10-10', invoice_id: 'fat-1' },
      HOJE,
    ),
    null,
  );
});

test('compra de cartão com data à frente continua previsto', () => {
  assert.equal(
    estadoDaLinha(
      { kind: 'expense', status: 'pending', occurred_at: '2026-09-22', due_at: '2026-10-10', invoice_id: 'fat-1' },
      HOJE,
    ),
    'previsto',
  );
});

test('conta a pagar que venceu é ATRASADA, não prevista', () => {
  assert.equal(
    estadoDaLinha(
      { kind: 'expense', status: 'pending', occurred_at: '2026-09-01', due_at: '2026-09-10', invoice_id: null },
      HOJE,
    ),
    'atrasado',
  );
});

test('conta que vence hoje ainda é prevista — vencer hoje não é atrasar', () => {
  assert.equal(
    estadoDaLinha(
      { kind: 'expense', status: 'pending', occurred_at: '2026-09-01', due_at: HOJE, invoice_id: null },
      HOJE,
    ),
    'previsto',
  );
});

test('sem vencimento, quem decide é a data do lançamento', () => {
  assert.equal(
    estadoDaLinha({ kind: 'expense', status: 'pending', occurred_at: '2026-09-25', due_at: null, invoice_id: null }, HOJE),
    'previsto',
  );
  assert.equal(
    estadoDaLinha({ kind: 'expense', status: 'pending', occurred_at: '2026-09-10', due_at: null, invoice_id: null }, HOJE),
    'atrasado',
  );
});

test('receita que passou da data NÃO CAIU — ela não atrasa', () => {
  /**
   * ⚠️ Ninguém "deve" um salário. `finance.md` já fixou a palavra: a receita prevista vencida
   * *"some do número, não da tela — continua em «O que entra» com a pílula «não caiu»"*. Escrever
   * "atrasado" ali é o mesmo erro de vocabulário que fez este arquivo existir ("Paguei" em cima
   * de uma receita).
   */
  assert.equal(
    estadoDaLinha({ kind: 'income', status: 'pending', occurred_at: '2026-09-05', due_at: null, invoice_id: null }, HOJE),
    'não caiu',
  );
  assert.equal(
    estadoDaLinha({ kind: 'expense', status: 'pending', occurred_at: '2026-09-05', due_at: null, invoice_id: null }, HOJE),
    'atrasado',
  );
});

test('parcela de plano SEM cartão e com data passada lê atrasada', () => {
  // A RPC de parcelamento aceita conta corrente, e ali não há fatura para segurar o estado. É a
  // mudança de comportamento que o tipo obrigatório deixou à vista (antes lia "prevista").
  assert.equal(
    estadoDaLinha({ kind: 'expense', status: 'pending', occurred_at: '2026-09-05', due_at: null, invoice_id: null }, HOJE),
    'atrasado',
  );
});

test('lançamento efetivado não tem estado nenhum', () => {
  assert.equal(
    estadoDaLinha({ kind: 'expense', status: 'cleared', occurred_at: '2026-09-25', due_at: null, invoice_id: null }, HOJE),
    null,
  );
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `npm test 2>&1 | tail -20`
Esperado: falha com `estadoDaLinha is not a function` (ou `SyntaxError` do import), e `fail` > 0.

- [ ] **Step 3: implementar**

Acrescentar ao fim de `src/lib/settle-labels.ts`:

```ts
/**
 * O estado de uma linha de lançamento — a pílula que o `Row` desenha.
 *
 * ⚠️ **O corte é a DATA, nunca o `status`.** A régua é a de `finance.md` e já estava escrita em
 * `finance/invoice/[id].tsx`: compra de cartão fica `pending` até a FATURA ser paga, então usar
 * o status chama de "previsto" a compra que a pessoa fez semana passada. A queixa foi literal
 * (19/09/2026): *"veio com a tag previsto se hoje é 19 de setembro e ali está dia 15 e 14"*.
 *
 * Três estados, e cada um responde uma coisa diferente:
 *
 * | estado | quando | o que ele diz |
 * |---|---|---|
 * | `null` | efetivado, **ou** compra de cartão que já aconteceu | nada a decidir. No cartão o subtítulo já escreve "na fatura de DD/MM", que é a informação que sobra |
 * | `previsto` | ainda vai acontecer | conta na projeção, não no saldo |
 * | `atrasado` | DESPESA que passou da data | é o que pede ação |
 * | `não caiu` | RECEITA que passou da data | ninguém "deve" um salário — e é a palavra que
 *   `finance.md` já usa para a receita prevista que some do número e fica na tela |
 *
 * ⚠️ **No cartão quem decide é `occurred_at`, e nunca `due_at`.** Ali o `due_at` é o vencimento da
 * FATURA (o trigger `set_invoice` é dono da coluna): a compra de 15/09 tem `due_at` 10/10, e
 * olhar para ele faria toda compra do mês parecer futura. Fora do cartão é o contrário —
 * `due_at` É o vencimento daquela conta, e é ele que decide.
 *
 * ⚠️ **Isto NÃO substitui o `status` na ação de dar baixa.** "Paguei"/"Recebi" continua
 * aparecendo para toda linha `pending`, inclusive a compra de cartão que já aconteceu: o dinheiro
 * ainda não saiu, e dar baixa nela continua sendo uma coisa que existe.
 */
export type EstadoDaLinha = 'previsto' | 'atrasado' | 'não caiu' | null;

export function estadoDaLinha(
  tx: {
    kind: string;
    status: string;
    occurred_at: string;
    due_at: string | null;
    invoice_id: string | null;
  },
  hoje: string,
): EstadoDaLinha {
  if (tx.status !== 'pending') return null;
  // Datas ISO (`YYYY-MM-DD`) comparam como string — é como o resto do app já compara.
  if (tx.invoice_id) return tx.occurred_at > hoje ? 'previsto' : null;
  const quando = tx.due_at ?? tx.occurred_at;
  if (quando >= hoje) return 'previsto';
  // ⚠️ Receita não ATRASA — ela não CAIU. Ninguém "deve" um salário, e este arquivo nasceu
  // justamente de quatro telas escrevendo "Paguei" em cima de uma receita.
  return tx.kind === 'income' ? 'não caiu' : 'atrasado';
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit`
Esperado: `fail 0`, código de saída 0, `tsc` limpo.

- [ ] **Step 5: commit**

```bash
git add src/lib/settle-labels.ts src/lib/settle-labels.test.ts
git commit -m "feat(finance): o estado da linha sai da data, nao do status"
```

---

## Tarefa 3: aplicar `estadoDaLinha` nas quatro telas

**Files:**
- Modify: `src/app/finance/transactions.tsx:696-704, 788, 791, 87-90, 779`
- Modify: `src/app/finance/invoice/[id].tsx:553`
- Modify: `src/app/finance/installments.tsx:451, 472`
- Modify: `src/app/finance/[txId].tsx:279`
- Test: `src/lib/anti-slop.test.ts` (regra nova)

**Interfaces:**
- Consumes: `estadoDaLinha` da Tarefa 2; `localISODate` de `@/hooks/use-items`.

⚠️ **Não há teste de conteúdo de LINHA aqui, e isso é medido, não preguiça.** O harness não
invoca `renderItem` — ver a tabela "o que o harness consegue" nas Global Constraints. O que prende
esta tarefa é: a Tarefa 2 (a régua, pura, com sete casos), a regra de anti-slop abaixo (nenhuma
tela volta a decidir sozinha) e a Tarefa 7 item 9 (os olhos no device).

- [ ] **Step 1: escrever a regra de anti-slop (vai falhar)**

Acrescentar a `src/lib/anti-slop.test.ts`, no estilo das outras 32 (usa `offenders()` sobre o
fonte com comentários já removidos):

```ts
/**
 * ⚠️ **Nenhuma tela de finanças decide "previsto" a partir do `status`.**
 *
 * A régua é a de `finance.md` e já estava escrita em `finance/invoice/[id].tsx`: compra de cartão
 * fica `pending` até a FATURA ser paga, então o `status` chama de "previsto" a compra que a
 * pessoa fez semana passada. A queixa foi literal (19/09/2026). Quem responde isso é
 * `estadoDaLinha` (`src/lib/settle-labels.ts`), e ele olha a DATA.
 *
 * Esta regra existe porque a condição já esteve copiada em quatro telas com três respostas
 * diferentes — é a mesma lição do `settle-labels.ts`, que nasceu de quatro cópias de
 * `status === 'pending'` decidindo se o botão dizia "Paguei" ou "Recebi".
 *
 * O que continua PERMITIDO: `status === 'pending'` para decidir a AÇÃO de dar baixa, e o filtro
 * de status da lista. O que a regra proíbe é ele virar rótulo.
 */
test('nenhuma tela decide "previsto" pelo status', () => {
  const previstoPorStatus =
    /const\s+(previst[oa]|prevista|atrasad[oa])\s*=\s*[\w.]*status\s*[=!]==?\s*'(pending|cleared)'/;
  const encontrados = offenders(previstoPorStatus).filter((linha) =>
    linha.startsWith('app/finance') || linha.startsWith('app/(tabs)'),
  );
  assert.deepEqual(
    encontrados,
    [],
    `"previsto" sai de estadoDaLinha() (settle-labels.ts), nunca do status:\n${encontrados.join('\n')}`,
  );
});
```

⚠️ Confira a forma exata de `offenders()` no arquivo antes de escrever — ela devolve
`file:line  match` e os caminhos são relativos a `src/`. Se a forma for outra, adapte o filtro;
o que não pode mudar é a regra.

- [ ] **Step 2: rodar e ver falhar**

Run: `npm test 2>&1 | tail -20`
Esperado: a regra aponta `app/finance/transactions.tsx` e `app/finance/invoice/[id].tsx`.

- [ ] **Step 3: aplicar em `transactions.tsx`**

Trocar a linha 696 e o que depende dela:

```tsx
            /*
              ⚠️ **"previsto" saiu da frase cinza e virou PÍLULA.** Ele vinha emendado em
              `previsto · vence 08/10/2026 · assinaturas · Nubank · Cartão · recorrente`, com o
              mesmo peso do nome do cartão — seis palavras cinzas em que só a primeira diz se
              aquilo aconteceu.

              ⚠️ **E o que ela diz sai da DATA, não do `status`** (`estadoDaLinha`, 20/09/2026).
              Com `status === 'pending'` toda compra de cartão do mês aparecia como "previsto",
              inclusive a de ontem — a queixa foi literal. A ação de dar baixa, logo abaixo,
              continua sendo do `status`: o dinheiro dela ainda não saiu.
            */
            const estado = estadoDaLinha(tx, hoje);
            const emAberto = tx.status === 'pending';
            /**
             * ⚠️ **"na fatura de 10/10" NÃO pode sumir junto com a pílula.** Com o antigo
             * `previsto = status === 'pending'`, a compra de cartão caía no ramo do `dueInline` e
             * mostrava a data da fatura. Trocando a condição pela pílula, a compra de ontem
             * perderia a data e ganharia a palavra solta "fatura" — o conserto tiraria a tag
             * errada e levaria embora o único dado que restava na linha.
             *
             * Quem decide a PÍLULA é o estado (data); quem decide o SUBTÍTULO é o `status`, que é
             * o que responde "esse dinheiro já saiu?".
             */
            const badges = [
              tx.installment_no ? `parcela ${tx.installment_no}` : null,
              emAberto
                ? dueInline(tx.kind, tx.due_at ? formatDateBR(tx.due_at) : null, {
                    onCard: tx.invoice_id !== null,
                  }).replace(/^previsto( · )?/, '')
                : null,
            ].filter(Boolean);
```

e, na `Row`:

```tsx
                      /*
                        ⚠️ `atrasado` leva `danger`. `design.md §2`: vermelho é semântica — "erro
                        e atraso" —, e é a última alavanca de cor que este app tem. Atraso em
                        cinza-neutro ao lado de um número é o estado que mais pede ação lido como
                        o que menos pede.
                      */
                      badge={
                        estado
                          ? {
                              label: estado,
                              tone:
                                estado === 'atrasado' ? 'danger'
                                : estado === 'não caiu' ? 'warning'
                                : undefined,
                            }
                          : undefined
                      }
```

e no `accessibilityLabel`, trocar `${tx.status === 'pending' ? ', previsto' : ''}` por
`${estado ? `, ${estado}` : ''}`.

(Conferido: `row.tsx:30` declara `badge?: { label: string; tone?: RowBadgeTone }` e
`:114-116` usa `badge.tone` no fundo e no texto.)

`hoje` vem de `localISODate()` **congelado uma vez** por montagem da tela, fora do `renderItem`
(ler o relógio durante o render é impuro — React Compiler):

```tsx
  // Congelado na montagem: todas as linhas da lista são julgadas pelo MESMO "hoje". Lido por
  // linha, duas vizinhas poderiam cair em dias diferentes na virada da meia-noite.
  const [hoje] = useState(() => localISODate());
```

- [ ] **Step 4: aplicar nas outras três**

`src/app/finance/invoice/[id].tsx:553` — `const prevista = tx.status === 'pending';` vira
`const prevista = estadoDaLinha(tx, hoje) !== null;`, com o mesmo `hoje` congelado. (A tela já
tem `const hoje = localISODate();` na linha 176 — reuse, não crie um segundo.)

`src/app/finance/installments.tsx:451, 472` — `parcela.status === 'cleared' ? 'paga' : 'prevista'`
vira:

```tsx
// A parcela de cartão fica `pending` até a fatura ser paga: chamar de "prevista" a parcela do mês
// passado é a mesma mentira que a lista de Lançamentos contava.
const estado = estadoDaLinha(parcela, hoje);
const rotulo =
  parcela.status === 'cleared' ? 'paga'
  : estado === 'atrasado' ? 'atrasada'
  : estado === 'previsto' ? 'prevista'
  : 'na fatura';
```

⚠️ **`InstallmentParcel` não tem `due_at`**, e desde a Tarefa 2 o tipo o exige — então a chamada
é `estadoDaLinha({ ...parcela, kind: 'expense', due_at: null }, hoje)`, escrito assim de propósito (parcela de compra é sempre despesa). A consequência
está à vista e é real: a parcela de um plano **sem cartão** (a RPC aceita conta corrente) com data
passada passa a ler **"atrasada"**, onde hoje lê "prevista". É o certo — ninguém a pagou — e é o
caso que o teste novo da Tarefa 2 prende.

`src/app/finance/[txId].tsx:279` — ⚠️ **a CONDIÇÃO da faixa continua sendo `tx.status ===
'pending'`. Só o TÍTULO e o texto mudam.** Aquela `<Section>` não é decoração: ela CONTÉM o botão
de dar baixa (`:287-300`, `settleLabel(tx.kind)` + `markPaid.mutate`). Trocar a condição por
`estadoDaLinha(tx, hoje) !== null` faria **toda compra de cartão com data passada perder o
"Paguei" junto com a faixa** — e o `estadoDaLinha` diz, na própria doc, que a ação continua sendo
do `status`. O que muda é só a palavra:

```tsx
      {tx.status === 'pending' ? (
        <Section
          /*
           * ⚠️ A CONDIÇÃO é o `status` — esta seção carrega o botão de dar baixa, e o dinheiro de
           * uma compra de cartão ainda não saiu. O que o `estadoDaLinha` decide é só o TÍTULO:
           * "Ainda não aconteceu" em cima de uma compra de semana passada era a mesma mentira da
           * pílula da lista.
           */
          title={
            estadoDaLinha(tx, hoje) === 'atrasado'
              ? 'Passou da data'
              : estadoDaLinha(tx, hoje) === 'previsto'
                ? 'Ainda não aconteceu'
                : 'Já aconteceu, mas ainda não saiu do caixa'
          }>
```

o resto da seção (o `settleHint`, o botão) fica como está.

- [ ] **Step 5: os rótulos do filtro de status**

`src/app/finance/transactions.tsx:87-90`. O filtro roda no SERVIDOR sobre `status`, então
"Ainda vai acontecer"/"Já aconteceu" passa a contradizer a pílula ao lado.

```tsx
/**
 * ⚠️ **O filtro é do `status`, e por isso ele NÃO diz "ainda vai acontecer".** Era essa a
 * palavra, e ela virou mentira quando a pílula passou a sair da data: a compra de cartão de
 * ontem é `pending` e JÁ aconteceu. O que o `status` responde é outra coisa — se o dinheiro já
 * se mexeu.
 */
const STATUS_OPTIONS: { value: 'all' | 'pending' | 'cleared'; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'pending', label: 'Em aberto' },
  { value: 'cleared', label: 'Concluído' },
];
```

("Baixado" foi descartado de propósito: `settle-labels.ts` já registra que a palavra lê como
download.) São 3 opções — dentro do teto de 4 do `Segmented` que o anti-slop prende.

⚠️ **E o FORMULÁRIO muda junto — decisão do dono do produto em 20/09/2026.** O comentário de
`transactions.tsx:80-90` já dizia a régua: *"eram três vocabulários para um campo só (`status`).
Estes chips passam a falar a língua do formulário — quem filtra e quem cadastra dizem o mesmo."*
Mudar só o filtro recriaria exatamente a divergência que aquele comentário existe para fechar.

`src/app/finance/transaction-form.tsx:743-745`:

```tsx
        {/*
          ⚠️ **Fala de CAIXA, não de tempo.** Era "Já aconteceu | Ainda vai acontecer", e o tempo
          é a coisa errada para descrever esta coluna: a compra de cartão de ontem aconteceu E
          está `pending`. Quem responde "aconteceu?" agora é a pílula da lista, pela data.
        */}
        options={[
          { value: 'no', label: 'Já saiu do caixa' },
          { value: 'yes', label: 'Ainda vai sair' },
        ]}
```

⚠️ Em RECEITA a frase se inverte ("saiu" é despesa). O arquivo que resolve isso já existe e já é
importado por esta tela — `settle-labels.ts`, o mesmo que decide "Paguei"/"Recebi". Acrescente lá:

```ts
/**
 * O interruptor "isto já se efetivou?" no formulário. Era "Já aconteceu | Ainda vai acontecer",
 * e tempo é a régua errada para `transactions.status`: a compra de cartão de ontem aconteceu e
 * continua `pending`. O que a coluna responde é se o dinheiro se MEXEU — e o verbo depende do
 * lado, como em todo o resto deste arquivo.
 */
export function caixaLabels(kind: SettleKind | string | null | undefined): {
  feito: string;
  aFazer: string;
} {
  if (kind === 'income') return { feito: 'Já caiu', aFazer: 'Ainda vai cair' };
  if (kind === 'transfer') return { feito: 'Já foi', aFazer: 'Ainda vai ser' };
  return { feito: 'Já saiu do caixa', aFazer: 'Ainda vai sair' };
}
```

e um caso em `settle-labels.test.ts` prendendo que receita cai e despesa sai — é a mesma asserção
que o arquivo já faz para `settleLabel`.

- [ ] **Step 6: "Editar" de uma parcela abre a COMPRA (achado D)**

`src/app/finance/transactions.tsx:779` — a mesma regra de `[txId].tsx:443-448`:

```tsx
                    {
                      /**
                       * ⚠️ **Em parcela, "Editar" abre a COMPRA, não a linha** — a mesma régua de
                       * `finance/[txId].tsx`. As duas telas respondiam coisas diferentes para a
                       * mesma palavra, e o valor da parcela é do contrato desde 15/09/2026.
                       */
                      label: 'Editar',
                      icon: 'pencil',
                      onPress: () =>
                        tx.installment_plan_id
                          ? router.push({
                              pathname: '/finance/installments',
                              params: { edit: tx.installment_plan_id },
                            })
                          : router.push({
                              pathname: '/finance/transaction-form',
                              params: { id: tx.id, month },
                            }),
                    },
```

- [ ] **Step 7: rodar tudo**

Run: `npm test && npx tsc --noEmit && npx expo lint`
Esperado: os três limpos, `fail 0`, e a regra nova verde.

⚠️ Os três testes de `transactions.tsx` que já existem (`simple-finance-ui.test.ts:486-511`)
montam a tela e olham TIPOS de nó — eles têm que continuar verdes. Se algum quebrar, a mudança
alterou a árvore, não só o rótulo.

- [ ] **Step 8: commit**

```bash
git add src/app/finance/transactions.tsx src/app/finance/invoice/\[id\].tsx \
        src/app/finance/installments.tsx src/app/finance/\[txId\].tsx \
        src/lib/anti-slop.test.ts
git commit -m "fix(finance): previsto sai da data, e editar parcela abre a compra"
```

---

## Tarefa 4: os hooks de conversão e dissolução

**Files:**
- Modify: `src/hooks/use-finance.ts` (perto de `useUpdateInstallmentPlan`, linha ~707)

**Interfaces:**
- Produces:
  ```ts
  export function useConvertToInstallments(): UseMutationResult<void, Error, {
    transactionId: string;
    totalCents: number;
    installments: number;
    firstOccurredAt: string;   // ISO
    description: string | null;
    category: string | null;
    merchant: string | null;
    accountId: string;
  }>;
  ```
  `useUpdateInstallmentPlan` mantém a assinatura; o que muda é que `installments: 1` passa a ser
  válido.

- [ ] **Step 1: escrever o hook**

```ts
/**
 * Um lançamento que já existe vira compra parcelada.
 *
 * ⚠️ **A linha original é ADOTADA como parcela 1 — o `id` não muda.** Quem faz isso é a RPC; o
 * hook não tem como saber. É o que torna a operação idempotente: chamar duas vezes é RECUSA
 * (`Esse lançamento já é uma compra parcelada`), nunca um segundo plano. Sem isso, o caminho para
 * a duplicação era o próprio usuário — sem esta porta, ele lançava de novo, e ficava com as duas
 * compras na fatura (19/09/2026).
 *
 * ⚠️ **`totalCents` é o TOTAL da compra, não o valor da parcela** — a mesma convenção da criação
 * (`useCreateInstallmentPlan`) e da edição (`useUpdateInstallmentPlan`). A tela escreve isso no
 * `hint` do campo.
 *
 * ⚠️ **Payload montado campo a campo é payload que ESQUECE campo, em silêncio** — foi assim que
 * `p_merchant` sumiu por meses e "nuuvem wardog" virou "Compra parcelada (1/2)". **Campo novo no
 * formulário exige linha nova aqui.**
 */
export function useConvertToInstallments() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      transactionId: string;
      totalCents: number;
      installments: number;
      firstOccurredAt: string;
      description: string | null;
      category: string | null;
      merchant: string | null;
      accountId: string;
    }) => {
      const { error } = await supabase.rpc('convert_transaction_to_installments', {
        p_transaction_id: input.transactionId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_first_occurred_at: input.firstOccurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
        p_merchant: input.merchant ?? undefined,
        p_account_id: input.accountId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
```

E acrescentar ao bloco de doc de `useUpdateInstallmentPlan`:

```ts
 * ⚠️ **`installments: 1` DISSOLVE o plano** (20/09/2026): a parcela 1 sobrevive — com o mesmo
 * `id` — virando um lançamento à vista pelo total, as outras somem e o plano é apagado. Com
 * qualquer parcela paga a RPC recusa, porque `1 <> N` cai no mesmo guarda que já protege o
 * número de parcelas. Quem chama isso é o chip "À vista" de Parceladas.
```

- [ ] **Step 2: conferir os tipos**

Run: `npx tsc --noEmit`
Esperado: limpo. Se reclamar que `'convert_transaction_to_installments'` não existe em
`Database['public']['Functions']`, a Tarefa 1 Step 6 (`gen types`) não foi feita.

- [ ] **Step 3: commit**

```bash
git add src/hooks/use-finance.ts
git commit -m "feat(finance): hook para parcelar um lancamento que ja existe"
```

---

## Tarefa 5: a DECISÃO do formulário vira função pura

**Files:**
- Modify: `src/lib/finance-form.ts`
- Test: `src/lib/finance-form.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Um lançamento que já tem contrato de série não se parcela por aqui. */
  export function temContrato(
    editing?: { installment_plan_id?: string | null; recurring_id?: string | null; debt_id?: string | null } | null,
  ): boolean;

  /** A fileira "Parcelas" aparece? Vale para criar E para editar. */
  export function podeParcelar(
    kind: string,
    accountId: string | null | undefined,
    editing?: { installment_plan_id?: string | null; recurring_id?: string | null; debt_id?: string | null } | null,
  ): boolean;

  /** Para onde o "Salvar" vai. UMA escrita, sempre. */
  export type DestinoDoSalvar = 'criarPlano' | 'converter' | 'salvar';
  export function destinoDoSalvar(
    editing: { id: string; installment_plan_id?: string | null; recurring_id?: string | null; debt_id?: string | null } | null | undefined,
    values: { installments: number; account_id: string | null },
  ): DestinoDoSalvar;
  ```

**Por que puras e não na tela:** o harness não monta `transaction-form.tsx` (medido — ver as
Global Constraints). E a decisão que importa aqui é justamente a que produziu a queixa: **para
onde o Salvar vai**. Uma escrita errada ali é a compra em duplicidade. Em `finance-form.ts` ela é
testada de graça, e a tela vira uma linha.

- [ ] **Step 1: escrever os testes (vão falhar)**

Acrescentar a `src/lib/finance-form.test.ts`:

```ts
import { destinoDoSalvar, podeParcelar, temContrato } from './finance-form.ts';

const simples = { id: 'tx-1', installment_plan_id: null, recurring_id: null, debt_id: null };
const parcela = { id: 'tx-1', installment_plan_id: 'plano-1', recurring_id: null, debt_id: null };
const ocorrencia = { id: 'tx-1', installment_plan_id: null, recurring_id: 'serie-1', debt_id: null };
const financiamento = { id: 'tx-1', installment_plan_id: null, recurring_id: null, debt_id: 'divida-1' };

/**
 * ⚠️ A fileira de parcelas era escondida na edição (`!editing`), e o jeito de contornar era
 * LANÇAR DE NOVO — foi assim que a mesma compra apareceu duas vezes na fatura (19/09/2026).
 */
test('parcelar vale também EDITANDO um lançamento simples', () => {
  assert.equal(podeParcelar('expense', 'card-1', undefined), true, 'criando');
  assert.equal(podeParcelar('expense', 'card-1', simples), true, 'editando um simples');
});

test('o que já tem outro contrato não se parcela por aqui', () => {
  // A parcela: quem manda no contrato é a tela da compra. A ocorrência: quem manda é a regra.
  // A parcela de financiamento: quem manda é o cronograma. As três também são recusadas no banco.
  assert.equal(podeParcelar('expense', 'card-1', parcela), false);
  assert.equal(podeParcelar('expense', 'card-1', ocorrencia), false);
  assert.equal(podeParcelar('expense', 'card-1', financiamento), false);
  assert.equal(temContrato(parcela) && temContrato(ocorrencia) && temContrato(financiamento), true);
  assert.equal(temContrato(simples) || temContrato(null), false);
});

test('parcelar continua exigindo gasto e conta', () => {
  assert.equal(podeParcelar('income', 'card-1', simples), false);
  assert.equal(podeParcelar('transfer', 'card-1', simples), false);
  assert.equal(podeParcelar('expense', null, simples), false);
});

/**
 * ⚠️ **UMA escrita, sempre.** O caminho que duplica é justamente "converter E salvar": duas
 * escritas para uma intenção. O destino é exclusivo por construção.
 */
test('criar com 1x salva; criar com 2x cria o plano', () => {
  assert.equal(destinoDoSalvar(null, { installments: 1, account_id: 'card-1' }), 'salvar');
  assert.equal(destinoDoSalvar(null, { installments: 2, account_id: 'card-1' }), 'criarPlano');
});

test('editar um simples com 2x CONVERTE — não cria um segundo lançamento', () => {
  assert.equal(destinoDoSalvar(simples, { installments: 2, account_id: 'card-1' }), 'converter');
});

test('editar sem mexer em parcelas continua sendo só o update', () => {
  assert.equal(destinoDoSalvar(simples, { installments: 1, account_id: 'card-1' }), 'salvar');
});

test('editar uma parcela nunca converte, nem com o campo forçado', () => {
  // A fileira nem aparece; isto é o cinto. Converter uma parcela criaria plano dentro de plano.
  assert.equal(destinoDoSalvar(parcela, { installments: 3, account_id: 'card-1' }), 'salvar');
  assert.equal(destinoDoSalvar(ocorrencia, { installments: 3, account_id: 'card-1' }), 'salvar');
  assert.equal(destinoDoSalvar(financiamento, { installments: 3, account_id: 'card-1' }), 'salvar');
});

test('sem conta não há para onde parcelar', () => {
  assert.equal(destinoDoSalvar(simples, { installments: 3, account_id: null }), 'salvar');
  assert.equal(destinoDoSalvar(null, { installments: 3, account_id: null }), 'salvar');
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `npm test 2>&1 | tail -20`
Esperado: `podeParcelar is not a function`.

- [ ] **Step 3: implementar em `src/lib/finance-form.ts`**

```ts
/** O que já pertence a OUTRO contrato — e por isso não se parcela pelo formulário da linha. */
type ComContrato = {
  installment_plan_id?: string | null;
  recurring_id?: string | null;
  debt_id?: string | null;
};

/**
 * Um lançamento que já é parcela, ocorrência de recorrência ou parcela de financiamento.
 *
 * Nos três casos a divisão do dinheiro é de outro dono: a COMPRA (editável em
 * `/finance/installments`), a REGRA da série, e o CRONOGRAMA da dívida. As três recusas também
 * existem no banco — aqui elas evitam mostrar um botão que vai dar erro.
 */
export function temContrato(editing?: ComContrato | null): boolean {
  return Boolean(editing?.installment_plan_id || editing?.recurring_id || editing?.debt_id);
}

/**
 * A fileira "Parcelas" aparece?
 *
 * ⚠️ **Vale para CRIAR e para EDITAR, e a falta disso custou uma compra duplicada.** Até
 * 19/09/2026 a condição terminava em `&& !editing`: parcelar um lançamento que já existia não
 * era possível, e o jeito de contornar era lançar de novo — a queixa foi literal, *"não consigo
 * editar o lançamento criado sem parcelar, colocando a parcela"*, e logo depois *"quando eu
 * consegui editar, ele duplicou"*.
 */
export function podeParcelar(
  kind: string,
  accountId: string | null | undefined,
  editing?: ComContrato | null,
): boolean {
  return kind === 'expense' && Boolean(accountId) && !temContrato(editing);
}

/**
 * Para onde o "Salvar" vai — e é sempre UM lugar só.
 *
 * ⚠️ **A exclusividade é o ponto.** O modo de falha desta tela não é erro na tela: é duas
 * escritas para uma intenção, que na fatura vira a mesma compra duas vezes. Por isso a decisão
 * é um valor, e não três `if` espalhados no `onSubmit`.
 *
 * `converter` chama uma RPC que ADOTA a linha existente como parcela 1 — o `id` não muda, e
 * chamar de novo é recusa, nunca um segundo plano.
 */
export type DestinoDoSalvar = 'criarPlano' | 'converter' | 'salvar';

export function destinoDoSalvar(
  editing: (ComContrato & { id: string }) | null | undefined,
  values: { installments: number; account_id: string | null },
): DestinoDoSalvar {
  if (values.installments <= 1 || !values.account_id) return 'salvar';
  if (!editing) return 'criarPlano';
  // Cinto: a fileira nem aparece para quem já tem contrato, mas converter uma parcela criaria
  // plano dentro de plano.
  return temContrato(editing) ? 'salvar' : 'converter';
}
```

- [ ] **Step 4: rodar e ver passar**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit`

- [ ] **Step 5: commit**

```bash
git add src/lib/finance-form.ts src/lib/finance-form.test.ts
git commit -m "feat(finance): a decisao de parcelar sai da tela e vira funcao pura"
```

---

## Tarefa 5b: o formulário passa a usar a decisão (e os achados A e B)

**Files:**
- Modify: `src/app/finance/transaction-form.tsx:205, 259, 283-311, 345, 459-465`

**Interfaces:**
- Consumes: `podeParcelar`, `temContrato`, `destinoDoSalvar` (Tarefa 5);
  `useConvertToInstallments` (Tarefa 4).

⚠️ Esta tarefa não tem teste automatizado próprio — o harness não monta esta tela (medido). Ela é
provada pela Tarefa 5 (a decisão), pelo `tsc` e pela Tarefa 7 itens 3, 4 e 10 (device).

- [ ] **Step 1: abrir o parcelamento na edição**

Substituir `src/app/finance/transaction-form.tsx:259`:

```tsx
  /**
   * ⚠️ **Parcelar também vale EDITANDO.** A régua mora em `finance-form.ts`, com teste — aqui
   * era `kind === 'expense' && !!accountId && !editing`, e o `!editing` é o que fez a mesma
   * compra aparecer duas vezes na fatura (19/09/2026).
   */
  const jaTemContrato = temContrato(editing);
  const podeParcelarAqui = podeParcelar(kind, accountId, editing);
  /** Histórico ("3 das 12 já foram pagas") é da CRIAÇÃO. Ver o ⚠️ da migration. */
  const podeInformarHistorico = podeParcelarAqui && !editing;
```

e trocar os dois `{podeParcelar && …}` do JSX: o da fileira vira `{podeParcelarAqui && …}` e o do
campo de histórico vira `{podeInformarHistorico && installmentCount > 1 && …}`.

- [ ] **Step 2: rotear o submit pela decisão**

Substituir o bloco de `:286-311`:

```tsx
    /**
     * UMA escrita, e qual delas é decisão pura (`destinoDoSalvar`, com teste). As três são
     * exclusivas de propósito: duas escritas para uma intenção é a compra duplicada na fatura.
     */
    const destino = destinoDoSalvar(editing, {
      installments: values.installments,
      account_id: values.account_id,
    });

    // parcelado NOVO: quem cria as N transações (e resolve a fatura de cada uma) é o banco, não o
    // app — mesma regra usada pelo WhatsApp.
    if (destino === 'criarPlano' && values.account_id) {
      createPlan.mutate(
        { /* …inalterado… */ },
        { /* …inalterado… */ },
      );
      return;
    }

    /**
     * Um lançamento que já existe virando compra parcelada.
     *
     * ⚠️ **A RPC ADOTA a linha existente como parcela 1** — não há "apaga e cria de novo", o
     * `id` não muda, e chamar duas vezes é recusa. É o que impede a duplicação de existir.
     *
     * `values.amount_cents` é o TOTAL da compra aqui, como na criação; o `hint` do campo escreve
     * isso na tela.
     */
    if (destino === 'converter' && editing && values.account_id) {
      converter.mutate(
        {
          transactionId: editing.id,
          totalCents: values.amount_cents,
          installments: values.installments,
          firstOccurredAt: brToISO(values.occurred_at),
          description: values.description.trim(),
          category: values.category,
          merchant: values.merchant?.trim() || null,
          accountId: values.account_id,
        },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
            toast({
              message: `Parcelei em ${values.installments}x. As futuras já entram nas próximas faturas.`,
              tone: 'success',
            });
          },
          onError: (error) =>
            toast({
              message: financeErrorMessage(error, 'Não deu para parcelar. Tenta de novo.'),
              tone: 'error',
            }),
        },
      );
      return;
    }
```

com, no topo do componente, `const converter = useConvertToInstallments();` e
`const saving = save.isPending || createPlan.isPending || converter.isPending;`.

⚠️ O `Button` do `TaskHeader` já é `disabled={saving}` — com `converter.isPending` somado, o
toque duplo no "Salvar" não dispara duas conversões. (A RPC recusaria a segunda de qualquer
forma; isto é o cinto de cima.)

- [ ] **Step 2b: o que a conversão NÃO leva — e por que a tela não pode oferecer os dois**

⚠️ **`convert_transaction_to_installments` não recebe `status`, `due_at` nem `auto_confirm`**, e o
ramo novo dá `return` antes do `save.mutate`. Quem, no MESMO salvamento, virar o `Segmented` "Já
aconteceu → Ainda vai acontecer" (`:741-750`), preencher o vencimento (`:754`) ou ligar "Entrar
como pago na data" (`:781`) **e** escolher 3x, perderia as três edições sem uma linha na tela. É
exatamente a classe dos achados A e B que esta entrega está corrigindo, recriada no caminho novo.

A saída é não oferecer os dois ao mesmo tempo, e ela cai de graça da régua que já existe:
**`podeAdiar` é `kind !== 'transfer' && !isCard`**, ou seja, em cartão o bloco "vou pagar depois"
NEM aparece — e parcelar é coisa de cartão em quase todo caso. O que falta é fechar o caso da
conta comum:

```tsx
  /**
   * ⚠️ **"Vou pagar depois" e "parcelar" não convivem no mesmo salvamento.** A conversão é uma
   * RPC própria e não carrega `status`, `due_at` nem `auto_confirm`: oferecer os dois faria a
   * pessoa preencher um vencimento que seria descartado em silêncio — o mesmo defeito do achado
   * A, com outra cara. Parcelar já diz quando cada parcela acontece.
   */
  const podeAdiar = kind !== 'transfer' && !isCard && installmentCount <= 1;
```

⚠️ E o `podeAdiar` é lido em mais de um lugar (`:315` `adiado`, `:324` `status`, `:345`
`auto_confirm`, `:734` o bloco do JSX). Como ele já força o reset ao trocar para cartão
(`:585-593`), some a mesma reação ao subir o número de parcelas: `setValue('pending', false);
setValue('due_at', null);`. Sem isso, o zod continua exigindo `due_at` (`:110-113`) de um campo
que sumiu da tela, e o "Salvar" fica desabilitado sem dizer por quê — que é o defeito espelho do
§7b do design.

- [ ] **Step 3: achado A — o `auto_confirm` preservado**

`src/app/finance/transaction-form.tsx:345`:

```tsx
        /**
         * ⚠️ **Mesma regra do `status` logo acima, e pelo mesmo motivo.** Em cartão e em
         * transferência o campo "vou pagar depois" não existe (`podeAdiar` é false), então
         * `adiado` é sempre false ali — e escrever `false` a partir disso DESLIGAVA o automático
         * de um lançamento só porque alguém corrigiu o nome dele. **Onde o campo não aparece, o
         * valor é o que já era.**
         */
        auto_confirm: podeAdiar
          ? (adiado ? values.auto_confirm : false)
          : (editing?.auto_confirm ?? false),
```

- [ ] **Step 4: achado B — o tipo não se troca numa série**

No `Controller` de `kind` (~:459):

```tsx
        {/*
          ⚠️ **Linha de série não troca de tipo.** `gravar('one')` vai pelo `.update()` cru, que
          carrega `kind` — justamente a coluna que `update_transaction_scoped` recusa de
          propósito. Com o Segmented na tela, dava para virar uma parcela de cartão em receita, e
          a fatura ficava com uma linha que soma para o outro lado. O valor gravado continua
          sendo `editing.kind`, que é o que o `defaultValues` já traz.
        */}
        {!naSerieEditada && (
          <Controller control={control} name="kind" render={/* …inalterado… */} />
        )}
```

com `const naSerieEditada = Boolean(editing?.installment_plan_id || editing?.recurring_id);`.

- [ ] **Step 5: rodar tudo**

Run: `npm test && npx tsc --noEmit && npx expo lint`

- [ ] **Step 4b: encurtar o `hint` das parcelas, que estoura o teto**

⚠️ **Ele tem 102 caracteres contra um teto de 90, e passa por um furo do regex.** Medido:

```
`${field.value}x de ${formatBRL(...)} — o valor acima é o TOTAL da compra. As parcelas futuras já entram nas próximas faturas.`
```

O regex de `anti-slop.test.ts:366` exige uma STRING logo depois de `hint=` (com `{` opcional);
aqui vem um ternário (`field.value > 1 && amountCents > 0 ? …`) e o casamento falha. Não é
allowlist — é furo. O mesmo furo esconde o hint de 115 ch do "Juros do Pix no crédito"
(`:686-690`).

Isto entra AQUI porque esta tarefa faz o campo aparecer num contexto novo (a edição), e as
Global Constraints deste plano afirmam respeitar o teto. A régua do §7b é a mesma: *"o que não
cabe em uma linha não é ajuda de campo, é documentação"*, e explicação mora na confirmação da
ação — que aqui é o toast.

```tsx
                  hint={
                    field.value > 1 && amountCents > 0
                      ? `${field.value}x de ${formatBRL(Math.floor(amountCents / field.value))} — o valor acima é o TOTAL`
                      : undefined
                  }
```

(72 caracteres com o valor renderizado.) O resto — "as parcelas futuras já entram nas próximas
faturas" — já é o que o toast do Step 2 diz depois de converter.

⚠️ **Apertar o regex do anti-slop para pegar o caso do ternário fica FORA desta entrega**, e de
propósito: ele reprovaria os dois hints e um terceiro que ninguém mediu, e "corrigir texto de
cinco campos" é outra tarefa. Fica registrado aqui para não passar por descuido — é a mesma
lição que o arquivo escreve sobre hex e `fontSize`: contagem que depende de alguém medir volta a
subir sozinha.

- [ ] **Step 6: commit**

```bash
git add src/app/finance/transaction-form.tsx
git commit -m "feat(finance): parcelar um lancamento que ja existe, sem duplicar"
```

---

## Tarefa 6: desparcelar pela tela de Parceladas

**Files:**
- Modify: `src/lib/finance-form.ts` e `src/lib/finance-form.test.ts`
- Modify: `src/app/finance/installments.tsx:57, 337-347, 356-381, 700-720`

**Interfaces:**
- Produces:
  ```ts
  /** As opções de parcelas do editor da compra. `1` = "À vista" (dissolve), e some se travado. */
  export function opcoesDeParcelas(travadas: number): number[];
  ```

- [ ] **Step 1: escrever o teste (vai falhar)**

```ts
import { opcoesDeParcelas } from './finance-form.ts';

/**
 * ⚠️ **Sem o `1` não havia como desfazer um parcelamento** — só apagar a compra inteira e lançar
 * de novo, que é a mesma armadilha do formulário. O comentário de `installments.tsx` dizia "as
 * mesmas opções da criação" e a criação SEMPRE teve "À vista".
 */
test('o editor da compra oferece "À vista" quando nada foi pago', () => {
  assert.deepEqual(opcoesDeParcelas(0), [1, 2, 3, 4, 6, 10, 12, 18, 24]);
});

/**
 * ⚠️ Com parcela travada o banco recusa (`1 <> N` cai no guarda que já existia). Botão que só
 * existe para dar erro é defeito — some.
 */
test('com parcela paga, "À vista" nem aparece', () => {
  assert.deepEqual(opcoesDeParcelas(1), [2, 3, 4, 6, 10, 12, 18, 24]);
  assert.equal(opcoesDeParcelas(3).includes(1), false);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `npm test 2>&1 | tail -10`

- [ ] **Step 3: implementar em `finance-form.ts`**

```ts
/**
 * As opções da fileira "Parcelas" do editor da COMPRA.
 *
 * ⚠️ **`1` é "À vista", e ele DISSOLVE o plano** — a parcela 1 sobrevive com o total, as outras
 * somem. Ele não existia, e por isso desfazer um parcelamento significava apagar a compra inteira
 * e lançar de novo. O comentário de `installments.tsx` já dizia "as mesmas opções da criação", e
 * a criação sempre teve "À vista": era a lista que estava incompleta.
 *
 * ⚠️ **Com qualquer parcela travada ele some**, porque a RPC recusa (`1 <> N` cai no guarda que
 * já protege o número de parcelas). Botão que só existe para dar erro é defeito.
 */
export function opcoesDeParcelas(travadas: number): number[] {
  const todas = [1, 2, 3, 4, 6, 10, 12, 18, 24];
  return travadas > 0 ? todas.filter((n) => n > 1) : todas;
}
```

- [ ] **Step 4: a tela usa a lista e confirma antes de dissolver**

⚠️ **Os identificadores do arquivo são outros — confira antes de escrever.** A constante que o
JSX mapeia é `opcoesParcelas` (`:709`), não `OPCOES_PARCELAS` (`:57`); o campo da data no
`FormPlano` chama-se **`inicio`** (`:80`), não `firstOccurredAt`; e dentro de `salvarPlano`
(`:353`) **não existe `plano` em escopo** — só `form`, `lista` e `accounts`. O número ORIGINAL de
parcelas tem que sair de `lista`, porque a essa altura `form.installments` já é `1`.

⚠️ E `opcoesParcelas` (`:448-451`) existe para incluir o número do plano quando ele está FORA da
lista fixa. A função nova entra por baixo dela, não no lugar: `opcoesDeParcelas(travadas)` dá a
base, e a lógica de "inclui o N do plano" continua onde está.

```tsx
  const salvar = () => {
    if (!form) return;
    /**
     * ⚠️ **Desfazer o parcelamento APAGA as outras parcelas**, e o cascade não volta. A régua é a
     * de `design.md §6`: confirmação destrutiva NOMEIA o estrago. A parcela 1 sobrevive com o
     * total — é a mesma linha, com o mesmo `id`.
     */
    if (form.installments === 1) {
      const original = lista.find((p) => p.id === form.id)?.installments ?? 0;
      confirmDestructive(
        'Desfazer o parcelamento?',
        'Desfazer',
        () => editar.mutate(payload(), acoes),
        `As outras ${Math.max(original - 1, 0)} parcelas somem e sobra um lançamento de ${formatBRL(form.totalCents)} em ${formatDateBR(form.inicio)}. Isso não volta.`,
      );
      return;
    }
    editar.mutate(payload(), acoes);
  };
```

(`payload()` e `acoes` são o objeto e os callbacks que o `editar.mutate` já recebe hoje, extraídos
para não existirem em duas cópias.)

⚠️ **O toast de sucesso precisa de frase própria.** O de hoje (`:369-372`) escreveria
**"Wardogs Nuuvem: 1x de R$ 104,99"** depois de dissolver — 1x não é parcelamento. Para
`installments === 1`, a frase é "Desfiz o parcelamento: sobrou um lançamento de R$ 104,99."

⚠️ **O chip com `travado` é código morto e isso é de propósito.** Com parcela travada a fileira
nem é renderizada — o campo vira um `TextField` read-only (`:704-707`). `opcoesDeParcelas` filtra
mesmo assim porque a função é a régua, e régua que só vale quando a tela lembra de aplicar é a
régua que diverge. O teste dela prende o contrato, não o pixel.

⚠️ **Depois de dissolver, o plano NÃO EXISTE mais — e isso já está coberto.** Conferido no
código: quem chega por `?edit=` chamou `volta.marcar()` (`installments.tsx:330`), então o
`volta.aoFechar` do sucesso faz `router.back()` (`use-voltar-quando-fechar.ts:36`) e a tela é
DESMONTADA junto com o `edit=<id>` morto. Quem abriu pela própria lista tem `params.edit`
indefinido, e o reabrir-no-render-seguinte está travado por `edicaoAberta === params.edit`
(`:324`). Nada fica apontando para plano morto. Confirme mesmo assim no device (Tarefa 7 item 5).

- [ ] **Step 5: rodar tudo**

Run: `npm test && npx tsc --noEmit && npx expo lint`

- [ ] **Step 6: commit**

```bash
git add src/lib/finance-form.ts src/lib/finance-form.test.ts src/app/finance/installments.tsx
git commit -m "feat(finance): a compra parcelada volta a ser um lancamento a vista"
```

---

## Tarefa 7: a verificação no emulador e no simulador

**Files:** nenhum. Esta tarefa é prova, não código.

**Por que ela existe:** `design.md §11` — *"verificada no simulador iOS e no emulador Android, em
light e dark"*. E a régua do repo é explícita: mudou tela, confere no device. O teste de tela do
`node --test` prova a lógica; ele não prova que o chip aparece.

⚠️ **O app local aponta para o STAGING** (`.env.local`), e ali existe a conta `dev@proops.local`
com dados de demonstração — botão **"Entrar como teste (dev)"** na tela de login, só em `__DEV__`.
Nada disto encosta em produção.

- [ ] **Step 1: subir**

```bash
cd /Users/gabrielalmeidadias/Documents/Empresas/ProOps/DEV/Personal-ProOps-app
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null; open -a Simulator
npx expo start --dev-client
```

- [ ] **Step 2: a matriz, uma linha por vez, conferindo no banco depois de cada uma**

Depois de cada passo, o estado é lido na fonte (staging), não na tela:

```bash
agent/.venv/bin/python - <<'PY'
import pathlib, psycopg
u = [l.split('=',1)[1].strip() for l in pathlib.Path('agent/.env').read_text().splitlines() if l.startswith('DATABASE_URL=')][0]
with psycopg.connect(u) as c, c.cursor() as k:
    k.execute("""
      select p.id, p.description, p.total_cents, p.installments,
             count(t.id) as linhas, coalesce(sum(t.amount_cents),0) as soma
      from public.installment_plans p
      left join public.transactions t on t.installment_plan_id = p.id
      group by p.id order by p.created_at desc limit 5
    """)
    for r in k.fetchall(): print(r)
PY
```

| # | o que fazer | o que tem que ser verdade |
|---|---|---|
| 1 | criar gasto à vista no cartão | 1 linha, sem plano, com `invoice_id` |
| 2 | criar gasto 3x no cartão | 1 plano, 3 linhas, soma = total, resto na última |
| 3 | **editar o de (1) e escolher 3x** | **1 plano, 3 linhas, e o `id` da linha (1) continua existindo como parcela 1** |
| 4 | editar de novo o mesmo lançamento | a fileira de parcelas NÃO aparece (já tem contrato) |
| 5 | em Parceladas, abrir a compra de (3) e escolher "À vista" | confirma; depois: 0 planos a mais, 1 linha, valor = total, nome sem "(1/3)", e o `id` é o mesmo de (1) |
| 6 | pagar a fatura e tentar editar a compra de (2) | recusa com a mensagem do banco, na tela |
| 7 | apagar uma parcela pelo menu "…" | só ela some; o total do plano deixa de fechar — **isto é o comportamento atual, não mexemos nele nesta entrega** |
| 8 | apagar a compra inteira | plano e parcelas somem juntos |
| 9 | olhar a lista de Lançamentos | compra de cartão com data passada **sem** pílula; conta vencida com "atrasado"; compra futura com "previsto" |
| 10 | repetir 1–3 e 9 em **dark** e com fonte 1,3× | nada corta, nada quebra |

- [ ] **Step 3: Android**

```bash
emulator -avd s26 -no-snapshot-load &
```
Repetir 3, 5 e 9. No Android a `PillTabBar` e o `Modal` são outro código — o `SelectField` e o
`Sheet` já tropeçaram ali antes.

- [ ] **Step 4: limpar o que o teste criou**

```bash
# lista o que nasceu hoje no staging, para apagar pela tela
agent/.venv/bin/python - <<'PY'
import pathlib, psycopg
u = [l.split('=',1)[1].strip() for l in pathlib.Path('agent/.env').read_text().splitlines() if l.startswith('DATABASE_URL=')][0]
with psycopg.connect(u) as c, c.cursor() as k:
    k.execute("select id, description, created_at from public.installment_plans where created_at::date = current_date")
    for r in k.fetchall(): print(r)
PY
```

- [ ] **Step 5: registrar a régua nova**

Acrescentar a `.claude/rules/finance.md`, logo depois da seção "Reparcelar: editar a COMPRA, não a
parcela", uma seção **"Parcelar o que já existe, e desparcelar"** com: a adoção da linha como
parcela 1 (e por quê), a recusa na segunda chamada, a carve-out da parcela 1 `cleared` contra a
trava da fatura, a ordem do dissolve por causa do cascade, e o fato de o histórico de parcelas
pagas continuar sendo só da criação.

E, na seção que fala das telas, a régua do `estadoDaLinha` — "previsto é DATA, nunca `status`",
com o ponteiro para `settle-labels.ts`.

- [ ] **Step 6: commit**

```bash
git add .claude/rules/finance.md
git commit -m "docs(finance): parcelar o que ja existe, desparcelar e o previsto por data"
```

---

## Tarefa 8: revisão de segurança e de regressão

**Files:** nenhum novo.

- [ ] **Step 1: a suíte inteira**

```bash
npx tsc --noEmit && npx expo lint && npm test; echo "saida=$?"
cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q; echo "saida=$?"; cd ..
```

Esperado: saída 0 nos dois blocos.

⚠️ **A lista de testes SQL é a MEDIDA, não `supabase/tests/*.sql` inteiro.** Estes sete foram
rodados pelo runner contra o staging em 20/09/2026 e passam:

```bash
for f in converter_parcelamento reparcelar_a_compra roll_invoice scoped_transaction_edit \
         partial_invoice_payment parcela_paga_no_ciclo regua_e_dia_do_fechamento; do
  agent/.venv/bin/python scripts/sql-test.py supabase/tests/$f.sql || echo "!! $f"
done
```

Esperado: sete `PASSOU:` e nenhum `!!`.

**Os outros 21 arquivos não foram medidos por este caminho**, e pelo menos um (`income_pending`)
reprova por desenho — ele chama `_promote_due_transactions()`, que promove o banco INTEIRO e
devolve a contagem total, então com dado pré-existente a asserção nunca fecha.
`roll_overdue_cron`, `recurring_projection`, `da_para_gastar` e `orcamento_e_graca` têm a mesma
cara de "conta o banco todo" e podem reprovar pelo mesmo motivo. **Reprovação ali não é
regressão desta entrega** — é o runner encostando no limite dele. Quem quiser a suíte inteira
verde precisa do Supabase local (Docker), que é o caminho documentado em `docs/AMBIENTES.md`.

Rodar os 21 é útil como varredura, desde que o resultado seja lido assim:

```bash
for f in supabase/tests/*.sql; do agent/.venv/bin/python scripts/sql-test.py "$f" >/dev/null 2>&1 \
  || echo "reprovou (confira se é banco-cheio): $f"; done
```

- [ ] **Step 2: rodar a skill de revisão**

Invocar `/security-review` e depois `/code-review high` sobre o diff do branch. Os pontos que a
revisão tem que olhar de propósito:

- a RPC nova é `security invoker`? tem `set search_path = public`? tem `revoke ... from public, anon`?
- todo `update`/`delete` dela filtra `workspace_id` além da RLS (o agente Python ignora RLS)?
- a ordem do dissolve (soltar → apagar irmãos → apagar plano) está correta contra o cascade?
- `convert` recusa: linha já parcelada, receita, ocorrência de recorrência, parcela de
  financiamento, sem conta, conta de outro workspace, fatura fechada?
- a invariante "soma das parcelas = total" é conferida nos dois caminhos?
- a reescrita de `update_installment_plan` difere da `20260915210000` só nas mudanças listadas
  na Tarefa 1 Step 3? (`git diff` entre os dois corpos, lado a lado)
- o `perform … for update` nas PARCELAS está antes da medição de `travadas`, nos dois ramos?
- o `delete` dos irmãos tem `and t.id <> sobrevivente`?
- `convert` recusa `rollover_of_invoice_id`? (é o saldo adiado voltando como gasto novo)
- a adoção zera `due_at`?

- [ ] **Step 3: relatar a produção**

Produção **não** recebe nada automaticamente. O que se diz ao Gabriel, com o número em voz alta:

> A migration `20260920120000_parcelar_um_lancamento_que_ja_existe` está aplicada no STAGING.
> Para produção: `PROOPS_PROD_OK=1 npx supabase db push --project-ref kwriuifcwyvdrxtspjiz`,
> rodado por você, e antes dele um `migration list --project-ref` para ver quantas estão
> pendentes. Sem ela, o app novo mostra o chip de parcelar e a chamada volta
> `function does not exist` — então **a migration sobe ANTES do build/OTA do app**.

---

## Auto-revisão

**Cobertura da spec**

| queixa / achado | tarefa |
|---|---|
| 1. não dá para parcelar um lançamento que já existe | 1 (RPC), 4 (hook), 5 (decisão pura), 5b (tela) |
| 2. "duplicou" | 1 — a adoção da linha + a recusa na segunda chamada tornam a duplicação impossível; 5 — `destinoDoSalvar` é exclusivo (nunca converte E salva); 5b — o caminho existir é o que tira a pessoa do "lança de novo" |
| 2b. "veio com a tag previsto" | 2 (régua), 3 (as quatro telas) |
| "em produção falta lançamento" | Diagnóstico — medido, nada falta; nenhuma tarefa |
| desparcelar | 1 (dissolve), 6 (opções + confirmação) |
| achado A (`auto_confirm` apagado) | 5b Step 3 |
| achado B (tipo editável em série) | 5b Step 4 |
| achado C (`paid_at`) | Diagnóstico — o trigger `set_paid_at` já cobre; nada a fazer |
| achado D ("Editar" de parcela) | 3 Step 6 |
| "testes completos, com parcela, sem parcela, editando…" | 1 (SQL, 8 grupos de asserção), 2 e 5 e 6 (funções puras), 3 (regra de anti-slop), 7 (device), 8 (suíte inteira) |
| "prove que não teve regressão" | 0 (runner), 1 "Já foi PROVADO" + Step 5, 3 Step 7, 8 Step 1 |

**Placeholders:** nenhum "TBD"/"similar à tarefa N". Os corpos SQL e TSX estão escritos.

**Consistência de tipos:** `estadoDaLinha` (Tarefa 2) é consumido com a mesma assinatura na
Tarefa 3. `useConvertToInstallments` (Tarefa 4) é chamado na Tarefa 5b com exatamente as oito
chaves declaradas. `podeParcelar`/`temContrato`/`destinoDoSalvar`/`opcoesDeParcelas` (Tarefas 5 e
6) são consumidos com a mesma assinatura nas Tarefas 5b e 6.
`convert_transaction_to_installments` tem a mesma ordem de parâmetros na migration (Tarefa 1), no
teste SQL (Tarefa 1 Step 1) e no hook (Tarefa 4).

**Testes que realmente rodam:** cada tarefa com teste diz em qual suíte ele roda, e as três
tarefas que tocam tela sem harness (3, 5b, 6) dizem explicitamente o que as prende no lugar.
Nenhuma promete um caso no `simple-finance-ui.test.ts` para uma tela que o harness não monta —
esse era o erro da primeira versão deste plano, e ele foi pego rodando o harness, não lendo.

## Fora de escopo (declarado)

- **O agente não parcela nem desparcela pelo WhatsApp.** `FinanceAction` está no teto medido de
  252 (`ai-gemini.md`), e uma frase de uma linha reescrevendo N linhas de dinheiro sem mostrar o
  contrato é o que `docs/AGENTE-PARIDADE-COM-O-APP.md` já excluiu para o reparcelamento. Se
  entrar, entra pelo catálogo de `ResourceAction`, que segue em 5×5 — e vira linha nova naquela
  tabela.
- **Apagar UMA parcela continua deixando o total do plano sem fechar** (item 7 da matriz). É o
  comportamento de hoje, não foi introduzido aqui, e consertá-lo é escopo próprio.
- **O histórico de parcelas já pagas continua sendo só da criação.** Ver a decisão 4 da Tarefa 1.
- **`create_installment_plan_with_history` continua sem chave de idempotência.** Ela é o caminho
  de CRIAÇÃO, e duas chamadas iguais criam dois planos — não há `wa_message_id` equivalente do
  lado do app. Hoje o que segura é a tela: o "Salvar" fica `disabled={saving}` enquanto a mutation
  está pendente e a tela fecha no sucesso. **Não é o caminho que produziu a queixa** — a
  duplicação de 19/09 veio da ausência da porta de conversão, não de um toque duplo —, e fechar
  isso direito pede uma chave de requisição vinda do cliente, que é escopo próprio. Fica
  registrado aqui para não passar por descuido.
