# Pessoas — `src/app/(tabs)/profile/members.tsx` *(tela nova)*

`workspace_members` existe desde a `0010` com `role` (`owner|member|viewer`) e `created_at`, e o
app **nunca leu essa tabela**. O mais perto que existe é `plan.tsx:149`, que mostra o **número**
(`2 de 3 pessoas`) vindo de `plan_status`. Não dá para ver quem são, qual o papel de cada um,
tirar ninguém — nem renomear o espaço (`workspaces.name`, `0010:13`, também sem nenhuma leitura no
app).

Esta tela junta as três coisas que hoje estão espalhadas ou ausentes: **quem está**, **quem foi
convidado** (hoje dentro de `plan.tsx:191-264`) e **como esse espaço se chama**.

Três restrições do banco que desenham a tela — e nenhuma delas é contornável em TS:

- **Ninguém lê o perfil do outro.** `profiles` tem policy `own row` (`0001:23-24`), então um
  `select` em `workspace_members` com join em `profiles` devolve os ids e **nenhum telefone**. A
  lista de pessoas precisa de RPC `security definer`.
- **A pessoa é o telefone.** `profiles` não tem nome nem avatar — só `phone` (`0001:11`). É
  coerente: o telefone é a chave do vínculo com o WhatsApp. A tela identifica gente por número
  formatado (a função `telefoneBR` já existe em `plan.tsx:26` e sobe para compartilhada).
- **`role` hoje não vale nada.** Nenhuma policy usa `role`: as tabelas de dado são todas
  `for all using (workspace_id in (select my_workspace_ids()))` (`0010:172-174`). Ou seja, um
  `viewer` **escreve igual a um membro**. `useInviteMember` aceita `'viewer'`
  (`use-finance.ts:1046`) e `plan.tsx:208` sempre manda `'member'` — na prática o papel é
  decorativo. Ver *Fora de escopo*.

## Pergunta que responde

> "Quem enxerga o meu financeiro?"

E o corolário do casal, que é o motivo real de a tela existir: *"quem lançou isso?"*

## Persona

- **Primária: o casal** — um workspace, duas pessoas, e a dúvida recorrente sobre quem lançou o
  quê. Hoje `transactions.user_id` guarda o autor e o app não tem como traduzir esse uuid em
  ninguém.
- **Secundária: Camila, 34** — convidou a mãe para o plano Família e quer conferir se entrou.
- **Terciária: quem vai cancelar** — antes de cancelar, quer saber quem perde acesso.

## Entrada e saída

- **Entrada:** Perfil › Conta › Pessoas. Também pela linha "Pessoas — 2 de 3" da tela de Plano.
- **Saída:**
  - convidar → `formSheet` na própria tela
  - limite do plano estourado → `modal /paywall` com origem `members`
  - "Ver lançamentos desta pessoa" → extrato filtrado por autor **(depende de filtro novo em
    `useTransactions`)**
- **Back:** `pop` para o Perfil.

> **28/08/2026** — "Só você por aqui" deixou de ser `EmptyState` e virou `Card` de explicação: a
> lista **nunca** está vazia (você sempre está nela), e um "nada aqui" logo abaixo de uma linha
> preenchida se contradiz. O botão "Ver planos" ficou só embaixo do "Convidar" desabilitado, que
> é onde a pessoa esbarra no limite — antes o mesmo rótulo aparecia duas vezes na mesma tela.

## Anatomia

Lista agrupada estilo Ajustes, igual ao Perfil — mesma linguagem, porque é a mesma pilha.

1. **Header nativo** — large title "Pessoas". `headerRight`: `person.badge.plus` (convidar), só
   para o dono e só quando cabe mais gente.
2. **"Espaço"** — nome do workspace, editável **inline** (o dono toca, vira campo, salva no blur).
   Uma `Row`, não um formulário. *Renomear é a única escrita em `workspaces` que o app precisa e
   hoje não existe em lugar nenhum.* Quem não é dono vê o nome em texto (policy
   `workspaces: owner writes`, `0010:95`).
3. **"Quem está aqui"** — `Row` por pessoa:
   - telefone formatado (**"você"** ao lado do próprio);
   - papel como texto secundário: *dono* / *membro*;
   - "desde março de 2026" (`created_at`).
4. **"Convites enviados"** — só pendentes, com telefone e quando foi. Uma linha explicando o
   mecanismo, que é o que o produto tem de mais elegante: *"O acesso entra sozinho quando a pessoa
   se cadastrar com esse número."* (`handle_new_user` e `accept_pending_invites`, `0029`).
5. **"Sobre o compartilhamento"**, texto secundário no fim, três linhas honestas: quem entra vê e
   lança **tudo**; cada lançamento guarda quem lançou; tirar alguém não apaga o que essa pessoa
   lançou.
6. **Sem card de destaque.** É uma lista de gente; o único glass é a chrome. O contador de plano
   (`2 de 3`) vive na tela de Plano e não se repete aqui — repetir número é como duas telas passam
   a discordar.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Pessoas | `useWorkspaceMembers()` **(novo)** | `['workspace-members']` | RPC `workspace_members_list()` **(nova)** | `workspace_members` **(a incluir na publicação)** |
| Nome do espaço | `useWorkspace()` **(novo)** | `['workspace']` | tabela `workspaces` | — |
| Renomear | `useRenameWorkspace()` **(novo)** | — | update em `workspaces` | invalida `['workspace']` |
| Convites | `useInvites()` | `['invites']` | `workspace_invites` | — |
| Convidar | `useInviteMember()` | — | insert em `workspace_invites` | invalida `['invites']` e `['plan-status']` |
| Revogar | `useRevokeInvite()` | — | update `status='revoked'` | invalida `['invites']` |
| Limite | `usePlanStatus()` | `['plan-status']` | RPC `plan_status()` | — |

**Por que `workspace_members_list()` é RPC e não `select`:** o telefone mora em `profiles`, que é
`own row`. A função é `security definer set search_path = public`, devolve **só** o que a tela
precisa (`user_id, phone, role, created_at`) para os workspaces de quem chamou, e nada mais de
`profiles` — nem `expo_push_token`, nem `timezone`. Ela é a exceção justificada; expor `profiles`
por policy para "membros do mesmo workspace" abriria a tabela inteira.

`useInvites` hoje é usada sem `isLoading` nem `isError` (`plan.tsx:58` desestrutura só `data`), e
`useRevokeInvite` (`use-finance.ts:1063`) não trata erro: revogar falha em silêncio. As duas coisas
se resolvem na mudança de tela, não depois.

**Convite só o dono enxerga:** a policy de `workspace_invites` é `owner manages` (`0029`), então
para um membro comum `useInvites` volta **vazio, sem erro**. A tela não pode mostrar "nenhum
convite" para quem simplesmente não tem permissão de ver: sem ser dono, a seção não existe.

## Ação primária

**Convidar por telefone.** Um campo, um botão, `formSheet`. O telefone é normalizado com DDI
(`normalizaTelefone`, `use-finance.ts:1035`) porque `profiles.phone` guarda `55` + dígitos e o
match do aceite é exato — sem isso o convite fica pendente para sempre.

Duas coisas que a tela precisa acertar e hoje não acerta:

- **Contar o convite pendente no limite.** `podeConvidar` (`plan.tsx:64-67`) compara `members <
  max_members` e ignora os pendentes, então dá para enfileirar convites além do plano. Quando o
  limite chegar, `accept_pending_invites` (`0029`) simplesmente **pula** o convite e ele fica
  pendente — sem avisar ninguém, dos dois lados. O botão passa a considerar
  `members + pendentes >= max_members` e manda para o paywall com o motivo escrito.
- **Erro específico.** Hoje qualquer falha vira *"Não deu para convidar (já convidou este
  número?)"* (`plan.tsx:236`). O `unique (workspace_id, phone)` do `0029` é uma causa conhecida e
  tem resposta própria: *"Esse número já foi convidado"* + **Ver convite**.

## Ações secundárias

- Renomear o espaço (inline).
- Context menu da pessoa: **Ver lançamentos dela** · **Remover do espaço** (destrutivo).
- Context menu do convite: **Reenviar pelo WhatsApp** (abre o WhatsApp com um texto pronto — o
  convite hoje não notifica ninguém) · **Revogar**.

**Remover** é action sheet nativo, com o texto que responde a dúvida real: *"Remover (51)
99999-8888? Ela perde o acesso agora. Os lançamentos que ela fez continuam no financeiro."*

O dono nunca aparece com "Remover" — não existe guarda no banco contra apagar a própria linha de
`owner`, e um workspace sem dono não tem quem administre nem quem cancele a assinatura. Enquanto
não houver `check`/trigger, **a UI é a única trava** e precisa ser explícita sobre isso.

## Estados

- **Loading** — `Skeleton` na forma da lista agrupada.
- **Empty (só você)** — `EmptyState` ícone `person.2`, título "Só você por aqui", dica acionável:
  *"Convide pelo telefone — a pessoa entra usando o mesmo número no WhatsApp e vocês compartilham
  o mesmo financeiro."* No Free (`max_members = 1`, `0029`) o texto muda para o que é verdade:
  *"O Free é para uma pessoa. O Pro abre para 3."* + caminho para o paywall.
- **Empty (sem convite pendente)** — a seção some. Não é estado, é ausência.
- **Error** — por seção, com "Tentar de novo". A lista de pessoas falhar não pode esconder o nome
  do espaço.
- **Limite atingido** — a `Row` "Convidar" fica desabilitada **com o motivo escrito** (*"Seu plano
  vai até 3 pessoas"*) e leva ao paywall. Botão cinza sem explicação é a forma mais rápida de
  perder uma venda.
- **Conteúdo longo** — nome de espaço longo trunca em uma linha; telefone nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Convite virando membro | explicação | a linha migra de "Convites" para "Quem está aqui" com `LinearTransition` em `Motion.base` — é o momento que explica o produto inteiro |
| Renomear (inline) | feedback | campo aparece em `Motion.fast`; haptic `selectionAsync` ao focar, `notificationAsync(Success)` ao salvar |
| Remover pessoa | mudança de estado | linha sai em `Motion.fast`; haptic `notificationAsync(Warning)`; toast sem desfazer (remover é reversível convidando de novo) |
| Convidar | feedback | `formSheet` na mola `Motion.spring.sheet`; sucesso fecha e a linha entra na lista |
| Entrada das seções | continuidade | `FadeInDown`, stagger 60 ms |

## Acessibilidade

- Cada `Row` é lida como frase: *"(51) 99999-8888, membro, desde março de 2026"*.
- "Você" é texto, não um selo colorido.
- Telefone `selectable` e lido dígito a dígito pelo leitor de tela.
- "Remover" com confirmação e `accessibilityRole="button"`; nunca destrutivo em um toque.
- Campo de convite com `keyboardType="phone-pad"` e `accessibilityLabel` dizendo o formato.
- Alvos ≥ 44pt; Dynamic Type XL empilha papel e data abaixo do telefone.

## Fora de escopo

- **Mostrar ou escolher o papel `viewer`.** O schema aceita (`0010:25`), a RLS **ignora**: um
  viewer escreve como qualquer membro. Exibir "somente leitura" seria uma promessa que o banco não
  cumpre — pior que não ter o recurso. Volta quando as policies olharem `role`, e aí é migration,
  não tela.
- **Transferir a propriedade do espaço.** Precisa de RPC e de regra sobre a assinatura junto
  (`subscriptions` é por workspace); não se resolve com um botão.
- **Sair do espaço por conta própria.** Hoje é impossível: a policy de escrita em
  `workspace_members` é `owner manages` (`0010:104`), então um membro não consegue apagar a própria
  linha. Precisa de RPC nova — e de decidir o que acontece com o que a pessoa lançou.
- **Mais de um workspace** (seletor, entrar em vários espaços): o schema permite, o produto ainda
  não tem esse caso. Ver `perfil.md`.
- **Convite por link ou QR.** O vínculo é o telefone, que é o mesmo do WhatsApp; link seria uma
  segunda identidade para manter.
- **Permissão por categoria ou por conta** ("ela só vê o mercado"): não existe no schema e não
  serve a nenhuma persona hoje.

## Pendência que esta tela expõe (não é de tela, é de banco)

`accept_pending_invites` (`0029`) respeita o limite do plano, mas `handle_new_user` (`0029`) aceita
os convites pendentes no cadastro **sem checar limite nenhum** — insere direto em
`workspace_members`. Ou seja: um workspace Free (`max_members = 1`) fica com 2 pessoas se o
convidado se cadastrar do zero. Nenhuma tela conserta isso; é migration.
