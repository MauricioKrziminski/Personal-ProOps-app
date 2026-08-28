# Notas — `src/app/(tabs)/notes/index.tsx` *(diretório novo)*

Aba 2. Hoje é `(tabs)/index.tsx`: lista plana com `limit(100)`, um input de uma linha e chips de
categoria derivados em memória. **Não existe tela de detalhe e não existe edição de nota em lugar
nenhum do produto** — nem no app, nem como ação da IA. A lista é o fim da linha.

## Estrutura de rota (resolvida, sem spike)

A doc do Expo é explícita: *"native tabs do not include a mock stack header. To achieve header
functionality and support screen navigation, developers must nest a native Stack layout directly
inside the native tabs."* Ou seja, **o Stack aninhado não é opção, é requisito** para ter large
title nativo e `<Stack.SearchBar>`.

A aba vira um **diretório comum**, não um grupo:

```
(tabs)/notes/_layout.tsx    → <Stack>, unstable_settings = { initialRouteName: 'index' }
(tabs)/notes/index.tsx      → /notes        (lista)
(tabs)/notes/[id].tsx       → /notes/[id]   (detalhe)
(tabs)/notes/folders.tsx    → /notes/folders
(tabs)/notes/trash.tsx      → /notes/trash
```

`NativeTabs.Trigger name="notes"` — nome simples, sem parênteses, **sem incógnita**.

> Isto corrige um defeito do desenho original, que colocava a aba num grupo `(notes)`: grupo não
> entra no caminho, então `(tabs)/(notes)/index.tsx` mapearia para `/` e **colidiria com a aba
> Hoje**. Diretório comum elimina a colisão e o desconhecido de uma vez.

Consequência aceita: o detalhe é `push` **dentro da pilha da aba**, então a tab bar continua
visível. É o padrão iOS de lista → detalhe dentro de uma aba (Things, Lembretes). Se algum dia
precisar de tela cheia, a rota sobe para o Stack raiz sem mexer em mais nada.

`folders.tsx` e `trash.tsx` são estáticas e convivem com `[id].tsx` — expo-router resolve estático
antes de dinâmico.

**As outras três abas precisam do mesmo tratamento** pelo mesmo motivo (header nativo): vira
`(tabs)/index.tsx` → grupo/diretório próprio na fase 2. Está registrado no plano.

## Pergunta que responde

> "Onde está aquilo que eu anotei?"

E a segunda, que decide se o usuário volta: **"consigo capturar em dois segundos?"**

## Persona

- **Primária: Marina, 26** — segundo cérebro. Anota 10× por dia; nota sem estrutura vira lixo em
  duas semanas.
- **Secundária: Camila, 34** — usa nota como lista leve; quer checklist.
- **Transversal:** boa parte das notas **chega pelo WhatsApp**, já com a categoria que a IA
  escolheu. Corrigir a IA precisa ser mais fácil do que digitar do zero.

## O modelo, e o que ele deliberadamente não é

A sensação de Notion no celular vem de **quatro** coisas: pasta com nome e ícone, busca que acha
em português, captura instantânea e uma lixeira que perdoa. Editor de blocos não está nessa lista.

| Conceito | Como é feito | Por que não do outro jeito |
|---|---|---|
| **Pasta** | `note_folders`, **um nível**, `unique (workspace_id, name)` completo, `icon` = nome de SF Symbol | Aninhamento exige breadcrumb, seletor recursivo, anti-ciclo e CTE. Unique completo mantém o `.upsert()` legal (parcial cairia no `42P10`). |
| **Nota → pasta** | `notes.folder_id`, `on delete set null` | Apagar pasta **nunca** apaga nota. |
| **Tag** | `notes.tags text[]` **gerado** dos `#hashtag` do próprio conteúdo, + GIN | Tabela de tags nasceria vazia: ninguém digita tag no WhatsApp. O usuário já digita `#`. Zero caminho de escrita, zero tela de gestão, zero mudança no contrato da IA. |
| **Título** | primeira linha do conteúdo, calculada na tela | Coluna `title` viria null em 100% das notas do WhatsApp → lista com duas aparências. |
| **Checklist** | linhas `- [ ]` / `- [x]` dentro do conteúdo | Tabela filha ou `jsonb` quebra o round-trip: a nota deixa de ser texto que volta pro WhatsApp. |
| **Busca** | `search_tsv` gerado com config `pt_unaccent` (`portuguese` + `unaccent`) + GIN | `unaccent` faz "reuniao" achar "reunião" — sem ele metade das buscas do brasileiro falha em silêncio. O stemmer colapsa plural regular (casas→casa). **Medido:** ão/ões NÃO colapsa, nem aqui nem em `portuguese` puro — a config escolhida é estritamente melhor, mas não prometa plural irregular. |
| **Apagar** | `deleted_at` + cron de purga aos 30 dias | Delete direto é o jeito mais rápido de perder confiança. |
| **Fixar** | `pinned boolean` | — |

**Sem** cor por nota (o design system tem um accent só), **sem** ordenação manual, **sem** anexo,
**sem** FK nota↔lembrete. Detalhe e justificativa de cada corte: §7 do plano da área.

## Entrada e saída

- **Entrada:** aba; deep link de push.
- **Saída:** detalhe `push /notes/[id]`; pastas `push /notes/folders`; lixeira `push /notes/trash`
  (entrada pelo header de Pastas). Seletor de pasta é `formSheet` registrado no Stack da aba,
  detents `[0.5, 0.9]`.
- **Back:** dentro da aba, pop. Na raiz da aba, sai do app (Android). Busca aberta consome o
  primeiro back; o segundo fecha. Re-tap na aba volta à raiz da pilha.

## Anatomia

1. **Header nativo** — large title "Notas", `<Stack.SearchBar placement="automatic">`.
   `headerRight`: nota longa (abre `/notes/new`) e menu com Pastas.
2. **Quick-add de uma linha, no topo da lista** (`ListHeaderComponent`). É a captura de dois
   segundos e o coração do produto — não vai atrás de FAB nenhum.

   > Corrigido depois de ver no simulador: fixo **fora** do scroller ele renderizava por cima da
   > barra de status (o header nativo não reserva altura para irmão que não rola), e ainda
   > impedia o large title de colapsar. Dentro do `ListHeaderComponent` some ao rolar — e rolar
   > é o gesto de *ler*, não o de *capturar*.
3. **Chips de pasta e de tag em UMA faixa** no `ListHeaderComponent` (reusa
   `src/components/finance/chip.tsx`), com filete separando os dois filtros. Somem quando não
   existe pasta nem tag — usuário novo não vê estrutura vazia.

   > Corrigido depois de ver rodando: em duas faixas empilhadas, a tela abria com **quatro**
   > fileiras de controle (busca, quick-add, pastas, tags) antes da primeira nota — pedia
   > configuração em vez de mostrar conteúdo. Numa faixa só, são três.
4. **Fixadas** no topo da lista, com rótulo discreto — não com card separado.
5. **Lista** (`FlashList`) sobre fundo agrupado: cada linha traz primeira linha como título,
   prévia de duas linhas, e a faixa de metadados — pasta, `#tags`, `3/5` quando tem checklist,
   `via WhatsApp`. Tag com o mesmo nome da pasta não repete (`mercado · #mercado`).

   > As linhas moram numa **superfície agrupada** — cantos arredondados nas pontas de cada grupo
   > (Fixadas, Notas) e hairline entre irmãs, igual ao `Section` da Hoje. Soltas na margem, as
   > duas abas pareciam de apps diferentes.

   Título e prévia mostram o **texto**, nunca a marcação: `stripMarkup` em `src/lib/search.ts`
   tira o `- [ ]` / `- [x]` antes de exibir, senão a prévia de um checklist vazava
   `- [x] leite - [ ] pão`.

Ordenação: `pinned desc, updated_at desc`. Recência bate relevância em nota pessoal, e ranking
por `ts_rank` exigiria RPC (o PostgREST não ordena por expressão).

## Dados

`src/hooks/use-notes.ts` (arquivo novo). **Todo queryKey sob o prefixo `['notes', …]`** — assim um
único `useRealtimeInvalidate('notes', ['notes'])` invalida lista, item e contagens por prefixo, em
vez de quatro canais.

| Hook | queryKey | Observação |
|---|---|---|
| `useNotesList({folderId, tag, q, trash})` | `['notes','list',filtros]` | `useInfiniteQuery`, página 30, `.range()` |
| `useNote(id)` | `['notes','item',id]` | detalhe |
| `useSaveNote` · `useToggleNotePin` · `useTrashNote` · `useRestoreNote` · `usePurgeNote` | — | trash = `update deleted_at`; purge = delete real |
| `useNoteFolders()` | `['notes','folders']` | pastas + RPC `note_folder_counts()`; realtime em `note_folders` |
| `useNoteTags()` | `['notes','tags']` | RPC `note_tag_counts()` |

**Nunca `select('*')` em nota** — `search_tsv` e `tags` são colunas geradas e grandes. A lista pede
exatamente `id, content, folder_id, pinned, source, updated_at, created_at`. Numa lista de 30 isso
é a diferença entre payload normal e o triplo dele.

Busca: `src/lib/search.ts` → `toTsQuery(input)` (minúsculas, split, `:*` no último termo, ` & `,
string vazia se não sobrar termo — o prefixo é o que faz busca-enquanto-digita funcionar).
Companheiro obrigatório `src/lib/search.test.ts` (`node --test`, convenção de `dates.test.ts`).

## Ação primária

**Capturar uma nota.** Um campo, sempre visível, sem navegar.

## Ações secundárias

**Context menu nativo** (`Link.Menu`) na linha — substitui o `onLongPress` + `Alert` de hoje:
Fixar · Mover para pasta · Criar lembrete · Lixeira.
Confirmação destrutiva em **action sheet nativo**.
Swipe: direita fixa, esquerda manda para a lixeira. Toda ação de swipe existe também no menu —
swipe sozinho não é acessível.

## Estados

- **Loading** — `Skeleton` na forma da linha (título + duas linhas), 6 itens.
- **Empty absoluto** — ícone `note.text`, "Nada anotado ainda", dica acionável: *"Escreve aqui em
  cima — ou manda `anotar: ligar pro dentista` no WhatsApp"*.
- **Empty de filtro** — texto próprio + "Limpar filtro". Dizer "nada anotado ainda" para quem tem
  200 notas é mentira.
- **Empty de busca** — "Nada encontrado para «x»", com atalho para buscar na lixeira.
- **Error** — inline com retry; falha em pastas não derruba a lista.
- **Conteúdo longo** — título uma linha, prévia duas, tags com overflow `+3`.

> Enquanto `src/components/ui/*` e `src/design/tokens.ts` não existirem, usar `ErrorCard`/
> `LoadingCard` atuais. Esta área **depende** da fase 1 do design system.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Quick-add ganhando foco | continuidade | cresce para multilinha em `Motion.fast`; teclado por `react-native-keyboard-controller`, nunca listener + duração chutada |
| Fixar / lixeira | mudança de estado | `LinearTransition` reposiciona a linha, `Motion.base`; haptic `impactAsync(Light)` |
| Swipe | feedback | `react-native-gesture-handler`, rubber-band no limite, mola com a velocidade da soltura |
| Filtro de pasta | mudança de estado | cross-fade da lista em `Motion.fast` — animar item a item aqui é ruído |
| Press na linha | feedback | highlight de fundo, não scale |
| Nota nova via WhatsApp | explicação | `FadeInDown` + destaque de 1,2 s que desvanece |

**Sem `entering` em linha reciclada de `FlashList`** — só no primeiro render.

## Acessibilidade

- `Row` com label composto: título, pasta, número de tags.
- Checklist com `accessibilityState={{ checked }}`.
- Alvos ≥ 44pt; swipe sempre duplicado no context menu.
- Dynamic Type XL: prévia cai para uma linha, metadados quebram para baixo.
- Conteúdo `selectable`.

## Fora de escopo

Editor de blocos · markdown rico · pasta aninhada · ordenação manual · cor por nota · anexo ·
tabela de tags · coluna `title` · `ts_rank` · colaboração em tempo real dentro da nota.
