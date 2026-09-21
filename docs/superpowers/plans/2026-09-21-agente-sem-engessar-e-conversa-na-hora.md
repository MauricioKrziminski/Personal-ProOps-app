# Agente sem engessar + conversa abrindo na hora — plano (21/09/2026)

> **Pedido do Gabriel:** *"tirar totalmente esse engessado do agente, com muito cuidado com os guard
> rails, com regressão etc., e corrigir TODOS os problemas encontrados"* e *"assim que eu mandar
> mensagem para o agente, ele já tem que me levar para a tela de conversa instantaneamente"*.
>
> Handoff: `.superpowers/sdd/HANDOFF-2026-09-21-agente-engessado.md`. Travas que valem para todas
> as tarefas: `.claude/rules/agent.md`, `ai-gemini.md`, `frontend.md`, `design.md`.

---

## 0. O que aconteceu de verdade (dado, não hipótese)

Staging, chat do app, 21/09/2026 (sessão `be4c791d…`):

| hora | quem | texto |
|---|---|---|
| 02:31:12 | Gabriel | `Comprei wardogs por 104,99` → gasto à vista gravado (`74bc7fa0…`) |
| 02:31:41 | Gabriel | **`Na verdade eu comprei em 2x no cartao`** |
| 02:31:43 | agente | `⚠️ Confirma apagar gasto de R$ 104,99 (wardogs)?` |
| 02:31:49 | Gabriel | Confirmar |
| 02:31:50 | agente | `faltou o valor…` + `🗑️ Apagado` |
| 02:32:05 | Gabriel | `104,99 no total` |
| 02:32:06 | agente | `Não achei cartão com o nome "verdade"…` — **a compra nunca foi recriada** |

`ai_events` do turno: o modelo devolveu `[delete_transaction(wardogs), create_installment_purchase(installments=2, amount_cents=null, new_amount_cents=10499, account="verdade")]`.

A cadeia que produziu isso:

1. **Falta de capacidade.** O agente não sabe parcelar um lançamento que já existe (exclusão
   declarada, `docs/AGENTE-PARIDADE-COM-O-APP.md:481`). Sem caminho, o modelo improvisou
   apagar + recriar.
2. **O gate perguntou METADE do pedido.** A criação ficou incompleta (`required._tem_valor` só olha
   `amount_cents`), e `_gate` (`nodes.py:~975`, `if i not in bloqueadas`) a tirou da confirmação: o
   SIM aprovou só o apagar.
3. **"Na verdade" virou nome de cartão — por uma REGEX NOSSA, não pelo modelo.** `finance_node`
   (`nodes.py:273-278`) troca `account` vazio/"cartão" de `create_installment_purchase` por
   `guards.extract_account_fallback(texto)` (`guards.py:172-185`), cuja `_ACCOUNT_EXTRACTOR` casa
   `na\s+(\w{3,30})`. Medido: "Na verdade eu comprei em 2x no cartao" → `verdade`; "paguei na hora" →
   `hora`; "gastei 45 na padaria" → `padaria`. O `ai_events` grava as ações DEPOIS dessa troca
   (`conversation.py:857`), por isso parecia saída do modelo.

O menu "Mudar parcelas pagas / Excluir plano" (`nodes.py:783-896`) **não** estava nesse caminho, mas
é o defeito gêmeo e dispara em QUALQUER correção de compra parcelada. Ele sai, e tirá-lo destrava
um bug de dinheiro que tem que cair NA MESMA TAREFA (T3).

### Achados que o conserto também fecha

| # | onde | defeito |
|---|---|---|
| F1 | `nodes.py:783-812` e `:822-896` | menu converte toda correção de plano em "excluir" ou baixa; descarta os `new_*` |
| F2 | `finance.py:834-836` | `update_transaction` com `installment_scope` vira BAIXA (`_baixa_em_parcelas`) e descarta os `new_*` |
| F3 | `finance.py:_corrigir_parcelas_futuras` | `new_amount_cents` é gravado POR PARCELA: "a TV foi 3000" em 8 abertas = R$ 24.000, sem erro |
| F4 | `policy.py:134-160` | frase da confirmação: sem `nome →` (`new_description` nunca aparece), e em plano mostra "R$ 3.000 total: valor → R$ 3.000" — lê como nada muda |
| F5 | `_gate` + `safe_node` | par apagar/corrigir + criar: a criação ou sai da pergunta (incompleta) ou é gravada ANTES da pergunta (completa, abaixo do limite) → duplicata sem SIM |
| F6 | `prompts.py:126-157` | só exemplos imperativos de correção; nenhum declarativo ("na verdade foi 50") |
| F7 | `config.py:39` + `gemini.py:98` + `.env*` + Cloud Run | `GEMINI_MODEL=gemini-3.1-flash-lite` global voltou em `2c849a4` (19/09): **o gate de confirmação roda no Lite em PRODUÇÃO e no staging** — a combinação medida que aprovou "apaga todos". `test_sem_variavel_de_ambiente_o_modelo_nao_muda` está VERMELHO |
| F8 | `schemas.py:101`, paridade `:81-85/:478/:481` | documentação afirma o que o código não faz |
| F10 | `guards.py:154,172-185` + `nodes.py:273-278` | regex infere o CARTÃO de "na <palavra>" — viola `agent.md` ("padrão de texto nunca infere sentido") |
| F11 | `registry.py:119-124` | "falha isolada não derruba as outras": num par apagar+criar com UM SIM, a criação falhar deixa o apagar feito |
| F9 | chat do app | a tela da conversa só abre quando o turno do LLM termina |

---

## 1. Decisões do Gabriel (AskUserQuestion antes de implementar)

- **D1 — parcelar pelo agente um lançamento que já existe.** Recomendado: SIM. Os dois motivos da
  exclusão caem: (a) o teto — `FinanceAction.installments` JÁ existe (`schemas.py:119`), então
  `update_transaction` + `installments ≥ 2` sobre uma linha avulsa é a conversão, zero campo novo,
  sem probe; (b) "não mostra o contrato" — a confirmação passa a mostrar: *"parcelar wardogs
  (R$ 104,99) em 2x de R$ 52,49 + R$ 52,50 no Nubank, 1ª em 21/09/2026"*. Reparcelar um PLANO e
  "À vista" continuam exclusão declarada.
- **D2 — corrigir o VALOR de uma compra parcelada.** Recomendado: o agente pergunta *"R$ 3.000 é o
  total da compra ou cada parcela?"* (escolha com botões, interpretada pelo mesmo `decide` de
  sempre), e cada resposta tem sua RPC: **cada parcela** → `update_transaction_scoped` (já usada);
  **total** → `update_installment_plan` com o mesmo número de parcelas e os campos atuais do plano
  (as regras de parcela travada são dela). Alternativa: só por parcela, e "total" responde "use
  Editar a compra no app".
- **D3 — lote que mexe num lançamento existente E cria outro.** Recomendado: UMA confirmação
  listando os dois; se a criação estiver incompleta, pergunta o que falta e **não apaga nada**
  ("Ainda não apaguei nem criei nada"). Custo: "gastei 20 e apaga o do mercado" passa a pedir um SIM
  para os dois (hoje o gasto é gravado antes da pergunta). Alternativa: só bloquear o caso incompleto.
- **D4 — `GEMINI_MODEL` global.** Recomendado: remover (código, `.env`, `.env.production`,
  `.env.example`, `setup-gcp.sh`; `--set-env-vars` é destrutivo, então o próximo deploy já tira do
  Cloud Run). Mitigação IMEDIATA, sem código: `gcloud run services update <svc> --remove-env-vars
  GEMINI_MODEL` — no staging eu rodo; em PRODUÇÃO só com o SIM dele. O gate volta ao `gemini-3.7-flash`
  (US$ 0,0023 por confirmação DIGITADA; clique continua grátis). Se a intenção era economizar, o
  caminho documentado é `GEMINI_MODEL_<PAPEL>` por papel, nunca o global.

**Respondido pelo Gabriel em 21/09/2026: as QUATRO recomendações (D1 sim com cartão obrigatório, D2 perguntar total/parcela, D3 um SIM atômico, D4 voltar ao medido já inclusive em produção). D4: `--remove-env-vars GEMINI_MODEL` aplicado em `agente-staging` (rev 00128) e `agente` (rev 00072), /health 200 nos dois.** Referências "T<n>" no texto = "Task <n>".

---

## 2. Tarefas (ordem de dependência)

Portão de TODA tarefa do agente: `cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q`
(código de saída 0). Do app: `npx tsc --noEmit && npx expo lint && npm test` (código de saída 0).
Toda tarefa começa escrevendo o teste que FALHA (TDD) e mostra a falha no relatório.

### Task 0: gate de volta ao modelo medido (F7, D4)
- `agent/app/config.py:37-39`: remover `gemini_model` e o comentário.
- `agent/app/services/gemini.py:~87-98`: `modelo()` lê só `GEMINI_MODEL_<PAPEL>`; o global sai
  (docstring junto). Atualizar o comentário histórico em `:60`.
- `scripts/setup-gcp.sh:362,381`: parar de ler/passar `GEMINI_MODEL` (`--set-env-vars` apaga o que
  não está na lista — o próximo deploy remove do Cloud Run; `:392` é `--update-env-vars` de outras
  chaves e não afeta).
- `agent/.env.example:97-102` (versionado): tirar a documentação do global, manter a do por-papel.
  `agent/.env:60` e `agent/.env.production:48`: remover a linha à mão.
- Testes: `test_sem_variavel_de_ambiente_o_modelo_nao_muda` fica verde (hoje VERMELHO, provado);
  `test_gemini_model_global_troca_todos_os_papeis` (`tests/test_schemas.py:146`) é INVERTIDO:
  `GEMINI_MODEL` no ambiente não muda papel nenhum.
- `ai-gemini.md`: registrar que o global voltou em `2c849a4` (19/09) e saiu de novo.
- Staging: `gcloud run services update agente-staging --region southamerica-east1 --project
  personal-proops-agent --remove-env-vars GEMINI_MODEL`. Produção (`agente`): só com SIM do Gabriel.

### Task 1: a frase que o usuário aprova (F4 + frases novas) — `agent/app/graph/policy.py`
`policy` é PURA: tudo que a frase mostra tem que vir congelado no alvo pelo resolvedor.
- `new_description` → `nome → X` nos DOIS ramos (com alvo `:141-150` e sem alvo `:177-186`).
- Plano, por parcela: `corrigir TV: R$ 350,00 por parcela nas 8 que ainda podem mudar (novo total
  R$ 3.400,00); as pagas ficam como estão`. **Quantas podem mudar e quanto já está travado vêm do
  BANCO** via `private.parcela_travada` (existe em produção desde `20260915210000`): o resolvedor
  congela `editaveis` e `travado_cents` no candidato plano (leitura com `workspace_id`). Contar por
  `status = 'pending'` em Python seria a segunda cópia de uma regra com três causas.
- Plano, total (D2): `corrigir o total de TV: R$ 3.000,00 → R$ 3.400,00 em 10x (R$ 2.800,00 divididos
  nas 8 que podem mudar)` — só total, travado e contagem; SEM valor por parcela (dispensa
  `private.valor_da_parcela`, que só existe no staging).
- Conversão (D1): `parcelar wardogs (R$ 104,99) em 2x no cartão Nubank, 1ª parcela em 21/09/2026` —
  total e N, nome do cartão congelado no alvo. Sem valor por parcela na frase (mesma razão).
- `par_de_substituicao(acoes, alvos) -> set[int]` puro: índices do lote quando há `create_*` E
  (`delete_transaction`/`undo_last`/`update_transaction` com alvo `found` ou `ambiguous` — alvo
  `none` não dispara). Testes unitários de frase e do helper.

### Task 2: par apagar/corrigir + criar é atômico (F5, F11, D3) — `nodes.py`, `registry.py`
- **Rascunho nunca nasce de um par.** `_rascunho` (`nodes.py:622-650`, origem do `draft` no nó
  `alvos`, `:598`) devolve `{}` quando `par_de_substituicao` não é vazio — cobre o valor faltando E a
  conta citada que não existe (`account_error`, `:643-650`). O ramo `change_card` do aviso de limite
  (`:949-960`) também não monta rascunho num par (responde "Ainda não apaguei nem criei nada").
- `safe_node`: com par, devolve `{}` (nada gravado antes da pergunta).
- `_gate`: com par e membro em `_incompletas` → para ANTES de qualquer `interrupt()`, `draft: {}`
  explícito, e ACRESCENTA só "Ainda não apaguei nem criei nada." (a pergunta do que falta já está em
  `results` desde `alvos` — `_esclarecimentos`, `:617-619`; repetir mostraria duas vezes).
- Par completo: a criação entra com motivo "lote" em `motivos`/`pendentes` (`:975-983`), no filtro de
  `itens`, E em `_confirm_selection` (`:694-712`), que hoje filtra por `needs_confirmation` e deixaria
  o gasto pequeno fora da frase no empate.
- Execução atômica (`execute_node`/`registry.execute`): no par, roda PRIMEIRO os `create_*`; só roda
  o apagar/corrigir se a criação escreveu (`not read_only`). Se não escreveu: "Não apaguei X porque
  não consegui registrar Y." Teste com a criação falhando (Level1Error e exceção).
- Testes: replay exato do incidente (`[delete(wardogs), create_installment(2x, amount=None)]`) →
  nenhum interrupt, `estado["draft"] == {}`, `save_draft` não chamado, zero execução; o mesmo com
  `account_error`; par completo → um interrupt com os dois itens, NÃO → nada; SIM com criação
  falhando → apagar não roda. Inverter `test_hitl_flow.py:277` e `:311` com comentário do porquê.
  Lote sem mutação de existente (dois gastos) continua como hoje — teste.

### Task 3: correção de compra parcelada sem menu (F1, F2, F3, D2) — `nodes.py`, `resolve.py`, `finance.py`
Uma tarefa só: tirar o menu sem o resto destrava o bug de R$ 24.000.
- Apagar os DOIS blocos de menu (`nodes.py:783-812` no empate e o bloco 1.1 `:814-896`).
- Checagem pura antes do gate, para QUALQUER tabela: `update_transaction` sem nenhum `new_*` e sem
  `installments` → `correction_error` "O que você quer mudar: o valor, o nome, a categoria ou a data?
  Ainda não mudei nada." Em alvo plano, `new_occurred_at` (com ou sem outros campos) →
  `correction_error` "a data de uma compra parcelada muda em Editar a compra no app" (a RPC com escopo
  não a aceita e hoje ela aparece na frase e some).
- Escopo (F2): a regra mora em `finance.update_transaction`, por onde passam found E empate (o
  `update` com escopo sai por `resolve.for_actions:602-624` → `_bounded_plan_target`, que já congela
  o `id` de cada linha no snapshot, `resolve.py:411-433`). Candidato com `installment_snapshot`: 1
  linha → corrige aquela linha (id do snapshot + `workspace_id` no WHERE); mais de uma → read_only
  "Consigo corrigir a compra inteira (as parcelas em aberto) ou uma parcela por vez." O desvio para
  `_baixa_em_parcelas` (`finance.py:836-837`) SAI: update nunca dá baixa.
- Unidade do valor (D2), helper único chamado nos DOIS caminhos (found e depois da escolha no
  empate, antes do `_confirm_selection`): com alvo plano e `new_amount_cents`, `interrupt({"kind":
  "choice", ...})` com opções `unidade:total` / `unidade:parcela`, corpo com os dois números, texto de
  saída próprio (não "Nenhuma dessas" nem "pelo valor ou pela data" — `conversation.py:806-814`), e
  aceita só id que está nas opções. A escolha congela `amount_unit` no alvo. SIM puro não escolhe
  (`confirm.py:390-395`, conferido).
- `finance.update_transaction` em plano: `amount_unit == "total"` → relê o plano com `workspace_id` e
  chama `update_installment_plan` com os 8 argumentos SEMPRE (N, 1ª data, description, category,
  merchant, account ATUAIS, trocando só o que a pessoa pediu — a RPC sobrescreve nulo,
  `20260915210000:185-195`); `"parcela"` → `_corrigir_parcelas_futuras`; **ausente com
  `new_amount_cents`** (checkpoint/pendência de antes do deploy) → read_only "peça de novo", NUNCA
  default "parcela". Agente conecta como `postgres` (conferido): `auth.uid()` nulo cai no
  `coalesce(…, plano.user_id)`. `update_installment_plan` com o mesmo N já está em PRODUÇÃO — D2 não
  depende das migrations pendentes.
- Exceção de RPC (`registry.py:172` hoje vira "Deu erro ao processar"): capturar só
  `psycopg.errors.RaiseException` (P0001) e mostrar a mensagem da RPC como Level1Error; o resto segue
  genérico.
- Pendência antiga (`delete_plan:`/`change_paid:`, vive 10 min): resume cai em "não fiz nada" — teste.
- Testes que mudam: `test_hitl_flow.py:553/:593/:637`; `test_plano_alvo.py:179`
  (`test_update_antigo_sem_snapshot_exige_nova_confirmacao`), `:190`, `:215`. Novos no grafo: valor em
  plano (found e empate) → pergunta de unidade → confirmação → RPC certa; renomear plano → 1
  confirmação → `update_transaction_scoped` com `description`; "edite a TV" → pergunta, zero interrupt;
  "muda a 3ª parcela para 300" → só aquela linha.

### Task 4: parcelar um lançamento que já existe (D1)
- Alvo: `update_transaction` + `installments ≥ 2` + alvo `transactions` avulso. Se o alvo JÁ é plano:
  `installments` igual ao N atual é só pista de busca (segue T3); diferente → `correction_error`
  "mudar o número de parcelas é em Editar a compra no app".
- Cartão OBRIGATÓRIO (`credit_card`): `new_account` citado → resolve como hoje, exigindo cartão; não
  citado → a conta da linha, SE for cartão; senão `correction_error` listando os cartões ("Em qual
  cartão? Você tem: *BB*, *Nubank*. Me diz de novo com o cartão."). Rascunho NÃO serve aqui sem
  código novo (`draft.mesclar` grava em `account`, e completar o rascunho re-resolve o alvo sem
  congelar) — exclusão declarada no doc. Nome do cartão congelado no alvo para a frase.
- `finance.update_transaction`: `select public.convert_transaction_to_installments(id, total, n,
  occurred_at, description, category, merchant, account_id)` — description/category/merchant ATUAIS
  da linha (a RPC sobrescreve, `20260920120000:185-196`; omitir vira "Compra parcelada (1/2)" sem
  categoria). Total = `new_amount_cents` se veio, senão o valor da linha. `result_id` = a linha.
  Posse: o `registry` já faz `ensure_owned` (`registry.py:144`) e a RPC confere o workspace da conta.
  Parcelas 2..N nascem `source='app'` na RPC — anotar, não mexer.
- Testes de tool (RPC dublê), de grafo, de dono (id de outro workspace → nada), conta corrente sem
  cartão citado → pergunta, argumentos da RPC preservando categoria/merchant.
- ⚠️ `convert_transaction_to_installments` só existe no STAGING: **agente com T4 não vai para produção
  antes das migrations `20260920120000`/`20260920130000`** — ordem: migrations → agente → app.

### Task 5: o prompt entende correção declarativa, e a regex para de inferir cartão (F6, F10)
- `guards.extract_account_fallback`: fica SÓ o ramo estrutural `no cartão <nome>`; o
  `_ACCOUNT_EXTRACTOR` genérico sai deste caminho (conta vazia → `faltando` pergunta). Conferir todo
  chamador de `extract_account_fallback`/`_ACCOUNT_EXTRACTOR` e de `extract_description_fallback`
  (mesma classe de defeito) e revisar `test_draft_flow.py:598`. Testes: "na verdade…", "na hora",
  "na padaria" não viram conta; "no cartão nubank" vira.
- `prompts.py`: exemplos declarativos em `update_transaction`: "na verdade foi 50" →
  `new_amount_cents=5000`; "errei, era 54"; "o mercado foi 120, não 100" → busca `amount_cents=10000`,
  `new_amount_cents=12000` (valor antigo errado → "não achei", lado seguro); "na verdade eu comprei em
  2x no cartão" → `update_transaction, installments=2`, sem apagar nem criar; "na verdade foi no
  Nubank" → `new_account`. "na verdade/aliás/errei/corrigindo" são expressão, nunca nome. A linha de
  `undo_last` ("foi engano", `:144`) muda: "foi engano, era 54" é correção.
- `evaluate_answer_forms.py`: helper que devolve a LISTA inteira de ações (o `_apagar` devolve só a
  1ª, `:161-164`) e seção nova `corrigir/forma declarativa`: as frases acima → `update_transaction`,
  nenhum `create_*`, nenhum `delete_*`/`undo_last`; adversarial: "gastei 120 no mercado", "comprei um
  fone em 2x de 50" continuam criação. Seção `escolha/unidade do valor`: "é o total", "cada uma", "300
  cada" escolhem; "sim" não escolhe.
- Iterar com `--secao corrigir --barato`. Execução que APROVA: sem flag, UMA vez, DEPOIS de T0.

### Task 6: documentação que mente (F8)
- `schemas.py:101` docstring → 18 × 14 = 252.
- `docs/AGENTE-PARIDADE-COM-O-APP.md`: `:81-85`/`:478` (correção de plano agora de verdade, com
  unidade), `:481` (conversão entra, cartão obrigatório, sem rascunho), total por
  `update_installment_plan` (D2).
- `.claude/rules/agent.md`: par atômico (T2), "update nunca dá baixa" (T3), regex de cartão (T5).
- CLAUDE.md, pendências: agente com T4 exige as migrations `20260920*` em produção antes.

### Task 7: servidor aceita o id da conversa (F9) — `agent/app/routes/chat.py`, `app_chat.py`, `db.py`
- `NovaConversa.id: UUID | None = None` (mantém `extra='forbid'`).
- `db.create_chat_session(..., session_id)`: `insert … (id, …) values (coalesce(%s::uuid, gen_random_uuid()), …)
  on conflict do nothing`, depois `select … where user_id = %s and first_client_message_id = %s`.
  Constraints de `user_sessions` conferidas: PK `id`, unique `thread_id`, unique `phone` (0040) e
  `(user_id, first_client_message_id)` (0055:82); a sessão do app tem `phone` nulo e `thread_id`
  aleatório, então o `do nothing` só engole conflito de id ou de cmid, e CHECK continua levantando.
  **Só quando o cliente mandou `id`**: nada voltou, ou voltou id diferente → `ConversationNotFound` (404).
  Sem `id` (APK antigo), comportamento de hoje, retry idempotente incluído. Manter o retorno
  `(linha, criada)` (`app_chat.py:151` desempacota).
- pytest (dublê): com id → mesmo id; sem id → como hoje; id não-UUID → 422 na rota.
- **SQL de verdade** em `supabase/tests/app_agent_chat.sql` (rodar com `scripts/sql-test.py` no staging):
  id de outro usuário → select vazio; id de sessão de WhatsApp → idem; mesmo `(id, cmid)` 2x → uma linha;
  CHECK violado ainda levanta.
- Deploy no STAGING com `./scripts/setup-gcp.sh staging` (o script só lê `$1`; `deploy staging` miraria
  PRODUÇÃO) ANTES de testar o app: app novo contra agente velho recebe 422.
- CLAUDE.md, ao lado das migrations pendentes: **"OTA/build do chat exige a revisão nova do agente em
  produção"** — senão TODA primeira mensagem falha com 422.

### Task 8: o app navega no toque — `src/`
- `agent-api.createConversation(clientMessageId, content, id?)`.
- Semente do cache no formato REAL (`useInfiniteQuery`, `use-agent-chat.ts:85-148`):
  `{ pages: [{ items: [msgLocal], next_cursor: null }], pageParams: [null] }`, com
  `msgLocal = { id: 'local:<cmid>', client_message_id: cmid, role: 'user', content, status: 'processing',
  created_at: new Date().toISOString() }` e SEM `sequence` (`created_at` ancora o teto de 5 min).
- `useCreateAgentConversation` (callbacks do HOOK rodam sempre, mesmo desmontado — TanStack v5,
  conferido no Context7): `onMutate` põe o item semeado em `processing` (é o que faz o retry mostrar
  "Pensando…" e não a falha); `onError` marca `failed` + `error_code`, invalida
  `agentKeys.conversations` (a conversa pode já existir, ex.: 402) e abre `/paywall` pelo `router`
  global; pula `AgentAuthExpiredError`. `onSuccess: aplicar` fica.
- **No caminho de criação, NENHUM callback no `.mutate()`** (hoje `disparar` faz `router.push('/paywall')`
  lá, `conversation-screen.tsx:222-229`; na aba ele ainda dispararia → paywall duplo). E o caminho de
  criação NÃO chama `turno.iniciar` nem mexe em `erro`.
- Aba continua montada depois do `push`: `rodando` da aba ignora `criar.isPending` (ou `criar.reset()`
  logo depois do `mutate`), senão o compositor volta travado.
- `aplicarTurno` (`use-agent-chat.ts:134`): remove o item local só quando o cmid do turno NÃO é nulo e
  `m.id !== user_message.id` (mensagens do assistente têm `client_message_id` nulo — sem a guarda, o
  filtro apagaria todas).
- `submeter` sem `conversationId`: orquestrador puro `abrirConversaNova({gerarId, semear, enviar, navegar})`
  em `src/lib/agent-chat.ts` (sem `expo-router`/supabase): gera `id` + `cmid` → semeia → `criar.mutate` →
  `router.push` (aba) / `replace` (`/agent/new`), no mesmo handler do toque.
- `useAgentMessages`: `enabled: (q) => isAgentConfigured && !!conversationId &&
  !(itens.length > 0 && itens.every(m => m.sequence == null))`, com `itens` de `q.state.data` (cache
  VAZIO busca — conversa aberta a frio não pode travar). Tela mostra erro de histórico só com
  `isError && !data`.
- Falha: a tela consulta `retryPolicyFor` (`agent-chat.ts:240-262`) para o código que `FALHA`
  (`conversation-screen.tsx:71-75`) não conhece — 404/422 sem "Tentar novamente"; `network` com texto
  de rede.
- Retry (função pura): sem nenhuma mensagem com `sequence`, "Tentar novamente" chama `criar` com o MESMO
  `{id, cmid}`; depois, `enviar`.
- Título: semear o cabeçalho com a regra do servidor (`derive_title`: 1ª linha, 48 caracteres), ou não
  desenhar o heading até ele existir — sem salto de layout.
- A aba deixa de desenhar o turno pendente no slot `turn` do `AgentChatStart`.
- ⚠️ `refresh-consistency.test.ts:26` troca `@/lib/agent-chat`, `@/lib/agent-api` e o `router` por `{}`:
  helpers usados nos callbacks moram em `use-agent-chat.ts` ou entram no stub.
- Testes (`node --test`): orquestrador com `enviar` que nunca resolve → `navegar` síncrono, `enviar` 1x,
  mesmo id; semente no formato infinite; `enabled` com cache vazio busca e com só-local não busca;
  `aplicarTurno` sem duplicata e sem apagar resposta do agente; retry escolhe `criar`; política de falha
  para 404/422/network.

### Task 9: revisão e verificação
1. `/code-review` (nível high) no diff inteiro + `security-review` (IDOR do id da conversa, `ensure_owned`
   nas RPCs novas, RPC `security invoker` chamada por papel que ignora RLS).
2. `evaluate_answer_forms.py` sem flag, UMA vez (depois de T0 e T5).
3. Deploy do agente no STAGING.
4. **Emulador Android** (`emulator-5554`, `dev@proops.local`, bundle novo provado por "Android Bundled"
   no log do Metro depois de `pm clear`), gravando o que o dedo faz:
   - replay exato numa conversa NOVA (o rascunho aberto do incidente é da sessão `be4c791d` e não
     interfere; testa T8 junto): `Comprei wardogs por 104,99` → capturar por SQL o id da linha criada →
     `Na verdade eu comprei em 2x no cartao` → deve perguntar o cartão ou parcelar no cartão da linha,
     confirmar o CONTRATO, e em `transactions` sobrar UM plano de 2 parcelas cuja parcela 1 tem o id
     capturado. Depois apagar o plano de teste pelo app (staging limpo, impressão digital conferida);
   - `na verdade foi 50` logo depois de um gasto → corrige, não cria;
   - correção de valor numa compra parcelada → pergunta total/parcela → RPC certa (conferir soma no banco);
   - primeira mensagem na aba → a tela da conversa abre no toque, balão + "Pensando…" antes da resposta.
   Conferência por SQL read-only no staging depois de cada caso. Relatório diz o que o dedo passou e o
   que NÃO passou.

## 3. Fora do escopo (declarado)
- Apagar UMA parcela pelo menu deixa `sum(parcelas) < total_cents` — pendência antiga, espera resposta.
- Reparcelar um plano e "À vista" pelo agente — exclusão mantida.
- Rascunho que carregue duas ações (o par incompleto) — hoje o par para e pede para remandar.
- Produção: migrations `20260920*`, deploy do agente e OTA/build são pedido do Gabriel, nessa ordem.
- Nenhuma tag.
