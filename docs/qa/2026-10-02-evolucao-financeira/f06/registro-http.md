# F06 — leitura HTTP staging e comparação independente

Status: **baseline somente de leitura aprovado; prova positiva de classificações conhecidas pendente**.
Execução concluída em 2026-10-03T05:38:59.761Z (03/10/2026, 02:38:59 BRT), na branch
`gabriel/financas-22-melhorias`, projeto staging `utkqoiigimqzeenxkxdl`.
Usuário QA já existente `7ebb1a7e-5588-41b3-b62f-d8ebea5766a3`, workspace
`b94c2f3e-e1f1-450e-b549-bc570b5e8b0e`; sua sessão tinha um workspace acessível.
Nenhuma fixture, transação, categoria, contrato ou migration foi criada/aplicada por esta rodada.

## Método e autorização

Foi aplicado o skill Supabase e relidas as regras locais de banco e finanças. CLI linkado e
`.env.local` apontavam para staging; `scripts/supabase-target.sh` foi executado antes das chamadas
e também dentro dos dois scripts. Não foi lido nenhum ambiente de produção.

O script Node transpila e carrega o **hook real** `src/hooks/use-finance.ts` e seus helpers reais,
com um único VM realm, como no Metro. React/React Query somente devolvem a configuração de query;
`queryFn`, paginação, normalização, construção PostgREST e transporte supabase-js são reais.
Inputs são copiados para o realm dos helpers; arrays de resultado são comparados no realm do
harness. Nenhum domínio de produção foi modificado para acomodar protótipos de teste.

A autenticação utilizou o login QA existente com persistência/refresh de sessão desligados.
O guard do transporte só permite GET/HEAD, autenticação e POST da RPC de leitura
`ledger_expected_lines_classified`; nenhuma rota de mutação financeira foi permitida.
Houve 38 respostas HTTP 2xx: autenticação/membership, 28 páginas de lançamentos e 8 janelas
previstas. Não foram registrados tokens, senhas, headers de autorização, descrições ou IDs de
registros no documento. Identidades são conferidas integralmente em memória e resumidas por hash.

O oracle Python usa `agent/.venv`, lê somente `agent/.env` com ref de staging obrigatório e
abre uma transação **REPEATABLE READ READ ONLY**, com `SET LOCAL ROLE authenticated` e
`request.jwt.claim.sub` do mesmo usuário. Os IDs vêm de SELECTs SQL com predicados construídos
independentemente do hook, mesma ordem determinística `occurred_at/created_at/id DESC` e RLS.
A conexão termina por rollback. **Não importa nem executa `scripts/sql-test.py`.**

Referências da API consultadas: [OR PostgREST](https://supabase.com/docs/reference/javascript/or)
e [range inclusivo](https://supabase.com/docs/reference/javascript/range).

## Comandos e artefatos

```sh
node --check /private/tmp/proops-f06-live-read.cjs
agent/.venv/bin/python -m py_compile /private/tmp/proops-f06-live-sql.py
scripts/supabase-target.sh
node /private/tmp/proops-f06-live-read.cjs
```

Rodada final: exit 0. Scripts QA estão em `/private/tmp/proops-f06-live-read.cjs` e
`/private/tmp/proops-f06-live-sql.py`. Evidência privada: `proops-f06-live-result.json`
e `proops-f06-live-intent.json` (mode 0600). O JSON de resultado guarda contagens, hashes e
metadados de requisição sem credenciais. O diagnóstico privado de expected guarda dados da
conta QA; não deve ser publicado. As duas tentativas anteriores concluíram os recortes mas
pararam na comparação expected: arrays VM/host com conteúdo idêntico. Corrigido o comparador
no script QA com `Array.from`; nenhuma alteração de produção foi necessária.

## Lista materializada

Cada recorte abaixo foi percorrido até `getNextPageParam` encerrar e coincidiu em todos os IDs,
na ordem exata, com o SQL independente. A lista geral tinha 121 registros; selecionar classificação
restringiu a 115 gastos elegíveis, excluindo receitas, transferências e quitação de fatura.

| Recorte | Registros | Tamanhos das páginas |
|---|---:|---|
| all | 121 | 50 / 50 / 21 |
| pattern-fixed | 0 | 0 |
| necessity-essential | 0 | 0 |
| pattern-unknown | 115 | 50 / 50 / 15 |
| necessity-unknown | 115 | 50 / 50 / 15 |
| pattern-multiple-null | 115 | 50 / 50 / 15 |
| necessity-multiple-null | 115 | 50 / 50 / 15 |
| groups-and | 115 | 50 / 50 / 15 |
| crossed-known | 0 | 0 |
| combined-payment-account-category-search | 0 | 0 |
| combined-fee-search-or | 2 | 2 |
| from-only | 86 | 50 / 36 |
| to-only | 23 | 23 |
| pending-values | 18 | 18 |
| income-contradiction | 0 | 0 |

O transporte comprovou grupos OR separados por dimensão e combinação AND:
`or=(expense_pattern.in.(fixed),expense_pattern.is.null)` e
`or=(expense_necessity.in.(essential),expense_necessity.is.null)` coexistem como parâmetros
repetidos. Payment method, conta origem/destino e busca também conservam seus grupos separados.
A busca por juros produziu dois registros e coincidiu com o oracle; não foi deduzida classificação
da compra nem da descrição. `kind=income` com classificação enviou simultaneamente
`kind=eq.income` e `kind=eq.expense` e trouxe vazio, igual ao SQL.

Cinco entradas de enum/tipo inválidas foram rejeitadas antes de qualquer HTTP. Dois links
misturando opção válida/inválida devolveram null no parser real, preservando a rejeição do
link inteiro. Esta evidência do parser não representa interação nativa com deep link.

Hash SHA-256 dos IDs ordenados da lista geral:
`e4cc6dbabe2e03ee3636622bf20b48b28d676901cf5abbf9b23fd004bd291bfb`.
Hash dos 115 gastos Não informado:
`e6dab978ea15db8a4a7cf7380e41bc24ac4eaf5a181b6cfbd67702a9523c75c5`.

## Previsto classificado e conservação

O hook real `useExpectedLedgerLines` percorreu **2026-09-01 a 2027-12-31**, oito janelas de
até 62 dias pela RPC classificada. Trouxe 115 linhas previstas, incluindo as fixtures de
calendário existentes. O SQL independente dividiu o mesmo intervalo e comparou todas as
colunas, inclusive quatro campos de classificação; resultado integral idêntico.
SHA-256 canônico: `f73a158a897273a1f38e42beba3e4eb0e26aadc95b4b6e3c1ffc1cd1027bb34c`.

Antes e depois da leitura HTTP, as linhas completas dos modelos abaixo foram lidas sob RLS,
ordenadas por id e resumidas por SHA-256. Todos os hashes ficaram iguais; quantidade e conteúdo
de lançamentos/contratos/contas/faturas/orçamentos/categorias e os saldos derivados permaneceram
iguais. A RPC prevista **não materializou ocorrências** durante a janela observada.

| Modelo | Linhas | SHA-256 antes = depois |
|---|---:|---|
| transactions | 121 | `bdb9ed16673e888390437d6a113951be2a6419b72b827a75944e0e66b4b90899` |
| recurring_transactions | 7 | `27a1dae965f96db019daea8057a56e449982d6b068ab94ded691b6af3da4cfc0` |
| installment_plans | 10 | `3ee49e04fbe2dfcb101180be7bf745c75ee6bc1cbf430d1cb9054f8126ab29f9` |
| debts | 4 | `4408a2dc393017cf4be76cf0cbed763f07bdb6cb743672afd0ae1be7bb5b09cb` |
| categories | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| budgets | 6 | `484cdb0181830f846ce8aa348baf8b8593a281d0058969b94081efc36bef4e98` |
| accounts | 20 | `34f5ebd898b24554cb1923432b34abd983c854aebc695542970d78087494f7c2` |
| card_invoices | 48 | `3df513afc22ec94eb456fb3f498518b5bf7f676f5b790e1abaf0b83535a953dc` |
| balances | 21 | `dca92390d6a52ebce9fd04ccabfc8b8edc1c78128fdb378b27b7f832f9624f9f` |

## Limites e próximo recorte

Os **121 lançamentos existentes têm ambas as dimensões null**; as 115 linhas previstas também
não têm valor conhecido. Assim, esta rodada prova HTTP, SQL, paginação, ausência/Não informado,
exclusões, coexistência dos grupos, rejeição de entradas inválidas e conservação. Resultados
vazios para Fixo/Essencial e os cruzamentos conhecidos não demonstram inclusão positiva desses
valores nem distinguem todas as combinações OR/AND em dados classificados reais.

O agente principal foi avisado, liberou a janela estável e criará pares pela UI nativa.
Depois disso, repetir somente casos positivos e cruzamentos justificados, com novo snapshot
antes/depois. Não repetir todo baseline sem mudança que justifique. Não há prova mult-workspace
live nesta conta, pois ela tinha apenas um workspace; nem aceite de UI nativa fornecido por este
script. Login pode criar sessão Auth; a afirmação de conservação refere-se aos modelos financeiros.
A migration adicional de prévia ainda estava em composição pelo outro worker; este registro
não a promove nem atesta comportamento posterior à sua aplicação.


## Rodada positiva após persistência nativa — 07:03Z

**Atualização de status: prova positiva HTTP/SQL aprovada para as combinações presentes.**
A pendência e os resultados vazios/all-null das seções anteriores descrevem o baseline
histórico de 05:38Z; não foram reescritos nem representam o estado desta rodada.
Execução finalizada em **2026-10-03T07:03:59.764Z** (04:03:59 BRT), exit 0.
Projeto staging `utkqoiigimqzeenxkxdl`, mesma conta QA/workspace e branch.
O agente principal liberou expressamente a janela sem saves após criar os dados na UI;
a janela foi liberada imediatamente após o GREEN. Esta rodada fez somente leituras financeiras.

### Dados novos e comparação independente

A UI nativa havia criado seis gastos em duas categorias QA. Depois do backfill explícito,
os manuais tinham Variável/Essencial; os automáticos Variável/Não essencial; dois nulls
manuais de Previsibilidade permaneciam Não classificar, com Necessidade Não essencial.
Também havia uma série QA Fixo/Essencial explícita, uma compra com duas parcelas
Variável/Não essencial via padrão, e uma dívida Fixo explícita cuja Necessidade permaneceu
sem valor/origem. Essas escritas são evidência nativa do integrador, não atos deste script.

O script novo usa o hook/queryFn real e o mesmo VM realm; o oracle usa SELECTs independentes
em transação REPEATABLE READ READ ONLY, authenticated e RLS. Para cada recorte, exigiu
inclusão positiva mínima nas combinações que o integrador informou como existentes.
Conferiu integralmente IDs **na ordem exata** e dez colunas por linha:
`id, kind, amount_cents, account_id, category, payment_method` e os quatro campos de
classificação/origem. Todas coincidiram com o SQL. Não calculou a expectativa por categoria
atual nem repetiu o baseline completo.

| Recorte | Registros | Páginas até encerrar | Inclusão positiva |
|---|---:|---|---|
| variable-essential | 2 | 2 | Sim |
| variable-discretionary | 4 | 4 | Sim |
| null-discretionary | 2 | 2 | Sim |
| variable-or-null-and-discretionary | 6 | 6 | Sim |
| variable-and-essential-or-discretionary | 6 | 6 | Sim |
| known-plus-unknown-both-groups | 8 | 8 | Sim |
| ios-category-essential | 1 | 1 | Sim |
| android-category-discretionary | 2 | 2 | Sim |
| account-payment-search-groups | 4 | 4 | Sim |
| fixed-when-present | 0 | 0 | Não — nenhum Fixo materializado |

Os nove recortes positivos demonstram OR interno/AND entre dimensões sobre dados que
realmente distinguem as combinações, incluindo Não informado, categoria, conta, método
Pix/Não informado e busca. O recorte Variável/Não essencial inclui as duas parcelas da compra
nativa; seus snapshots e origens também coincidiram com o SQL. O filtro Fixo materializado
é condicional: não há nenhuma transação Fixo neste instante, logo seu resultado zero foi
comparado corretamente, mas **não é contado como inclusão positiva**.

Hash dos IDs Variável/Essencial:
`3898be5932bbf3722ef5c0e3d5dc4d544c77b505705804f882f8a6aa48687ba0`.
Hash Variável/Não essencial:
`86f371745f5ee19a5e284a6e0c19012f69ce717ca6334719b6ae8aee9c14c2ec`.
Hash Não informado/Não essencial:
`8dd882b863cbc80efa9a4f6b8c5d42142766c28ba8a849bbd7f9a0d744693337`.
Demais hashes e grupos OR enviados estão no JSON sanitizado privado.

### Previsão classificada integral e conservação

O hook real consultou novamente o intervalo **2026-09-01 a 2027-12-31**, oito janelas de
até 62 dias. HTTP e SQL independente coincidiram em **132 linhas e todas as colunas**;
**17 linhas tinham classificação conhecida**:

| Origem prevista | Linhas conhecidas | Snapshot comprovado |
|---|---:|---|
| recurring | 15 | fixed/explicit + essential/explicit |
| debt_schedule | 2 | fixed/explicit + Necessidade null/null |

O SQL também confirmou um contrato QA recorrente classificado e um plano QA classificado.
Planos têm parcelas materializadas e não existe origin inventado de plano nessa RPC;
suas duas parcelas foram verificadas nos recortes materializados. A previsão com Fixo
não depende de materializar um gasto: os hashes dos modelos permaneceram iguais durante
esta leitura. Hash canônico da previsão integral:
`c170e7c4395ccabca6860caecf96f3d48b3d9893504a5b192fe1ec413c072524`.

Foram 20 respostas HTTP 2xx: autenticação/membership, dez recortes materializados e oito
janelas previstas. Os recortes positivos couberam em uma página cada; o encerramento da
paginação foi executado. A evidência de três páginas do baseline anterior permanece
complementar e não foi repetida sem necessidade.

Snapshots completos antes/depois, sob RLS, ficaram idênticos:

| Modelo | Linhas | SHA-256 antes = depois |
|---|---:|---|
| transactions | 129 | `056c43b7ef4b926a41630f4e165a45442e3ed1f5af3a9f3dc6e47ff1ff30dc5a` |
| recurring_transactions | 8 | `26316918004cef6487dc43d1a4e62d65925a60ebc9afe5d94c86557af4dc97cc` |
| installment_plans | 11 | `f30133b5a16c851ddc36355a892b4ed697cfbd57f4cdfeccc2b6bd9ac7a3c38e` |
| debts | 5 | `16aa67b1cdc89a5dea3e36589c2baa581b8d86ddbb1236c7f5e582545bc95150` |
| categories | 2 | `8c5a2b302fcc28dfc454d0099c6fb1e99ae194b0c7a9d691b4e59513f876c815` |
| budgets | 6 | `484cdb0181830f846ce8aa348baf8b8593a281d0058969b94081efc36bef4e98` |
| accounts | 20 | `34f5ebd898b24554cb1923432b34abd983c854aebc695542970d78087494f7c2` |
| card_invoices | 48 | `3df513afc22ec94eb456fb3f498518b5bf7f676f5b790e1abaf0b83535a953dc` |
| balances | 21 | `357b72bb9c56c9f4a124d170e18ec72155b7af83b8acc2e4c5f9b4848d91de86` |

Não foram criadas ocorrências pelo hook previsto, nem alterados contratos, classificações,
valores, categorias, orçamentos, contas/faturas ou saldos durante a janela observada.
Login pode criar sessão Auth; a afirmação de conservação refere-se aos modelos financeiros.

### Comandos, artefatos e limites

```sh
node --check /private/tmp/proops-f06-positive-read.cjs
node /private/tmp/proops-f06-positive-read.cjs
agent/.venv/bin/python -m py_compile /private/tmp/proops-f06-positive-sql.py
scripts/supabase-target.sh
node /private/tmp/proops-f06-positive-read.cjs --execute
```

Checks offline e execução autorizada: exit 0. Sem `--execute`, o script sai com
`prepared:true, executed:false`, antes de ler credenciais ou chamar rede.
Scripts/resultados do baseline foram preservados. Artefatos novos mode 0600:
`/private/tmp/proops-f06-positive-result.json`, `proops-f06-positive-intent.json` e
`proops-f06-positive-expected-diagnostic.json`. O último guarda dados de diagnóstico da
conta QA e não deve ser publicado. Não se registram tokens, senhas ou headers de autorização.

Permanece sem inclusão positiva **materializada** de Fixo; Fixo foi comprovado na previsão
real da série/dívida. A conta tinha um workspace, portanto não há prova HTTP mult-workspace
nesta rodada. Chamadas HTTP/queryFns reais complementam os testes UI nativos do integrador;
este harness não prova renderização, gestos, aparência nem corrida entre dois aparelhos.
A aprovação final do F06 continua com o integrador.
