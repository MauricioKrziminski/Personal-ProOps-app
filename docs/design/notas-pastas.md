# Pastas — `src/app/(tabs)/notes/folders.tsx` + `folder-picker`

Duas superfícies para o mesmo dado, com papéis diferentes:

- **`/notes/folders`** (`push`) — gerenciar: criar, renomear, trocar ícone, apagar.
- **`folder-picker`** (`formSheet`, detents `[0.5, 0.9]`) — escolher, a partir do detalhe da nota.

Separadas de propósito: escolher precisa ser rápido e cancelável com um arrasto; gerenciar precisa
de espaço e de context menu. Uma tela só faria as duas coisas mal.

## Pergunta que responde

> Gerenciar: "como eu organizo isso?"
> Picker: "onde essa nota vai?"

## Persona

**Marina, 26.** É a única persona que abre a tela de gestão — e abre poucas vezes, no começo.
O picker, ao contrário, é usado toda semana, inclusive para **consertar a pasta que a IA
escolheu** a partir de uma mensagem do WhatsApp.

## Entrada e saída

- **Gerenciar:** entrada pelo menu do header da lista de Notas. `headerRight` leva para a Lixeira.
  Back = pop.
- **Picker:** entrada pela barra de propriedades do detalhe. Escolher aplica e fecha; arrastar
  para baixo cancela sem aplicar.

## Anatomia — gerenciar

1. **Header nativo** — "Pastas". `headerRight`: `trash` → `/notes/trash`.
2. **Campo inline "Nova pasta"** no topo — nome + grade de ~12 ícones SF (`folder`, `briefcase`,
   `lightbulb`, `cart`, `heart`, `book`, `airplane`, `house`, `dumbbell`, `pills`, `gift`,
   `graduationcap`). **Grade de símbolos, nunca picker de emoji** — a regra de design proíbe emoji
   na chrome, e um catálogo fechado é o que mantém a lista visualmente coerente.
3. **Lista de pastas** — `Row` com ícone, nome e contagem de notas (RPC `note_folder_counts()`).
4. **"Sem pasta"** — sempre no fim, com a contagem. Não é uma pasta real (`folder_id is null`),
   mas o usuário precisa vê-la para saber que existe nota solta.

## Anatomia — picker

1. **Grabber** e título curto "Mover para".
2. Campo de busca só quando houver mais de 8 pastas — antes disso é ruído.
3. Lista de pastas com ícone e check na atual.
4. **"Sem pasta"** no topo, como forma de tirar a nota de uma pasta.
5. **"Nova pasta…"** no fim — cria e já move, sem sair do sheet. Sem isso o usuário precisa
   abandonar a nota para criar a pasta que ele acabou de descobrir que precisa.

## Dados

> Todos os hooks desta tela são **novos** — vivem em `src/hooks/use-notes.ts`, arquivo que
> ainda não existe. Ver `notas.md` §Dados para o prefixo de queryKey e a regra de realtime.

| O quê | Hook | Fonte |
|---|---|---|
| Pastas + contagem | `useNoteFolders()` → `['notes','folders']` | `note_folders` + RPC `note_folder_counts()` (`Promise.all`) |
| Criar / renomear / ícone | `useSaveFolder()` | `.upsert(..., { onConflict: 'workspace_id,name' })` — funciona porque o unique é **completo** |
| Apagar | `useDeleteFolder()` | `on delete set null` nas notas |
| Mover nota | `useSaveNote()` | só `folder_id` |

Realtime em `note_folders`. `name` é sempre gravado em `lower(trim())` — é o que mantém o unique
honesto e o `.upsert()` legal.

## Ação primária

- Gerenciar: **criar pasta.** Campo no topo, sem modal.
- Picker: **escolher.** Um toque aplica e fecha; não existe botão "Confirmar".

## Ações secundárias

Context menu nativo na `Row`: Renomear · Trocar ícone · Apagar.
Apagar mostra action sheet com a consequência escrita: *"As N notas ficam em Sem pasta."*
**Apagar pasta nunca apaga nota** — é a diferença entre "organizei errado" e "perdi minhas notas".

## Estados

- **Loading** — `Skeleton` de 4 linhas.
- **Empty** — ícone `folder`, "Nenhuma pasta ainda", dica: *"Pastas aparecem sozinhas quando você
  manda `anotar: comprar leite #mercado` no WhatsApp — ou cria uma aqui."*
  Explica o mecanismo automático, que é o que a maioria vai usar sem saber.
- **Error** — inline com retry.
- **Nome duplicado** — erro no campo, específico: *"Já existe uma pasta «mercado»."* Nunca o
  "Não deu para salvar (nome repetido?)" genérico que as telas atuais usam.
- **Conteúdo longo** — nome trunca em uma linha; contagem nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Sheet do picker | continuidade espacial | `formSheet` nativo com detents; arrasto interrompível, mola na soltura |
| Pasta nova entrando | mudança de estado | `LinearTransition`, `Motion.base`; haptic `notificationAsync(Success)` |
| Seleção de ícone | feedback | check em `Motion.fast`, haptic `selectionAsync` |
| Apagar | mudança de estado | linha sai com `LinearTransition`; as de baixo sobem |

## Acessibilidade

- Grade de ícones com `accessibilityLabel` por símbolo em pt-BR ("pasta", "maleta", "lâmpada") —
  o nome do SF Symbol é inglês e não serve de label.
- `Row` anuncia nome + contagem ("Mercado, 12 notas").
- Check do picker via `accessibilityState={{ selected }}`, não só por cor.
- Alvos ≥ 44pt na grade de ícones (o ícone é menor que a área de toque).
- Dynamic Type XL: a grade reduz de colunas em vez de truncar.

## Fora de escopo

Pasta aninhada (`parent_id`) · cor por pasta (um accent só) · reordenar à mão (ordem é
alfabética) · compartilhar pasta · ícone customizado fora do catálogo.
