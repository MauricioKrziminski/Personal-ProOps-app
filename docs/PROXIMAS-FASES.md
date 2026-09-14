# Próximas fases — plano de execução

> Escrito em **14/09/2026**, no fim da sessão que arrumou a régua de Lançamentos, a projeção de
> longo prazo e a conciliação da fatura de setembro. Este documento existe para a **próxima
> sessão começar sabendo exatamente o que fazer**, sem precisar redescobrir nada.
>
> **Como usar:** as fases são independentes e estão em ordem de retorno. Dá para fazer uma por
> sessão. Cada fase tem *por quê*, *o que fazer* (com arquivo e assinatura), *as armadilhas* e
> *como verificar*. Não pule a seção "Travas que valem para todas as fases".

---

## Estado do repositório em 14/09/2026

| | |
|---|---|
| Branch | `main`, limpa, tudo commitado e com push |
| Último commit | `e0990aa fix(ui): a condicao do ciclo entra dentro do portao` |
| Migrations no **staging** (`utkqoiigimqzeenxkxdl`) | até `20260914170000` — **em dia** |
| Migrations em **produção** (`kwriuifcwyvdrxtspjiz`) | `20260911220000` — **11 atrás** (contadas no repo; confirme no SQL Editor de produção antes de decidir) |
| `tsc`, `expo lint`, `npm test` | verdes (387 testes) · `pytest` **784** · `ruff` limpo |
| Tags | **nenhuma criada** — é o Gabriel quem cria, depois de testar |

⚠️ **Confirme o número de produção na fonte antes de decidir qualquer coisa com base nele.** No
SQL Editor de produção:

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
```

Esta linha já envelheceu calada duas vezes, nos dois sentidos.

---

## Travas que valem para TODAS as fases

1. **Produção nunca, sem pedido explícito do Gabriel.** Todo `db push` vai para o staging. O hook
   `PreToolUse` bloqueia produção e **um agente não consegue se liberar** — `PROOPS_PROD_OK=1`
   exportado dentro da sessão não chega no hook, que roda em processo próprio. Quem promove é o
   dono do banco.
2. **NÃO crie tags.** Commits sim, tag não. A ordem é: terminar → verificar no emulador/simulador
   → o Gabriel testa → o Gabriel libera a tag.
3. **Commits: conventional, 1 linha, SEM co-autor.** Regra global em
   `~/.claude/rules/git-commit-style.md`.
4. **A trava das projeções continua de pé.** Verbatim do Gabriel:
   > *"tome muito cuidado, eu tinha conseguido finalmente curar uma dor que eu (como usuário que
   > usaria esse app) tinha, de projeções e deixar os valores bem parecidos com os da planilha,
   > onde leva em consideração o saldo acumulativo dos meses anteriores, gastos e receitas
   > previstas, etc., até o fim do ciclo/mês. Se for mexer no que é mostrado, crie uma tela nova
   > que mostre exatamente o que está sendo mostrado hoje."*

   Traduzindo para regra: **o herói do Financeiro e a Projeção mostram o ciclo INTEIRO com saldo
   acumulado, e isso não muda.** Qualquer visão nova é ADIÇÃO, nunca substituição, nunca um toggle
   que faça o mesmo card significar duas coisas.
5. **Antes de commitar:** `npx tsc --noEmit`, `npx expo lint`, `npm test` (olhe o **código de
   saída**, não a contagem — `fail 1` já passou despercebido embaixo de um `pass 329`). Mexeu em
   `agent/` → `.venv/bin/ruff check app --select F,E9` e `.venv/bin/pytest`.
6. **Mexeu em tela → conferir no emulador Android E no simulador iOS**, light e dark. "Deve
   funcionar" não conta.
7. **Os 26 guardas de `src/lib/anti-slop.test.ts` quebram o build.** Os que mais atrapalham quem
   não sabe que existem:
   - zero hex / `rgba()` / `fontSize` / `fontWeight` soltos fora dos dois arquivos de token
   - zero `numberOfLines` fora de uma allowlist de três arquivos
   - toda tela de conteúdo usa `<Screen>`
   - todo `<Sheet>` abre com `<TaskHeader>`
   - `HeaderActions` e `HeaderMenu` nunca na mesma tela (saem de uma chamada só)
   - `Segmented` não passa de 4 opções
   - todo valor monetário em texto visível passa por `<Money>` ou `useBRL()`
   - o resumo e a lista de Lançamentos leem a mesma janela

---

## Fase 0 — Higiene ✅ FEITA em 14/09/2026 (commit `b36f706`)

> A 0.1 foi feita. **A 0.2 continua aberta de propósito** — ela é uma linha da Fase 2, onde o
> alvo `cycle` entra nas duas listas de uma vez; mexer agora seria tocar nos mesmos dois arquivos
> duas vezes.

### 0.1 Apagar `src/types/database.types.ts`

**É uma cópia órfã e DESATUALIZADA do schema.** O arquivo real, que todo mundo importa, é
`src/lib/database.types.ts` (`@/lib/database.types`). Verificado em 14/09/2026:

```
src/lib/database.types.ts     87489 bytes  Sep 13 21:52  ← em dia, é este que o app usa
src/types/database.types.ts   86877 bytes  Sep 13 12:33  ← ninguém importa, e está velho
```

O órfão está **9 horas atrasado**: não tem a coluna `realizado` de `cycle_lines` nem o par
`spendable`/`_spendable`, ambos da `20260913180000`. `grep` por nenhum arquivo importando
`@/types/database` devolve zero resultados, mas ele **está versionado no git**, então quem
procurar uma coluna vai achar a resposta errada. (Aconteceu nesta sessão.)

```bash
git rm src/types/database.types.ts
npx tsc --noEmit   # tem que continuar limpo
```

Conferido em 14/09/2026: **nenhum script do `package.json`, workflow do CI ou doc escreve nesse
caminho** — o único `gen types` documentado aponta para `src/lib/`. Apagar não faz o órfão voltar
na próxima geração. (`docs/PENDENCIAS.md:142` cita um `gen types --project-id` **de produção**, sem
destino de arquivo; é linha velha, de quando os hooks usavam interfaces à mão.)

`src/types/styles.d.ts` **fica** — esse é usado.

### 0.2 Alinhar os alvos de push entre servidor e app

`agent/app/services/push.py` tem `TARGETS = ("today", "reminders", "budgets", "cards",
"forecast")`. `src/lib/notifications.ts` tem `ALLOWED` com **`transactions` a mais**. Um alvo que
existe só de um lado é um caminho morto. Ao mexer aqui na Fase 2, deixe as duas listas iguais.

---

## Fase 1 — "Já caiu" nas linhas do Financeiro ✅ FEITA em 14/09/2026 (commit `cc8f898`)

> Migration `20260914120000`, aplicada **no staging**. O que o plano abaixo não previu, e a tela
> mostrou:
>
> 1. **A sub-linha SOME quando o realizado é igual ao total.** Num ciclo fechado e quitado ela
>    escrevia o mesmo número que o `<Money>` a 60px dela — eco, §1 do design. Visto na tela antes
>    de virar regra: *"já caiu na conta R$ 6.330,62"* debaixo de *"R$ 6.330,62"*. É a mesma
>    decisão que o `mostrarSplit` de `period-summary-card.tsx` já tomava, pelo mesmo motivo.
> 2. **Ciclo `previsto` também não ganha sub-linha** — lá o realizado é zero por definição.
> 3. **A cópia foi para `src/lib/cycle-label.ts`** (`describeRealizado`), ao lado de
>    `describeCycle`, com 6 testes puros — inclusive o da conta oculta, que prova que o valor
>    passa pelo `brl` recebido por parâmetro. Não existe caso PARCIAL nos dados de staging hoje
>    (todo ciclo fechado está quitado e os abertos estão em zero), então essa é a única forma de
>    cobrir o ramo do meio.
> 4. ⚠️ **O corpo vivo de `cycle_series_for` era o da `20260913160000`, não o da `150000`** — a
>    `160000` trocou `em_aberto` para `ci.status <> 'paid'` (fatura adiada conta como "faltou
>    pagar"). Copiar a `150000`, como o plano abaixo sugere, teria revertido isso **em silêncio**.
>    Confira com `pg_get_functiondef` antes de reescrever QUALQUER função.

### Por quê

O Gabriel perguntou se valia um modo "até hoje / o que me sobra" na home do Financeiro. **A
resposta foi: não como modo, sim como sub-linha** — e o motivo importa mais que a conclusão.

Hoje o app responde três perguntas em três telas, e isso foi conquistado com dificuldade:

| tela | pergunta | de onde sai |
|---|---|---|
| **Hoje** | quanto dá para gastar agora | `spendable` |
| **Financeiro** (herói) | como o ciclo vai fechar | `cycle_series` → `describeCycle` |
| **Lançamentos** (card) | o que de fato já saiu | `transactions_summary.pending_cents` |

Um toggle no herói faria o mesmo card significar duas coisas conforme um estado invisível — que é
exatamente o defeito "dois resultados com a mesma cara" corrigido em 13–14/09. **O que falta não é
um modo: é que as linhas `O que entra` / `O que sai` mostram só o total projetado e não dizem
quanto disso já aconteceu.**

### O que fazer

**Migration nova** (`supabase/migrations/2026MMDDHHMMSS_o_ciclo_diz_o_que_ja_caiu.sql`).

Boa notícia: **`private.cash_events` JÁ tem a coluna `realizado boolean`** — entrou na
`20260913180000`. Não há aritmética nova a inventar; é só somar com filtro.

Em `private.cycle_series_for`, no CTE `fluxo`, acrescente duas somas:

```sql
coalesce(sum(x.in_cents)  filter (where x.realizado), 0)::bigint entrou_realizado,
coalesce(sum(x.out_cents) filter (where x.realizado), 0)::bigint saiu_realizado,
```

e propague as duas colunas até o `select` final.

⚠️ **`cycle_series` tem TRÊS assinaturas que se alinham por POSIÇÃO** —
`private.cycle_series_for`, `public.cycle_series` e `public._cycle_series`. Coluna nova entra nas
**três, no mesmo lugar**, ou o PostgREST devolve coluna trocada **sem erro nenhum**. É a mesma
armadilha documentada para `month_summary` em `.claude/rules/finance.md`.

⚠️ **`drop` + `create`, não `create or replace`**: mudar o tipo de retorno de uma função é erro,
não substituição. E ao recriar, **repita `security invoker`/`definer`, `set search_path` e
`set timezone` no CABEÇALHO** — `create or replace` apaga toda cláusula que a definição nova não
repetir, e cláusula pendurada por `alter` morre no replace seguinte. Isso já derrubou o trigger
`set_invoice` e o fuso de `cycle_now`.

Depois:

```bash
npx supabase db push        # confira o alvo antes: scripts/supabase-target.sh
npx supabase gen types typescript --linked > src/lib/database.types.ts
```

**Na tela** (`src/app/(tabs)/finance/index.tsx`, por volta da linha 583): as duas `<Row>` de
`O que entra` / `O que sai` já recebem `trailing={<Money .../>}`. Acrescente a sub-linha usando o
mesmo vocabulário do card de Lançamentos — **"já caiu"** para entrada, **"já saiu"** para saída, e
**"nada ainda"** quando for zero.

> ⚠️ **Correção (14/09/2026, o código ganhou):** esta linha dizia que `period-summary-card.tsx` já
> escreve "já caiu"/"já saiu". Ele escreve **"já aconteceu"** — e é assim que tem que ser: aquele
> card é COMPETÊNCIA e estas linhas são CAIXA. As duas cópias diferem de propósito, e é a lente
> abaixo que separa as duas.

O lugar certo é o `subtitle` da `Row`, que hoje diz "salário, pix e o que mais cai na conta". Duas
opções, escolha ao ver na tela:
- substituir o subtítulo pelo dado (`já caiu R$ 0,00 de R$ 7.566,52`), ou
- manter o subtítulo e somar uma segunda linha.

Prefira a primeira: o subtítulo atual explica o que é a linha, e depois de um mês de uso ninguém
mais lê isso — o número, sim.

> **Escolhido: a primeira, SEM repetir o total.** `já caiu R$ 0,00 de R$ 7.566,52` escreve o
> `<Money>` do lado direito outra vez — o mesmo eco. A sub-linha carrega só a metade realizada, e
> some quando essa metade é o total inteiro.

⚠️ **Escreva a LENTE na cópia: "já saiu **da conta**", não "já saiu".** Estas linhas são caixa
(por data do pagamento) e a vizinha de Lançamentos é competência (por data da compra) — são
números diferentes de propósito. `.claude/rules/finance.md` já obriga a lente a ser escrita quando
ela difere da de um vizinho; é o que "por data da compra" / "por data do pagamento" fazem no card
de Lançamentos.

### Armadilhas

- **Não use `transactions_summary` aqui.** Ela lê só `transactions`; o ciclo inclui fatura,
  parcela de financiamento e recorrente projetada. Misturar as duas recria dois números com a
  mesma cara — o defeito que custou dois dias.
- `<Money>` respeita o "esconder saldo"; texto corrido precisa de `useBRL()`. O guarda
  `'valor em texto visível passa por Money ou useBRL'` quebra o build se esquecer.
- A chave do TanStack é `['cycle-series', de, ate, view]` — muda sozinha com a régua, não precisa
  entrar em `REGUA_MUDOU`.

### Como verificar

⚠️ **NÃO compare com o "já aconteceu" do card de Lançamentos.** São lentes diferentes e os números
**não vão bater, por desenho**: em `cash_events` o ramo 3 filtra `t.invoice_id is null`, então uma
compra de cartão já `cleared` **não** é `realizado` ali — ela só vira caixa quando o `transfer` de
pagamento da fatura acontece (ramo 1). Lançamentos conta a compra; o ciclo conta o pagamento.
Forçar os dois a concordar recria exatamente o defeito "dois números com a mesma cara".

A verificação certa lê a MESMA fonte. No SQL Editor do staging:

```sql
select sum(in_cents)  filter (where realizado) as entrou_realizado,
       sum(out_cents) filter (where realizado) as saiu_realizado
from public.cycle_lines('2026-10-01');
```

1. Os dois números da tela têm que ser **idênticos** a esses. Se divergirem, o `filter` novo em
   `cycle_series_for` não é o mesmo predicado — ou uma das três assinaturas ficou desalinhada.
2. Confirme cruzando com a tela `/finance/cycle` em **"Tudo aberto"**, que lista as linhas uma a uma.
3. Toque `Mês | Ciclo` e confira que os dois números mudam juntos.
4. Aperte o olho (esconder saldo) e confirme que a sub-linha vira `••••••`.

---

## Fase 2 — Fechamento de ciclo ✅ FEITA em 14/09/2026 (commit `9ac4b1c`)

> Migration `20260914140000`, no staging. Quatro coisas que o plano abaixo não previa:
>
> 1. ⚠️ **A ACL de `_alerts_to_send` não se reproduz sozinha, e errar aqui VAZA DADO.** A viva era
>    `postgres=X | service_role=X` — PUBLIC revogado, `service_role` com grant explícito. Um
>    `revoke ... from public` **não basta**: o Supabase mantém `alter default privileges ... grant
>    execute on functions to anon, authenticated`, então a função nova nasceu executável pelas
>    duas. O dry-run mostrou `(True, True, True)` — e essa função devolve **telefone e
>    `expo_push_token` de TODOS os workspaces**, alcançável com a anon key, sem login. Os três
>    nomes vão escritos no `revoke`, mais o `grant` de volta para `service_role`.
> 2. ⚠️ **`target_for("negative_forecast")` devolvia `today`** — o ramo testava
>    `startswith(("balance","forecast"))` e o kind começa com "negative". O aviso *"seu saldo fica
>    negativo — quer ver o que dá pra adiar?"* abria a Hoje, onde não se adia nada. Ramo morto
>    desde sempre; achado ao escrever o teste de `target_for`.
> 3. **A Fase 0.2 virou TESTE, não alinhamento de uma vez** — `src/lib/push-targets-contract.test.ts`
>    lê a `TARGETS` do Python e a `ALLOWED` do app e quebra o build se divergirem. Provado que
>    morde: removendo `cycle` do servidor, o teste falha.
> 4. **`routeFor` saiu para `src/lib/push-routes.ts`** (o padrão de `cycle-routes.ts`): é fronteira
>    de confiança — o `data` é escrito por quem manda o push — e dentro de `notifications.ts` não
>    dava para testar. 7 testes, incluindo `__proto__`, `toString` e path traversal no `ref`.
>
> **Não testado, e é honesto dizer:** push real não chega no emulador (precisa de aparelho
> físico), e o perfil do Gabriel no staging está com push e WhatsApp DESLIGADOS e sem telefone —
> então `_alerts_to_send()` devolve zero hoje e nenhuma mensagem paga foi enviada. O que foi
> provado: a RPC produz a linha certa com o ciclo forçado, o payload sai com `target=cycle` e
> `ref=<fim>`, e o deep link que o `ref` gera abre a tela certa no aparelho.

### Por quê

**Hoje o ciclo fecha em silêncio.** No dia 11, o ciclo anterior terminou, o número final existe no
banco (`cycle_series` com `estado='fechado'`, `caixa_no_fim` e a coluna `confere` provando que a
conta bate no centavo) e **ninguém conta isso ao usuário**.

É a mecânica de retenção mais barata que existe em app financeiro — o "resumo do mês" que o
Mobills, o Organizze e o Monarch mandam —, e aqui o dado já está pronto e o cron já roda. É o
maior retorno por linha de código de todas as fases.

### O que fazer

#### 2.1 A regra, no banco

`public._alerts_to_send()` é uma função `sql stable security definer` que devolve
`(workspace_id, user_id, phone, expo_push_token, alerts_push_enabled, alerts_whatsapp_enabled,
kind, ref, title, body)` a partir de CTEs unidas por `union all`. Hoje são seis: `teste`,
`orcamento`, `fatura`, `conta`, `receita`, `vermelho`.

Acrescente uma sétima: **`fechamento`**.

```
kind  = 'cycle_closed'
ref   = <data de fim do ciclo>::text     -- o dedupe de alerts_sent é (ws, kind, ref, sent_on)
title = 'Setembro fechou'
body  = <ver abaixo>
```

**Gatilho:** o ciclo que terminou ONTEM. Saia de `private.cycle_bounds` com o dia de fechamento do
workspace (`private.cycle_close_day`), e filtre `fim = current_date - 1`. Com `cycle_close_day = 10`
isso dispara no dia 11; com `null` (mês civil), no dia 1º.

**Corpo da mensagem** — o dado sai de `private.cycle_series_for(array[d.workspace_id], m, m, null)`
para o mês que fechou, e de `private.cash_events` para saber o que pesou:

> `Entrou 7.566,52, saiu 8.272,53. Sobrou na conta 0,72. Ficou faltando pagar 3.749,10 (fatura do
> Nubank). Quer ver o detalhe?`

⚠️ **O corpo usa as COLUNAS CRUAS, e nunca uma manchete de "fechou em X".** Qual número lidera um
ciclo fechado é regra do produto e ela mora em **`describeCycle` (`src/lib/cycle-label.ts`)**: com
`faltou_pagar > 0` ele lidera com **−`faltou_pagar`** (a dívida) e manda `caixa_no_fim` para o
rodapé; sem dívida, lidera com `caixa_no_fim`. Escrever essa escolha dentro do SQL é a **segunda
cópia da regra** — e ela diverge: o push diria um número e a tela que ele abre diria outro, que é
literalmente a queixa que criou o `describeCycle` (*"cada lugar fala uma coisa"*, 13/09/2026).

**Na v1, o corpo é a lista de linhas do card `Fechamento` da tela do ciclo, nesta ordem:**
`Entrou`, `Saiu`, `Sobrou na conta` (= `caixa_no_fim`) e, **só quando `faltou_pagar > 0`**,
`Ficou faltando pagar`. Nenhuma manchete, nenhuma escolha entre os dois. Se um dia a manchete
virar requisito, o caminho é **mover a regra para `private.describe_cycle` e o TS passar a chamá-la**
— não duplicar.

Regras de conteúdo, que não são estilo:
- **Todo alerta termina numa ação** (`.claude/rules/finance.md`): "alerta que só informa é o que
  faz o usuário desinstalar no segundo mês".
- **Português sem acento no corpo.** As outras seis CTEs escrevem `'Voce ja gastou'`, `'Ja pagou?'`
  — siga o padrão existente, não misture.
- **Não use `to_char(d, 'TMMonth')` para escrever o nome do mês.** O `lc_time` do Postgres do
  Supabase é `C` e ele sai em INGLÊS ("Saldo em rotativo de July" já aconteceu). Quem traduz é
  **`private.mes_pt`**, array literal.
- **A função precisa de `set timezone to 'America/Sao_Paulo'` no cabeçalho.** Sem isso,
  `current_date` é o dia do UTC e o alerta dispara cedo entre 21h e meia-noite.
- Copie a definição vigente com `pg_get_functiondef` da produção/staging antes de reescrever — é
  assim que a `20260911190000` foi feita, exatamente para não apagar cláusula que ninguém repetiu.

#### 2.2 A entrega

`agent/app/jobs/alerts.py` **não precisa de mudança nenhuma** — ele lê a RPC, reserva em
`alerts_sent` por canal antes de enviar e entrega em push e/ou WhatsApp conforme o usuário
habilitou. Só confira:

- `MAX_ALERTS_PER_USER = 4`. O fechamento é o alerta mais importante do mês e as CTEs são unidas
  em ordem — hoje `teste` vem primeiro "porque é o único aviso com prazo dentro do teto diário".
  **Ponha `fechamento` logo depois de `teste`**, senão no dia 11 ele pode ser cortado por três
  avisos de orçamento.
- `push.target_for(kind)` em `agent/app/services/push.py`: acrescente `if kind.startswith("cycle"):
  return "cycle"`, some `"cycle"` a `TARGETS`, e some `cycle: '/finance/cycle'` a `ALLOWED` em
  `src/lib/notifications.ts`. **As duas listas juntas, ou o toque na notificação não leva a lugar
  nenhum.**
- O WhatsApp usa `wa_alert_template` (template Utility, **pago** fora da janela de 24h). Uma
  mensagem por mês por usuário é custo aceitável; confirme que o dedupe por `ref` (a data do fim
  do ciclo) impede repetição.

#### 2.3 A tela de destino

`/finance/cycle` já existe e já abre com `describeCycle` — a MESMA frase da home — e com a conta
completa (`Comecei com` / `Entrou` / `Saiu` / `Sobrou na conta` / `Faltou pagar`). Ela aceita
`?month=&view=&tipo=`. **Não construa tela nova**: o push deve abrir o mês que fechou.

Para isso o `data` do push precisa levar o mês, não só o `target`. Hoje `push.send` manda
`{"target": target}` e `routeFor` devolve um href fixo. Se quiser o mês certo, a mudança mínima é
`ALLOWED.cycle` virar uma função que lê `data.month` — mas mantenha a **allowlist**: o `data` vem
de fora do app e `router.push` com string livre é porta que não precisa existir. Se isso custar
demais, mandar para `/finance/cycle` sem parâmetro já cai no ciclo corrente, o que é aceitável na
v1 (a tela trata `params.month` ausente de propósito).

### Como verificar

```sql
-- no SQL Editor do STAGING, fingindo que hoje é o dia seguinte ao fechamento
select * from public._alerts_to_send() where kind = 'cycle_closed';
```

Se vier vazio, o gatilho `fim = current_date - 1` não casou — confira o `cycle_close_day` do
workspace de teste. Para forçar, mude temporariamente o dia de fechamento no Perfil.

Depois, ponta a ponta: `docker compose up` no agente e `POST /cron/alerts` com o segredo interno.
Confirme que `alerts_sent` ganhou a linha e que o push chegou no dev build.

⚠️ **O cron do staging está PAUSADO** (`gcloud scheduler jobs`), e é por isso que a recorrente
"Cabelo Marcelao" ficou meses sem materializar. Rodar `/cron/alerts` à mão é o caminho normal aqui.

---

## Fase 3 — Conciliação: o extrato como fonte da verdade ✅ FEITA em 14/09/2026 (commits `16bc21a`, `645f70c`)

> Migrations `20260914160000` (casamento aproximado) e `20260914170000` (conciliação inversa), no
> staging. O que o plano abaixo não previa:
>
> 1. ⚠️ **`near_match` precisa de UNIQUE PARCIAL, senão dois itens do extrato apontam para a mesma
>    transação.** `create unique index ... on import_items (transaction_id) where status =
>    'near_match'`. Sem ele, duas compras de mesmo valor em dias vizinhos casavam as duas com o
>    único lançamento do app — e aceitar as duas correções moveria a data duas vezes.
> 2. ⚠️ **São QUATRO guardas, não uma.** Mesmo valor/`kind`/conta, distância ≤ 5 dias,
>    `candidatos_do_item = 1` **e** `posicao_no_alvo = 1`. As duas últimas são a mesma pergunta
>    pelos dois lados: um item com dois candidatos não sabe qual corrigir, e um alvo disputado por
>    dois itens é o caso do índice acima.
> 3. ⚠️ **`update_transaction_scoped` RECUSA `occurred_at` — de propósito** (`finance.md`: "data é
>    de cada ocorrência e propagar empilharia tudo no mesmo dia"). A correção de data é `update`
>    direto na transação, não a RPC de edição em série. Descobrir isso depois de escrever a
>    chamada custou uma volta.
> 4. **`import_batches.status` aceita `parsing|review|done|failed`** — escrevi `ready` e o check
>    constraint pegou. O valor certo para "lote esperando revisão" é `review`.
> 5. **`create or replace` com a MESMA assinatura de retorno preservou a ACL** de
>    `_prepare_import_batch` — foi conferido com `has_function_privilege` antes e depois, porque
>    mudar o `returns table` obrigaria `drop`+`create`, e aí a ACL iria junto (a lição da Fase 2).
> 6. **O `DocumentPicker` entrou no `semTrancar()` da Fase 4** — escolher arquivo tira o app do
>    primeiro plano no Android e, sem a bandeira, a pessoa voltaria do seletor para um pedido de
>    PIN por cima da tela de importação.
>
> **Não testado, e é honesto dizer:** o OFX real de outubro do Nubank **não foi reimportado** — o
> arquivo não está no repositório e reexportá-lo é do Gabriel. O que foi provado: as quatro
> guardas, nos dois sentidos, com transações de teste criadas para isso (mesmo valor a 3 dias →
> `near_match`; a 6 dias → `pending`; dois candidatos → nenhum casamento), e a contagem de
> transações do workspace **antes e depois: 322 nas duas vezes**.


### Por quê

Esta fase nasce de uma evidência real desta semana. Conciliando a fatura Nubank de outubro (OFX,
23 débitos, R$ 3.660,25) contra o app e contra a planilha do Gabriel:

- o app batia com o OFX **no centavo** em valor, mas tinha **6 lançamentos com data errada**;
- a planilha tinha **3 erros** (juros de R$ 11,10 lançados como despesa quando o banco mandou
  CRÉDITO; IOF 19,89 contra 19,86; rotativo de 371,66 lançado como receita negativa em vez de
  débito no Nubank).

**O app achou tudo isso — mas fui eu quem cruzou, na mão, em SQL.** A conciliação que o Gabriel
faz na planilha é exatamente esse cruzamento, e é a razão de a planilha ainda existir.

O import de hoje faz **metade**: ele olha da direção arquivo → app (marca `duplicate` o que já
existe). Falta a outra metade e falta a tolerância.

### O que fazer

#### 3.1 Casamento aproximado — o que pega as 6 datas erradas

`public._prepare_import_batch(p_batch_id uuid)` (definida na `0019_import_preparation.sql`) marca
duplicata com um `exists` **exato**:

```sql
where t.occurred_at  = i.occurred_at
  and t.amount_cents = i.amount_cents
  and private.normalize_description(t.description) = private.normalize_description(i.description)
```

Data igual, valor igual, descrição normalizada igual. **Um lançamento com data 2 dias fora não
casa** — e é precisamente o erro que existia 6 vezes no app.

Acrescente um **terceiro status**: `near_match` (o `check` da coluna `status` em
`public.import_items` precisa da migration que o inclua — hoje aceita só
`pending|approved|discarded|duplicate`). Critério:

```
mesmo valor  E  |data_app − data_extrato| <= 5 dias  E  não casou exato
```

Guarde o id da transação candidata em `import_items.transaction_id` (a coluna **já existe**).

Na tela de revisão (`src/app/import.tsx`), esses itens viram uma seção própria — **"Parece que já
está lançado, com outra data"** — e cada linha oferece três ações, via `showItemActions`:

| ação | efeito |
|---|---|
| **Corrigir a data no app** | `update` na transação existente para a data do extrato; o item vira `discarded` |
| **São coisas diferentes** | o item volta para `pending` e entra como lançamento novo |
| **Descartar** | `discarded`, nada acontece |

⚠️ **O extrato é a fonte da verdade sobre a DATA, não sobre a categoria.** Corrigir a data não
pode mexer em categoria, conta ou descrição — o usuário já ajustou essas à mão.

⚠️ **Corrigir a data de uma compra de cartão pode trocar a FATURA.** O trigger
`public.tg_transactions_set_invoice()` roda em `update` e recalcula `invoice_id`. Isso é o
comportamento certo (a data passou a ser a real), mas **diga na tela**: "isso move a compra para a
fatura de DD/MM". Foi exatamente o que aconteceu nesta sessão — corrigir 6 datas mudou o card de
Lançamentos de 3.842,78 para 4.017,25 porque 4 linhas entraram na janela do ciclo e 1 saiu.

#### 3.2 Conciliação inversa — o que está no app e não veio no extrato

Depois de aprovar o lote, mostre a lista de **transações do app, na janela de datas do arquivo, na
conta importada, que nenhum item do lote casou** (nem exato, nem aproximado).

Cada uma dessas é uma de três coisas, e o texto da tela deve dizer isso:
- lançamento manual que ainda não caiu no banco (normal, principalmente perto do fim do período);
- lançamento duplicado à mão;
- **erro** — valor ou data que não existem no extrato.

Ações por linha: **"Está certo, deixa"** / **"Apagar"** / **"Abrir"**.

**A janela do arquivo** sai do próprio OFX (`DTSTART`/`DTEND`) ou do min/max de `occurred_at` dos
itens do lote, que é o que funciona também para CSV.

⚠️ **Nada aqui apaga sozinho.** Toda ação destrutiva passa por `confirmDestructive`
(`src/lib/item-actions.ts`), nunca `Alert` cru.

#### 3.3 Onde mexer

| arquivo | o quê |
|---|---|
| migration nova | `status` ganha `near_match`; `_prepare_import_batch` ganha o segundo `update` |
| `agent/app/jobs/importer.py` | nada, se a lógica ficar no SQL — **prefira o SQL**, é onde o dedupe já mora |
| `src/app/import.tsx` | a seção nova + as ações; `paraRevisar`/`repetidos`/`revisados` viram quatro baldes |
| `src/hooks/use-finance.ts` | um mutation para "corrigir a data a partir do extrato" |

### Como verificar

⚠️ **O OFX não está versionado no repositório** (conferido: `find . -iname '*.ofx'` não devolve
nada, e `docs/evidence/` só tem `chat-ui`). **Reexporte a fatura de outubro do Nubank** — é a mesma
que serviu de fonte da verdade na conciliação de 14/09/2026: 23 débitos, **R$ 3.660,25**.

Com as 6 datas já corrigidas nesta sessão, o esperado é:

1. **O lote inteiro cai em `duplicate`** (casamento exato). Se algum cair em `near_match`, a
   correção de data daquele lançamento não pegou — investigue antes de seguir.
2. **A conciliação inversa devolve zero ou uma linha, e qual depende da janela do arquivo.** O
   único lançamento do app fora da fatura é o **DAS de R$ 88,85** (boleto, não cartão) — e ele tem
   data à frente. **Confira o `DTSTART`/`DTEND` do OFX antes de julgar o resultado**: se o DAS cai
   dentro da janela, ele aparece (correto — está no app e não no extrato); se cai depois do
   `DTEND`, o esperado é **lista vazia**. Um resultado sem essa checagem não distingue "funcionou"
   de "o filtro de janela está quebrado".
3. Qualquer coisa **além** dessas é sinal de que o filtro de conta está errado — a conciliação
   inversa tem que olhar só a conta importada, senão ela lista o financeiro inteiro.

---

## Fase 4 — Bloqueio do app por senha ou biometria ✅ FEITA em 14/09/2026 (commit `3375cd0`)

> Sem migration — é tudo aparelho. O que o plano abaixo não previa:
>
> 1. ⚠️ **O acumulador do PIN não pode ser `useState`.** Digitando rápido, os dígitos se perdiam:
>    cada toque lia o estado do render anterior. É `useRef` (`digitado`), com o `useState` só
>    para desenhar as bolinhas.
> 2. ⚠️ **`insets.bottom` devolve 0 no emulador** e o teclado numérico ficava colado na barra de
>    gestos. `paddingBottom: Math.max(insets.bottom, Space.xxl)` — vale para qualquer tela cheia
>    desenhada por cima do sistema.
> 3. ⚠️ **`flex: 1` no texto colapsou a linha do Perfil.** O padrão que funciona já existia e é o
>    `temaRow`; copiá-lo resolveu. (Mesma mecânica de `flexShrink` de `design.md` §3.)
> 4. **O `Segmented` da trava tem 5 opções quando há biometria — e o anti-slop barra acima de 4.**
>    A saída NÃO foi afrouxar o teste: as opções viraram constantes de módulo
>    (`MODOS_COM_BIOMETRIA`, `MODOS_SEM_BIOMETRIA`, `ESPERAS`) e `src/lib/lock-section.test.ts`
>    repõe a checagem sobre elas. Tirar código de dentro do JSX para escapar de um guard é como o
>    guard morre.
> 5. **React Compiler barrou duas coisas**: `setState` síncrono dentro de efeito (resolvido
>    partindo `LockOverlay`/`Tela`, para montar já ser o reset) e `Date.now()` em render (o relógio
>    da espera foi para `lock-secret.ts`, onde a contagem de erros já morava).
> 6. ⚠️ **`uiautomator dump` inclui view COBERTA.** Ler os primeiros textos do dump com o overlay
>    aberto devolve a tela de baixo — foi assim que eu quase reportei "qualquer PIN destrava" como
>    falha de segurança, sendo erro meu de medição. Presença de texto no dump **não** é prova de
>    que a tela está visível; quem prova é log instrumentado ou o screenshot.
>
> ### ⚠️ O DESENHO MUDOU no mesmo dia: a senha é a DO CELULAR
>
> Decisão do dono do produto, 14/09/2026, depois de ver a primeira versão rodando:
>
> > *"a senha que eu queria é a que já usa no celular, igual bancos como banco do brasil,
> > nubank, e outros usam. Ele usa a própria senha do celular e se tiver biometria ou faceID
> > cadastrado ele reaproveita"*
>
> A linha que faz isso é **uma**: `disableDeviceFallback: false` (o default) em vez de `true`. No
> iOS isso troca `LAPolicyDeviceOwnerAuthenticationWithBiometrics` por
> `LAPolicyDeviceOwnerAuthentication`, que tenta o Face ID e cai sozinho na senha do aparelho; no
> Android o `BiometricPrompt` passa a aceitar a credencial do aparelho. Com ela, **todo o resto
> saiu**: `lock-secret.ts` (PIN salgado no SecureStore), a contagem de erros, a espera de 30s, o
> teclado numérico do overlay e o sheet de "trocar a senha". Menos 240 linhas, e uma senha a
> menos para o usuário decorar — mais o caminho de recuperação, que deixou de ser problema nosso.
>
> - **`expo-secure-store` ficou no `package.json` e no `app.json` sem nenhum uso em `src/`.** Ele
>   existia para o `lock-secret.ts`, que saiu. Tirar a dependência exige rebuild nativo (é plugin),
>   e não vale um rebuild só por isso — mas ela está aqui escrita para não virar mistério: se um
>   dia houver outro rebuild, ela sai junto.
> - **`LockMode` virou `off` | `on`.** Preferência gravada como `'pin'` ou `'biometric'` cai em
>   `off` na leitura — falha ABERTA de propósito: trancar o app num modo que não existe mais não
>   tem saída.
> - **`getEnrolledLevelAsync() === NONE` esconde o controle.** Celular sem bloqueio de tela não
>   consegue autenticar ninguém, e ligado ali o app ficaria trancado para sempre — não há PIN
>   nosso para servir de saída. A tela explica o que fazer em vez de mostrar o controle.
> - **O overlay virou uma CORTINA**, não um teclado: `Aurora` (três massas de luz em Skia, uma
>   passada de blur, movidas por transform num relógio só) + `Keyhole` (disco de vidro com a marca
>   dentro, que É o botão) + a frase que conta o estado. Uma ação só na tela.
>
> **Verificado nas duas plataformas, no aparelho:**
>
> | caso | iOS | Android |
> |---|---|---|
> | sem biometria cadastrada, a opção some | ✅ | ✅ (diz "a senha do celular") |
> | com biometria, a opção aparece | ✅ Face ID | — (emulador não inscreve digital) |
> | biometria certa abre | ✅ Matching Face | — |
> | biometria errada mantém trancado | ✅ Non-matching Face | — |
> | **a senha do APARELHO abre** | — (simulador sem senha) | ✅ prompt "Desbloquear o app" + PIN |
>
> ⚠️ **O módulo nativo não estava no APK de Android** (`Cannot find native module
> 'ExpoLocalAuthentication'`) — o autolinking do Gradle estava com estado velho e a Fase 4 nunca
> rodou de verdade ali. `expo run:android` depois de apagar `android/**/generated/autolinking`
> resolveu. **Mexeu em dependência nativa → rebuild do APK**, senão o app serve um bundle antigo
> em silêncio e todo diagnóstico feito em cima dele é inventado.


### Por quê

O app mostra saldo, dívida, patrimônio e a projeção de quando o dinheiro acaba. Hoje **qualquer um
que pegue o celular desbloqueado vê tudo**. O "esconder saldo" existe e funciona, mas
`src/components/ui/conceal.tsx` já documenta o furo, no próprio código:

> *"o padrão completo pede biometria para revelar (esconder é livre) — quem consegue olhar a tela
> também consegue tocar nela."*

Todo app financeiro consolidado tem trava própria, independente da do sistema.

### O que instalar

**`expo-local-authentication` NÃO está instalado.** `expo-secure-store` está (já é plugin no
`app.json`) e é onde o PIN vai.

```bash
npx expo install expo-local-authentication
```

`app.json` → `plugins`:

```json
[
  "expo-local-authentication",
  { "faceIDPermission": "Permite abrir o $(PRODUCT_NAME) com o Face ID." }
]
```

⚠️ **Exige rebuild nativo.** O `USE_BIOMETRIC` do Android entra pelo plugin, e o
`NSFaceIDUsageDescription` do iOS também — nada disso chega por OTA. Depois de instalar:
`npx expo prebuild --clean` (se houver `android/`/`ios/` locais) e um dev build novo. **Sem o
rebuild, `hasHardwareAsync()` responde e `authenticateAsync()` falha em silêncio no iOS.**

### API do SDK 57 (conferida na doc versionada)

```ts
import * as LocalAuthentication from 'expo-local-authentication';

await LocalAuthentication.hasHardwareAsync();                 // tem sensor?
await LocalAuthentication.isEnrolledAsync();                  // tem digital/face cadastrada?
await LocalAuthentication.supportedAuthenticationTypesAsync();// [FINGERPRINT|FACIAL_RECOGNITION|IRIS]
await LocalAuthentication.getEnrolledLevelAsync();            // SecurityLevel
await LocalAuthentication.authenticateAsync({
  promptMessage: 'Desbloquear',
  cancelLabel: 'Usar senha',
  disableDeviceFallback: true,      // o fallback é o NOSSO PIN, não o do sistema
  fallbackLabel: 'Usar senha',      // iOS
  requireConfirmation: false,       // Android
  biometricsSecurityLevel: 'strong',// Android
});
await LocalAuthentication.cancelAuthenticate();               // Android
```

`AuthenticationType`: `FINGERPRINT=1`, `FACIAL_RECOGNITION=2`, `IRIS=3` (Android).
`SecurityLevel`: `NONE=0`, `SECRET=1`, `BIOMETRIC_WEAK=2`, `BIOMETRIC_STRONG=3`.

### O desenho

**Três estados de configuração, gravados no `AsyncStorage` (a preferência) + `SecureStore` (o
segredo):**

| estado | o que acontece ao abrir |
|---|---|
| `off` (padrão) | nada — é o comportamento de hoje |
| `pin` | pede o PIN de 6 dígitos |
| `biometric` | tenta a biometria; falhou ou cancelou → cai no PIN |

⚠️ **O PIN é obrigatório mesmo quando a biometria está ligada.** Digital falha molhada, Face ID
falha no escuro, e o usuário pode trocar de aparelho. Biometria sem fallback próprio é como se
tranca alguém fora dos próprios dados. Por isso `disableDeviceFallback: true` — o fallback é o
nosso, não o do sistema.

⚠️ **O PIN nunca vai para o `AsyncStorage`.** Guarde **o hash** no `SecureStore` (Keychain no iOS,
Keystore no Android). Um PIN de 6 dígitos tem 1 milhão de combinações — sem salt e sem custo, o
hash é quebrado numa tabela. Use salt aleatório por instalação, **e trate isso como o que é:
proteção contra quem pegou o celular, não contra quem extraiu o dispositivo.** Documente essa
limitação no cabeçalho do arquivo, como o `conceal.tsx` documenta a dele.

⚠️ **`expo-crypto` também NÃO está instalado** (conferido no `package.json` em 14/09/2026) —
`npx expo install expo-crypto`, na mesma leva do `expo-local-authentication`, para o rebuild
nativo ser um só.

⚠️ **Com `disableDeviceFallback: true`, o toque em "Usar senha" volta como
`{ success: false, error: 'user_fallback' }`, não como erro.** Esse é o sinal de abrir o nosso PIN.
Tratar tudo que não é `success` como falha deixa o botão morto — e é o caminho que mais gente usa
quando a digital não pega de primeira.

**Onde o portão mora:** `src/app/_layout.tsx` já tem o padrão exato —
`<AnimatedSplashOverlay ready={!loading && fontsLoaded} />` é um overlay acima de tudo. O
`LockOverlay` entra como irmão dele, dentro dos providers (precisa de `useTheme`) e **acima do
`<Stack>`**.

**Quando pede de novo:** `AppState` volta a `active` depois de N segundos em background. O padrão
do nicho é **imediato** ou 30/60s; ofereça as duas e comece em imediato. Os dois listeners de
`AppState` que já existem estão em `src/app/_layout.tsx:70` e `src/hooks/use-app-update.tsx:155` —
siga o mesmo formato.

⚠️ **`AppState` no Android dispara `background` ao abrir o seletor de arquivos e a câmera.**
O import (`DocumentPicker`) e a foto de cupom passam por ali. Sem um bypass, importar extrato
trancaria o app no meio da operação. Marque uma flag antes de abrir o picker.

⚠️ **O portão não substitui o login.** Ele fica DEPOIS do `Stack.Protected` do `useSession`: sem
sessão, não há o que trancar. E o "esquecer o PIN" é **sair da conta** — não invente recuperação
própria, o Supabase Auth já tem a dele.

**A tela de configuração** vai no Perfil, junto com o "esconder saldo", que hoje mora lá. A trava
ligada deve também ligar `concealed` por padrão? **Não** — são coisas diferentes: a trava protege
quem abre o app, o olho protege quem olha por cima do ombro. Deixe independentes.

### Como verificar

- iOS: `xcrun simctl` não tem Face ID por linha de comando de forma confiável — use o menu
  **Features → Face ID → Enrolled** e **Matching Face**, com o app em primeiro plano.
- Android: `adb -e emu finger touch 1` simula a digital no emulador.
- Os dois casos que precisam funcionar e sempre esquecem: **biometria cancelada** (tem que cair no
  PIN, não travar) e **aparelho sem biometria cadastrada** (`isEnrolledAsync() === false` → a opção
  nem aparece na tela de configuração).
- Confirme que o app **não pede o PIN** ao voltar do `DocumentPicker`.

---

## Fase 5 — Loaders e skeletons uniformes ✅ FEITA em 14/09/2026 (commits `720eb09`, `e921182`, `374d1ad`)

> Sem migration. O que o plano abaixo não previa:
>
> 1. ⚠️ **O portão precisa de TRAVA, e sem ela a cura é pior que a doença.** `isPending` não quer
>    dizer "primeira carga", quer dizer "sem dado para esta CHAVE": trocar o mês no Financeiro
>    devolve `pending` a três consultas, e um portão sem trava apagaria a tela inteira —
>    incluindo a carteira, as dívidas e a tendência, que não dependem do mês. Seria a pipoca ao
>    contrário: em vez de blocos chegando fora de hora, blocos SUMINDO. Daí a divisão em dois:
>    `lib/tela-pronta.ts` é a regra pura (testada), `hooks/use-tela-pronta.ts` é a trava.
> 2. ⚠️ **Por isso os portões de cada bloco FICARAM.** O plano dizia "em vez de cinco portões
>    espalhados"; o certo é o portão de fora cobrir a primeira carga e os de dentro cobrirem a
>    troca de mês.
> 3. ⚠️ **`fetchStatus` em vez da regra "não passe query desligada".** O plano resolvia a
>    armadilha do `enabled: false` por disciplina de quem chama; `telaPronta` resolve por
>    construção (`!isPending || fetchStatus !== 'fetching'`). Foi conferido no fonte do TanStack:
>    o `getOptimisticResult` já devolve `fetching` no primeiro render de uma query ligada, então
>    não há janela em que uma normal seja confundida com uma desligada. Isso liberou passar `list`
>    em Lançamentos e `invoice` no detalhe do lançamento — as duas nascem desligadas.
> 4. **A cascata virou prop do `Screen`** (`stagger`), não código de tela. A Hoje era a única que
>    escalonava, com passo próprio e um `index` mantido à mão; agora são oito telas com um passo
>    só. `scroll={false}` não recebe a cascata: ali o filho precisa ser a raiz, senão morre o
>    large title (o defeito de 11/09/2026).
> 5. ⚠️ **A cascata PRECISA repetir o `gap` do container, e isso é bug medido.** Um filho pode ser
>    um `<>…</>` com vários blocos; embrulhado, ele vira uma caixa só e o espaço que o `gap` dava
>    ENTRE eles some. Visto no Patrimônio: o rótulo "O QUE FORMA ESSE NÚMERO" encostou no herói.
>
> 6. ⚠️ **Condição que não é consulta entra DENTRO do portão, nunca com `&&` do lado de fora.**
>    O Financeiro e Lançamentos nasceram com `useTelaPronta(...) && range.pronto` — e do lado de
>    fora a condição escapa da trava: trocar o mês dá chave nova a `cycle-range`, `range.pronto`
>    volta a `false` e a tela INTEIRA vira skeleton, inclusive o seletor de mês que a pessoa
>    acabou de tocar. É exatamente a pipoca ao contrário do item 1, entrando pela porta dos
>    fundos. `telaPronta` passou a aceitar `Consulta | boolean`, e a condição virou argumento.
>
>    **Provado nos dois sentidos no emulador**, com a rede cortada (`svc wifi disable`) para
>    `range.pronto` ficar `false` tempo suficiente de ver: com o `&&` fora, tocar "›" apagava a
>    tela toda (sobrou a dock); com a condição dentro, o seletor, o `Mês | Ciclo` e os blocos
>    ficam de pé, cada bloco com o próprio "Algo deu errado · Tentar de novo" — que é o §7.
>
> **Verificado no aparelho**: Financeiro, Hoje e Patrimônio no emulador Android (medindo as
> bordas com `uiautomator`, não a olho) e Financeiro + Hoje no simulador iOS. Zero sobreposição,
> zero salto de layout. A troca de mês com rede cortada foi verificada depois, no item 6.
>
> **Não é "zero pipoca" em toda tela, e o caso é um só**: no detalhe do lançamento (`[txId]`) a
> consulta da fatura só liga depois de a transação chegar, e ela não tem skeleton próprio — o
> bloco da fatura aparece depois do resto. O portão cobre a primeira carga da tela; esse bloco
> continua entrando sozinho.
>
> **Não feito, e é decisão**: o shimmer em Skia do §5.4. O plano já mandava avaliar o custo — o
> pulso de opacidade atual resolve, e shimmer é enfeite num estado que existe justamente quando o
> aparelho está ocupado. `notes/[id].tsx` também ficou fora: é um EDITOR, o corpo já tem skeleton
> com a forma do texto, e a segunda consulta (pastas) alimenta um seletor que pode nem ser aberto.


### Por quê

Queixa literal do Gabriel:

> *"o que eu mais vi nesse app é tendo loader skeleton em alguns componentes e durante o skeleton
> de um componente, o outro já está montado e pronto"*

E ele está certo. Medido em 14/09/2026:

| tela | hooks de dados | blocos com skeleton |
|---|---|---|
| `(tabs)/finance/index.tsx` | **14** | 5 |
| `finance/transactions.tsx` | 9 | 5 |
| `finance/forecast.tsx` | 8 | 5 |
| `(tabs)/today/index.tsx` | 8 | 2 |
| `(tabs)/notes/index.tsx` | 7 | 4 |
| `(tabs)/profile/index.tsx` | 7 | 3 |
| `finance/net-worth.tsx` | 6 | 5 |
| `finance/budgets.tsx` | 6 | 4 |

No Financeiro são **14 consultas e 5 portões**: nove blocos simplesmente aparecem quando ficam
prontos, cada um no seu tempo. O resultado é a pipoca que ele viu — o herói preenche, 300 ms depois
a carteira de cartões salta, depois o gráfico, depois a lista.

O defeito tem duas metades e as duas precisam de resposta:
1. **cada bloco decide sozinho** quando parar de carregar;
2. **nove blocos não têm skeleton nenhum** e entram com um salto de layout.

### O que fazer

#### 5.1 Um portão por tela, não por bloco

Crie **`useTelaPronta(...queries)`** em `src/hooks/` (ou `src/lib/`):

```ts
/**
 * A tela só sai do carregamento quando TODAS as consultas dela terminaram.
 *
 * ⚠️ É `isPending`, não `isLoading`. Com uma query `enabled: false` — o caso de
 * `useTransactions` enquanto a janela do ciclo não resolveu — `isLoading` é `false`
 * com zero linhas, e a tela pisca "Nada em outubro" antes de ter perguntado.
 */
export function useTelaPronta(...qs: { isPending: boolean }[]): boolean {
  return qs.every((q) => !q.isPending);
}
```

⚠️ **`isPending`, não `isLoading`.** Isto já mordeu nesta sessão: com a query gated por
`enabled: false`, `isLoading` é `false` e a tela mostrou "Nada em outubro" com dados existindo.

⚠️ **E por isso mesmo: NUNCA passe para cá uma query que pode nascer desligada.** No TanStack v5,
`enabled: false` deixa a query em `status: 'pending'` com `fetchStatus: 'idle'` **para sempre** —
`isPending` nunca vira `false` e a tela **fica no skeleton eternamente**. Os casos que existem hoje:
`useInvoice(undefined)` em `cycle.tsx` (só busca quando a fatura é expandida) e `useTransactions`
enquanto `range.pronto` é `false`. Para esses, o portão é a **condição**, não a query:

```ts
const pronta = useTelaPronta(summary, cycle, accounts) && range.pronto;
```

Regra curta: **só entra em `useTelaPronta` a query que a tela SEMPRE roda.** Query condicional
desenha o próprio estado, no bloco dela.

⚠️ **Não espere `isFetching`.** Refetch de fundo (realtime, voltar do background, pull-to-refresh)
não pode trazer o skeleton de volta — a tela já tem conteúdo. O portão é só a PRIMEIRA carga.

#### 5.2 Um skeleton com a forma da tela

`src/components/ui/skeleton.tsx` hoje tem `Skeleton` (bloco) e `SkeletonRow` (linha). Falta o
nível acima: **a forma da tela inteira**. Acrescente composições prontas, uma por arquétipo:

| composição | desenha | usada por |
|---|---|---|
| `SkeletonHero` | rótulo + número grande + faixa | Financeiro, Hoje |
| `SkeletonList` | `SkeletonRow` × n dentro de um `Section` | Lançamentos, Notas, Contas |
| `SkeletonChart` | bloco de 140 + legenda | Tendência mensal, Projeção |
| `SkeletonCards` | a pilha da carteira | Cartões |

Cada tela passa a ter **um** `if (!pronta) return <Screen>{...formas}</Screen>`, em vez de cinco
portões espalhados.

#### 5.3 Entrada escalonada, não pipoca

Quando o portão abre, os blocos entram com **um stagger curto** — `FadeInDown.delay(i * 40)` do
Reanimated, que o `import.tsx` já usa. Cinco blocos × 40 ms = 200 ms de cascata: lê como "a tela
montou", não como "as coisas chegaram atrasadas".

`Motion.duration.base` (200) e `Motion.easing.out` são os tokens. **Nada de `400` literal.**

#### 5.4 Onde vai skeleton e onde vai spinner

A regra do design (§7) é **"skeleton com a forma do conteúdo final; nunca spinner de tela cheia
para atualização parcial"**. Traduzindo para a decisão de cada caso:

| situação | o quê |
|---|---|
| primeira carga de uma tela | **skeleton** com a forma final |
| paginação (`fetchNextPage`) | **spinner pequeno no rodapé da lista** |
| pull-to-refresh | o `RefreshControl` nativo, que o `Screen` já liga |
| mutation em andamento (salvar, aprovar lote) | **`Button loading`** — que desenha a espiral da marca |
| ação de item (dar baixa, apagar) | nada visual além do otimismo + toast no erro |

**O spinner "moderno" deste app já existe e é a espiral da marca** (`src/components/ui/mark.tsx`,
geometria em `src/design/mark-path.ts`) — `Button loading` já a usa. `.claude/rules/design.md`
lista isso como um dos cinco papéis da marca e como o que "dá personalidade sem cor". **Não
importe biblioteca de spinner e não use `ActivityIndicator` cru**: seria o sexto vocabulário para
a mesma coisa.

Para o shimmer do skeleton, o pulso de opacidade atual (`0.4 → 0.9`, 700 ms) é discreto demais
para ler como carregando num card grande. Uma varredura diagonal de brilho é o padrão moderno e
sai de graça: `SkiaCanvas` já está no projeto (`src/components/ui/skia-canvas.tsx` — e o guarda
`'nenhum Canvas do Skia fora de ui/skia-canvas.tsx'` obriga a passar por ele), com
`GradientSurface` já feito para o `HeroPanel`. **Avalie o custo**: skeleton é o que roda enquanto o
aparelho está ocupado buscando dados; um shimmer caro piora justamente o momento que ele decora. Se
o Skia pesar, um `translateX` de um gradiente com `transform` em worklet resolve.

#### 5.5 Ordem de trabalho

Pela dor: **Financeiro → Lançamentos → Hoje → Projeção → Patrimônio → Orçamentos → Notas →
Perfil**. As três primeiras são as que o Gabriel abre todo dia.

### Como verificar

**Mate a velocidade da rede, senão o defeito é invisível no emulador.**

```bash
# Android: latência alta no emulador
adb shell settings put global captive_portal_mode 0
# ou, mais direto: Extended Controls → Cellular → Network type: Full → Data status: Roaming
```

No simulador iOS, use o **Network Link Conditioner** (perfil "3G" ou "Very Bad Network").

Depois: abra cada tela com cache frio (`queryClient.clear()` ou reinstalar) e **grave o vídeo**. A
régua é a do `.claude/rules/design.md` §11: *"zero frame de cor errada, zero salto de layout"*.
Nenhum bloco pode aparecer enquanto outro ainda mostra skeleton.

---

## Fase 6 — Planos, limites e preço *(por último, depois de tudo)*

> ### 🟡 Parcial em 14/09/2026 — o que é CÓDIGO foi feito; o resto depende do Gabriel
>
> Esta fase é **medição + decisão de preço**, e as duas metades têm donos diferentes.
>
> **Feito (commit `fb1756a`): o expurgo dos checkpoints do LangGraph.** O plano abaixo mandava
> "veja se há política de expurgo" — não havia nenhuma, e a medição mostrou por que isso importa:
>
> | tabela | staging, 14/09/2026 |
> |---|---|
> | `langgraph.checkpoint_writes` | 8,5 MB |
> | `langgraph.checkpoints` | 6,2 MB |
> | `langgraph.checkpoint_blobs` | 3,6 MB |
> | **as três** | **18 MB de um banco de 35 MB** |
>
> Metade do banco, com duas semanas de tráfego de TESTE. O teto da camada gratuita é 500 MB.
>
> A régua não precisa de data: sobrevive o thread que é a época ATUAL de alguma sessão viva
> (`security.effective_thread_id`), e todo o resto é conversa que o produto já esqueceu — subir o
> epoch é o app dizendo isso. Medido: 11 vivos contra 231 mortos. `agent/app/jobs/checkpoints.py`,
> pendurado no cron diário de alertas (como o `sweep` pega carona no de lembretes), com teto de
> 500 threads por execução e a trava de `pending_actions` no SQL. Rodado de verdade no staging:
> 231 threads, 2.984 checkpoints, 16.747 writes e 6.969 blobs apagados, **os 11 vivos intactos**.
>
> ⚠️ `pg_total_relation_size` não encolhe sem `VACUUM FULL`, que trava a tabela e não cabe num
> cron. O espaço vira reutilizável pelo autovacuum; o que este job garante é que o crescimento
> **para**, não que o número na tela caia hoje.
>
> **O que falta, e por que precisa do Gabriel:**
>
> | o quê | por quê não dá para eu fazer |
> |---|---|
> | fatura do GCP por SKU | console de billing, conta dele |
> | custo unitário do Gemini | Langfuse, e separar o que foi suíte do que foi usuário |
> | proporção clicado × digitado no gate | precisa de tráfego real, não de staging |
> | os limites de cada plano | decisão de produto em cima dos números acima |
> | **o preço** | App Store Connect / Play Console + RevenueCat — **nenhum preço entra no código** |


### Por quê por último

Preço se define com **custo medido de uso real**, e o uso real só existe depois das fases
anteriores estarem no ar. Hoje o número de cada plano é um chute de 29/08/2026 que nunca foi
conferido contra a fatura do GCP.

### O que existe hoje

`private.plan_limits(p_plan text)` (`0029_subscriptions_and_invites.sql`) — **três dimensões, três
planos, valores literais numa tabela `values`**:

| plano | max_members | max_ai_messages_month | can_import |
|---|---|---|---|
| `free` | 1 | 100 | false |
| `pro` | 3 | 1000 | true |
| `family` | 5 | 2000 | true |

`private.plan_status_for(ws_id)` junta plano + consumo + limites numa chamada; serve a tela
(`finance/plan.tsx`, `paywall.tsx`) **e** o gate da IA em `agent/app/conversation.py:82`.

**Preço não existe em lugar nenhum do código** — ele vem da loja via RevenueCat `getOfferings()`
(`docs/IN-APP-PURCHASE.md`). Ou seja: definir preço é decisão de produto + configuração na App
Store Connect / Play Console, **não** uma mudança de código.

⚠️ O consumo mensal é `count(*)` de `ai_events`. **O agente que não gravar lá derruba o paywall em
silêncio** — e as suítes de avaliação (`evaluate_answer_forms.py`, os `probe_*`) **não gravam em
`ai_events`**, então elas custam dinheiro e não aparecem em contagem nenhuma. Isso distorce
qualquer medição que confunda "chamadas da conta" com "chamadas dos usuários".

### Como levantar o custo real

#### 1. GCP (Cloud Run + Cloud Tasks + Cloud Scheduler)

Projeto `personal-proops-agent`, região `southamerica-east1`, serviço `agente`:
`--cpu 1 --memory 1Gi --min-instances 0 --max-instances 10 --concurrency 80`.

```bash
gcloud billing accounts list
gcloud beta billing projects describe personal-proops-agent
# o detalhe por SKU só sai no console:
#   console.cloud.google.com/billing/<ID>/reports  → agrupe por SKU, filtre o projeto, 90 dias
```

**O que olhar, e por quê cada um:**
- **Cloud Run**: com `min-instances 0` você paga por request e por tempo de CPU. O que segura o
  container acordado não são os usuários — é o **cron de lembretes de 1 em 1 minuto**, que acorda
  1.440×/dia. Esse é custo **fixo**, independente de quantos usuários existem, e precisa sair da
  conta por usuário antes de qualquer divisão.
- **Cloud Tasks**: uma task por mensagem (o debounce de 3s). Escala com uso.
- **Cloud Scheduler**: 3 jobs. Irrisório, mas conte.

#### 2. Gemini

A tabela de modelo por papel está em `agent/app/services/gemini.py` (`MODELOS`) e a régua de custo
em `.claude/rules/ai-gemini.md`:

| papel | modelo | volume | cota grátis |
|---|---|---|---|
| `router` + `parse` | `gemini-3.1-flash-lite` | **2 chamadas por mensagem** | 500/dia |
| `gate` | `gemini-3.7-flash` | só em confirmação DIGITADA | **20/dia** |
| `batch` | `gemini-3.1-flash-lite` | 1 por importação | 500/dia |

**A conta por usuário/mês, com números reais:**

```sql
-- mensagens de IA por workspace, últimos 90 dias
select workspace_id, date_trunc('month', created_at) mes, count(*)
from public.ai_events group by 1, 2 order by 2 desc, 3 desc;
```

⚠️ **Medido em 09/09/2026: produção tinha 29 chamadas em `ai_events` desde que existe, e o staging
130 — e mesmo assim 04/09 custou R$ 10.** Quem gastou foram as suítes, não os usuários. **Não
divida a fatura do Gemini pelo número de usuários sem separar o que foi teste.** O Langfuse tem o
trace por nó e por tokens; é a fonte melhor para custo unitário.

**O `gate` em Flash é o risco de custo que escala mal**: 20/dia grátis, e ele dispara em toda
confirmação digitada (não clicada). Se o produto crescer, ou o gate vira pago de verdade, ou os
botões precisam cobrir mais casos. Vale medir a proporção clicado × digitado antes de precificar.

#### 3. Supabase

Hoje na camada gratuita. Os tetos que importam e o que os estoura primeiro:
- **500 MB de banco** — a tabela que cresce é `transactions` (12 linhas/série recorrente/ano ×
  séries × usuários) mais os checkpoints do LangGraph no schema `langgraph`, que guardam o conteúdo
  das conversas. **Os checkpoints são o que estoura primeiro**; veja se há política de expurgo.
- **2 GB de egress**
- **50.000 MAU** de Auth
- Realtime: mensagens simultâneas

```sql
-- o que ocupa espaço
select schemaname, relname, pg_size_pretty(pg_total_relation_size(relid)) tam
from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 20;
```

#### 4. WhatsApp (Meta Cloud API)

- Texto livre **dentro** da janela de 24h: **grátis**. É onde 100% das confirmações caem.
- Proativo **fora** da janela: template Utility, **pago por mensagem**. Hoje isso é: lembretes,
  alertas (`wa_alert_template`) e — se a Fase 2 for adiante — o fechamento de ciclo.
- **Push (Expo) é grátis** e é o canal proativo preferido. O WhatsApp é complemento.

Conte o proativo real:

```sql
select kind, channel, count(*) from public.alerts_sent
where sent_on >= current_date - 30 group by 1, 2 order by 3 desc;
```

### O que decidir com esses números

1. **Custo marginal de um usuário/mês** = (Gemini por mensagem × mensagens dele) + (templates pagos
   dele) + fração de Cloud Run atribuível. **O custo fixo do cron entra à parte** — ele não cresce
   com o usuário e não pode ser diluído em um só.
2. **O limite do Free é o que o custo marginal aguenta com zero receita.** As 100 mensagens/mês de
   hoje são um chute; com o Flash-Lite a 500/dia grátis, pode ser generoso demais ou de menos, e só
   a medição diz.
3. **O que separa Free de Pro tem que ser o que CUSTA, não o que é bonito.** Hoje só três coisas
   distinguem (membros, mensagens de IA, importação). Candidatos a dimensão nova, todos com custo
   real atrás: horizonte da projeção (10 anos custa 68 ms de banco), alertas proativos por
   WhatsApp (template pago), número de cartões/contas (não custa nada — **não use isso como
   limite**, é o tipo de trava que faz o usuário ir embora sem nunca considerar pagar).
4. **Preço**: pesquise Mobills, Organizze e Minhas Economias no mercado brasileiro. Depois defina
   na loja e deixe o RevenueCat entregar — **nenhum preço entra no código**.

⚠️ **Cancelamento continua sendo uma chamada, sem formulário** (`cancel_subscription`).
"Dificultar cancelamento é a reclamação nº 1 contra os concorrentes no Reclame Aqui" — está em
`.claude/rules/finance.md` e não muda com o preço novo.

### Onde mexer

| arquivo | o quê |
|---|---|
| migration nova | `private.plan_limits` com os números novos, e colunas novas se houver dimensão nova |
| `private.plan_status_for` | expõe as colunas novas — **e `public.plan_status` e a `_` também, alinhadas por posição** |
| `src/app/finance/plan.tsx`, `src/app/paywall.tsx` | a tabela comparativa |
| App Store Connect / Play Console + RevenueCat | os preços |

---

## Apêndice A — Decidido NÃO fazer

### Open Finance / sincronização bancária automática

**Fora do escopo, por decisão do Gabriel em 14/09/2026:**

> *"open finance tem muito custo e agora, para nós que estamos começando, não vale a pena enquanto
> não tiver entrando dinheiro"*

A lacuna é real e estrutural — todo app consolidado no Brasil tem, e "cansei de digitar" é a queixa
nº 1 que faz o usuário abandonar app financeiro no segundo mês. **A aposta deste produto é que o
WhatsApp com IA resolve a mesma dor mais barato**: falar "gastei 45 no mercado" custa menos que
categorizar 200 linhas importadas.

A aposta é defensável e possivelmente melhor. O que ela exige é coerência: **enquanto Open Finance
estiver fora, o investimento vai no agente e na importação manual** (Fase 3), não num meio-termo.
Reavaliar quando houver receita recorrente.

### Toggle "até hoje" no herói do Financeiro

Recusado na Fase 1, com o motivo escrito lá: faria o mesmo card significar duas coisas conforme um
estado invisível. A resposta é a sub-linha.

### Score de saúde financeira 0–100

Os números do app já dizem melhor, e um número inventado ao lado de números auditáveis é a única
coisa da tela que o usuário não consegue conferir. (Está listado em `docs/PENDENCIAS.md` §4.4 como
ideia antiga — considere essa linha vencida.)

### Investimentos com cotação de mercado, orçamento compartilhado/família

O primeiro é outro produto. O segundo dobra a complexidade de permissão para um app que hoje é
pessoal — e `max_members` já existe no plano sem que a experiência multi-pessoa exista de verdade.

---

## Apêndice B — Lacunas conhecidas, menores

Coisas encontradas e não corrigidas, com o motivo. Nenhuma é urgente; todas são baratas.

1. **A receita fica flat na projeção longa e ninguém avisa.** Em 420 dias a entrada é
   7.566,52 **cravada por 14 meses** enquanto a saída cai (6.887 → 6.747 → 4.209, à medida que as
   parcelas acabam). A projeção está sendo honesta sobre o que SABE — as regras recorrentes
   cadastradas —, mas quem olha o acumulado de 2027 lê "vou ter 25 mil". **Uma frase na tela
   resolve**: "a projeção repete as suas regras; ela não sabe de aumento nem de gasto novo".
2. **`workspaces.timezone` não existe.** As 24 funções que usam `current_date` têm
   `set timezone to 'America/Sao_Paulo'` fixo no cabeçalho. É decisão consciente (o produto é
   brasileiro em todas as pontas); quando houver usuário fora, o caminho é
   `private.today(ws_ids)` lendo a coluna, e as 24 linhas viram `reset timezone`.
3. **O agente não adia fatura** (`roll_invoice`). Lacuna declarada em
   `docs/AGENTE-PARIDADE-COM-O-APP.md`, com o motivo: o `FinanceAction` está no teto medido de
   252 (18×14) e não cabe mais nada. O caminho, se virar prioridade, é **alvo resolvido** — foi
   assim que quitar fatura sem caixa virou `mark_paid` sobre `card_invoices`.
4. **O cron do Scheduler está PAUSADO no staging.** Consequência prática: recorrente nova nasce sem
   materializar e a projeção data errado no cartão. Foi o caso do "Cabelo Marcelao" nesta sessão.
   Para rodar à mão: `select public.materialize_horizon()` — **mas ele roda para TODOS os
   workspaces**, não só o seu.
5. **`push.TARGETS` (Python) e `ALLOWED` (app) divergem** — o app conhece `transactions`, o
   servidor não. Ver Fase 0.2.
6. **`paid_at` de 15 faturas históricas é `2026-09-08`**, o dia em que o app foi cadastrado e o
   histórico foi marcado como quitado via `settle_invoice`. Isso não é bug (a
   `20260913150000` trata disso de propósito, datando pelo `transfer` e não pelo `paid_at`), mas
   **qualquer análise histórica nova precisa saber**, ou vai despejar R$ 5.007,45 dentro de
   setembro.

---

## Apêndice C — Sequência sugerida

| # | fase | tamanho | depende de |
|---|---|---|---|
| 0 | ~~Higiene~~ ✅ `b36f706` (a 0.2 vai junto com a Fase 2) | 30 min | — |
| 1 | ~~"Já caiu" no Financeiro~~ ✅ `cc8f898` | meio dia | 0 |
| 2 | ~~Fechamento de ciclo~~ ✅ `9ac4b1c` | 1 dia | — |
| 3 | Conciliação pelo extrato | 1–2 dias | — |
| 4 | Bloqueio por senha/biometria | 1 dia + rebuild nativo | — |
| 5 | Loaders uniformes | 1–2 dias | — |
| 6 | Planos, limites e preço | meio dia de medição + decisão | tudo |

A 4 tem a maior latência escondida (rebuild nativo + EAS), então **comece o build cedo no dia** e
trabalhe em outra coisa enquanto ele roda.

A 6 fica por último porque precisa de uso real para medir — e porque é a única cuja saída é uma
decisão de negócio, não código.
