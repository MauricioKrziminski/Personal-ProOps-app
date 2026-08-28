# Atividade da IA — `src/app/ai-activity.tsx` *(sai de `finance/`)*

222 linhas hoje em `src/app/finance/ai-activity.tsx`, alcançável **só** pela aba Financeiro. Mas a
tela lista `create_note`, `create_reminder`, `create_goal` e `query_*` — ela é o log de **tudo** que
a IA entendeu, não do dinheiro. Enterrada dentro de Financeiro, o usuário que quer conferir se a
nota entrou certa nunca chega nela.

**Ela sobe para o Stack raiz, em `/ai-activity`**, alcançável de três lugares: o bloco "A IA
registrou" da aba Hoje, o menu do header do Financeiro e Perfil › Dados. Rota raiz porque ela é
`push` a partir de **três abas diferentes** — mantê-la na pilha do Financeiro faria o toque vindo
de Hoje trocar de aba para ler um log.

> Isto **substitui** o link `/finance/ai-activity` citado em `docs/design/hoje.md` e
> `docs/design/financeiro.md`. O caminho muda; o destino é o mesmo.

Quatro coisas erradas, todas verificáveis:

1. **O empty state mente.** `:169` promete *"Manda uma mensagem no WhatsApp e ela aparece aqui na
   hora."* — e **`ai_events` não está na publicação `supabase_realtime`** (a `0001_init.sql:225-227`
   publica `notes`, `reminders` e `expenses`; a `0005` acrescenta `transactions`, `goals`,
   `budgets`, `accounts`; `ai_events` nunca entrou). `useAiEvents` (`use-finance.ts:676`) também
   não tem `useRealtimeInvalidate`. Na hora, nada aparece: o usuário fica olhando para uma tela
   parada que prometeu se mexer.
2. **A RLS é por `user_id`, sem `workspace_id`** (`0020_ai_events_visibility.sql`), e a tabela nem
   tem essa coluna (`0001_init.sql`). Num workspace compartilhado, a mensagem que o parceiro mandou
   cria dado **compartilhado** — a transação aparece no financeiro do casal — mas o registro de
   como ela foi interpretada é **invisível** para o outro. O lançamento estranho existe e a
   auditoria dele não.
3. **Desfazer só existe às vezes, e o critério é invisível.** O botão depende de
   `created_transaction_ids` não vazio (`:107`), e o `process-jobs` só empilha id em
   `create_expense`/`create_income` (`:362`) e `create_transfer` (`:391`). `create_installment_purchase`,
   `create_note`, `create_reminder`, `create_goal` e `goal_deposit` **não registram id nenhum** —
   logo não têm desfazer, e a tela não explica por quê. Parece bug intermitente.
4. **Sem filtro, sem paginação, `limit` fixo de 30** (`use-finance.ts:676`). Consulta de saldo
   ("quanto gastei?") ocupa as mesmas linhas de um lançamento criado, e em uma semana de uso o que
   importa saiu da lista.

Somam-se as violações de superfície: 22 emojis de rótulo na chrome (`:17-40`), um `GlassCard` por
evento (`:113`) onde a regra permite um na tela, `Alert.alert` na confirmação destrutiva (`:69`)
onde a regra pede action sheet nativo, e `ScreenHeader` desenhado à mão (`:90`).

## Pergunta que responde

> "O que a IA fez com o que eu falei — e dá para voltar atrás?"

Nenhum concorrente mostra isso. É o argumento contra a queixa nº1 de quem usa esse tipo de app:
"categorizou errado e eu não sei por quê".

## Persona

- **Primária: qualquer um, logo depois de mandar mensagem.** Confere se entendeu, corrige se não.
- **Secundária: Rafa, 29** — manda áudio. Áudio é o que mais dá erro (transcrição do Groq + parse
  do Gemini, dois pontos de falha), e é ele quem mais precisa desfazer.
- **Terciária: o casal** — hoje **não atendida**, pelo defeito 2. É por isso que ele está
  documentado aqui e não escondido.

## Entrada e saída

- **Entrada:** `push /ai-activity` de Hoje ("A IA registrou" → ver tudo), do menu
  `ellipsis.circle` do Financeiro e de Perfil › Dados.
- **Saída:** linha de lançamento → `modal /finance/transaction-form?id=`; linha de nota →
  `/notes/[id]`; linha de lembrete → `modal /reminder-form?id=`. Desfazer não navega.
- **Back:** pop normal.
- **O que o back faz:** só leitura de `ai_events` (`select` sob a policy own-rows) mais o
  `useUndoAiEvent`, que é `delete from transactions where id in (...)` (`use-finance.ts:706`).
  A tela **não escreve** em `ai_events` — quem escreve é o `process-jobs`, e a policy não dá
  insert/update para o app (`0020`, comentário explícito).

## Anatomia

1. **Header nativo** — large title "Atividade da IA". `headerRight`: menu com "Só o que criou" /
   "Tudo".
2. **Faixa de escopo** — uma linha, `textSecondary`, **sempre visível**:
   *"Só as suas mensagens."* Em workspace com mais de um membro, ela ganha a segunda metade:
   *"O que {nome} mandou não aparece aqui."* Uma linha de texto honesta hoje custa infinitamente
   menos que a desconfiança de um lançamento sem origem amanhã. O conserto de verdade —
   `workspace_id` em `ai_events` e policy por workspace — está em **Fora de escopo** com o caminho
   escrito.
3. **Chips de filtro** — `Tudo · Criou · Consultou · Não entendeu`. O terceiro é o que resolve o
   defeito 4: "quanto gastei esse mês?" é ruído numa tela de auditoria, e "não entendeu"
   (`type: 'unknown'` ou `error` não nulo) é o que a pessoa vem procurar quando algo deu errado.
   Derivados de `result.actions[].type` no cliente — não é query nova.
4. **Card de destaque (o único `GlassCard`) — "Esta semana"**
   *"38 mensagens · 31 viraram lançamento · 2 não entendi"*, com `tabular-nums`. Substitui o card
   de texto explicativo de hoje (`:92-98`), que é um parágrafo ocupando o topo permanentemente.
   A explicação vira uma linha só, dentro do empty e do menu de ajuda. **Um número que resume
   merece o card de destaque; um parágrafo, não.**
5. **Lista agrupada por dia** (`FlashList`, cabeçalho "Hoje", "Ontem", "12 de agosto"). Cada linha,
   em `Card` opaco:
   - **O que foi entendido, em frase**: *"registrou um gasto · R$ 45,00 · #mercado"*. A frase fica;
     o emoji sai e vira ícone SF por família de ação (`arrow.down.circle` saída,
     `arrow.up.circle` entrada, `note.text`, `bell`, `magnifyingglass` consulta,
     `questionmark.circle` não entendeu).
   - **Hora relativa** à direita ("há 12 min").
   - **Confiança** só quando **abaixo de 0,8**: *"tive dúvida"* em `warning`, *"chutei"* em
     `danger`. Acertar 96% e anunciar "96% de confiança" em toda linha treina o usuário a ignorar
     o número justamente onde ele importa. As cores de hoje (`:105-106`) continuam, o texto muda.
   - **Erro** (`event.error`), quando existe, em `danger`, sem o `⚠️` de `:136`.
   - **"desfazer"**, quando existe (regra abaixo).
6. **Detalhes** — `model` e a soma de tokens (hoje na linha `:142`, sempre visível) descem para um
   disclosure por linha. `gemini-3.5-flash-lite · 812 tokens` é observabilidade de quem construiu,
   não informação para quem usa; mas está no schema e é barato deixar a um toque de distância.

## Desfazer — a regra escrita na tela

| Situação | O que a linha oferece |
|---|---|
| `created_transaction_ids` não vazio | **"Desfazer"** — action sheet nativo com a contagem no texto ("Apagar 2 lançamentos criados por esta mensagem?"), como o `Alert` de hoje já faz (`:70-71`), só que nativo |
| Ação que criou nota / lembrete / meta / parcelamento | **"Ver o que foi criado"** → abre a lista do domínio. Sem id gravado, não há como apagar exatamente aquilo — e apagar "o mais recente" seria chutar |
| Consulta (`query_*`) | Nada. Não criou nada |
| `unknown` ou erro | **"Mandar de novo"** — copia o texto original para o WhatsApp |

A segunda linha da tabela é o remendo honesto de um defeito de backend, e o conserto é pequeno:
**`ai_events.created_refs jsonb`** — `[{"t":"notes","id":"…"}]` — preenchido pelo `process-jobs` nos
mesmos pontos onde hoje ele empilha em `created` (`:362`, `:391`), estendido para `create_note`
(`:746`), `create_reminder` (`:758`), `create_goal` (`:779`) e `create_installment_purchase`
(`:395`). Com isso "desfazer" passa a valer para toda ação que cria, e `created_transaction_ids`
continua existindo para não quebrar o histórico. **(backend, novo)**

Detalhe que a tela precisa tratar: `delete ... in (ids)` **não erra** quando a transação já foi
apagada por outro caminho (`use-finance.ts:706`). Sucesso silencioso sobre nada. A linha passa a
marcar "desfeito" a partir da checagem de quantas linhas voltaram, e não do simples "não deu
erro".

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lista | `useAiEvents()` (`use-finance.ts:676`, vira `useInfiniteQuery`) | `['ai-events', filtro]` | `ai_events`, `order created_at desc`, página 30 via `.range()` | **não** — `ai_events` fora da publicação |
| Resumo da semana | derivado da primeira página | — | — | — |
| Desfazer | `useUndoAiEvent` (`:701`) | — | `delete from transactions` | invalida `['ai-events']` e o financeiro |

**Como a tela se atualiza sem realtime**, já que o empty não pode mais mentir:

- `refetchOnWindowFocus` / refetch no `useFocusEffect` — voltar do WhatsApp para o app recarrega.
  É o gesto real: a pessoa manda a mensagem lá e volta para cá.
- Pull-to-refresh.
- `refetchInterval` de 5 s **enquanto a tela está em foco e a última página tem menos de 2 min**,
  desligado fora disso. Poll curto e limitado à janela em que ele significa alguma coisa.

Adicionar `ai_events` à publicação `supabase_realtime` foi considerado e **recusado**: a policy é
`select`-only para o app e o realtime respeitaria a RLS, mas a tabela recebe uma linha por parse
de **todos** os usuários e é a tabela mais quente do produto. Poll em foco resolve o mesmo problema
sem pendurar um canal permanente numa tela que se abre uma vez por semana.

Paginação com `useInfiniteQuery`, página 30, `.range()` — o `limit(30)` fixo de hoje é o motivo de
não existir histórico.

## Ação primária

**Desfazer o que a IA fez errado.** Tudo o mais é leitura; esta é a única ação com consequência, e
é ela que transforma a tela de "log" em "controle".

## Ações secundárias

Filtrar por tipo · abrir o item criado · ver detalhes técnicos · mandar de novo o que não foi
entendido · corrigir conversando (a dica que hoje está no card do topo, `:95-96`: *"muda o último
pra 54"*) — que continua sendo o caminho mais rápido e por isso aparece no empty e no menu.

## Estados

- **Loading** — `Skeleton` na forma da linha (ícone + duas linhas de texto + hora), 6 itens.
  Nunca `LoadingCard` centralizado numa tela que é uma lista.
- **Empty — nunca mandou nada**: ícone `sparkles`, *"A IA ainda não entendeu nada seu"*, dica
  acionável: *"Manda `gastei 45 no mercado` no WhatsApp — o que ela entender aparece aqui."*
  **Sem "na hora"**: a tela recarrega quando você volta para ela, e é isso que o texto promete.
- **Empty — filtro sem resultado**: *"Nada em «não entendeu»"* + *"Boa notícia."* + "Ver tudo".
  Aqui o empty é elogio ao produto, e o texto reflete isso.
- **Error** — inline com "Tentar de novo" (`ErrorCard`/`onRetry` já existe, `:100`).
- **Erro ao desfazer** — hoje **não existe tratamento**: `undo.mutate` (`:80`) não tem `onError`, e
  falhar não mostra nada. Passa a ser toast persistente + a linha volta ao estado anterior.
  Mutation que falha em silêncio é reprovação (`design.md §6`).
- **Conteúdo longo** — mensagem com 10 ações (o teto do `process-jobs`, `:1021`) mostra as 3
  primeiras e "+7", expandindo no toque. Uma mensagem não pode ocupar a tela inteira.
- **Evento sem ação** (`actions` vazio, tratado em `:123-127`) — continua, com texto melhor:
  *"Não gerou nenhuma ação"* + "Mandar de novo".

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Entrada da lista | continuidade | `FadeInDown`, stagger 40 ms, teto 400 ms — é o que `:112` já faz, mantido, **sem `entering` em linha reciclada do `FlashList`** |
| Desfazer | mudança de estado | a linha não some: ela **fica, esmaecida, com "desfeito"**. Sumir apagaria a prova de que aconteceu, que é o ponto de um log. `Motion.base`; haptic `notificationAsync(Warning)` (já em `:78`) |
| Troca de filtro | mudança de estado | cross-fade da lista em `Motion.fast` |
| Item novo chegando no refetch | explicação | `FadeInDown` + destaque que desvanece em 1,2 s — o mesmo tratamento de nota nova em `notas.md` |
| Press na linha | feedback | highlight de fundo, 120 ms |
| Disclosure de detalhes | explicação | `LinearTransition` em `Motion.base` |
| Números do card da semana | mudança de estado | contam de/para em `Motion.base`, `tabular-nums` |

## Acessibilidade

- Linha com label completo em uma frase: *"Há 12 minutos, registrou um gasto de quarenta e cinco
  reais em mercado. Toque duas vezes para abrir."*
- **Confiança nunca só por cor** — hoje é exatamente isso (`:118-120`, cor sobre a porcentagem).
  Vira palavra ("tive dúvida", "chutei") com a cor por cima.
- "Desfazer" com `accessibilityLabel` que inclui o que será apagado, não só o verbo.
- Cabeçalho de dia com `accessibilityRole="header"` para navegar por dias.
- Valores `selectable` e com `tabular-nums`.
- Alvos ≥ 44pt: o "desfazer" de hoje é texto pequeno com `hitSlop={8}` (`:146`) — insuficiente.
- Dynamic Type XL: a frase da ação quebra em várias linhas; a hora relativa desce para baixo dela.

## Fora de escopo

- **`workspace_id` em `ai_events` + policy por workspace** — é o conserto real do defeito 2, e é
  migration + mudança no `process-jobs`, não desenho de tela. Enquanto não acontece, a faixa de
  escopo diz a verdade.
- Custo em reais por mensagem (o schema tem tokens, não preço; converter exigiria tabela de preço
  por modelo e envelheceria sozinha).
- Reprocessar uma mensagem antiga pelo app (o `messages_raw` está lá, mas re-enfileirar job pelo
  app significa dar ao cliente uma porta para a fila).
- Editar o que a IA entendeu **dentro** desta tela — correção mora no item (`transaction-form`) ou
  na conversa. Dois lugares para corrigir a mesma coisa é como os dois divergem.
- Exportar o log · avaliar a resposta (👍/👎) sem ninguém para ler a avaliação · gráfico de
  acurácia ao longo do tempo.
