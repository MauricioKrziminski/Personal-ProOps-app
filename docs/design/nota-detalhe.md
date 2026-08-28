# Nota (detalhe) — `src/app/(tabs)/notes/[id].tsx`

**A tela que não existe hoje.** Não há detalhe de nota, não há edição de nota — nem no app, nem
como ação da IA. Hoje a nota nasce e morre; o único jeito de "corrigir" é apagar e escrever de
novo. Esta tela é a maior lacuna de produto da área.

Criar e editar são **a mesma tela**: `id === 'new'` entra em modo criação.

## Pergunta que responde

> "O que eu escrevi aqui, e como eu mexo nisso?"

## Persona

- **Primária: Marina, 26** — volta na nota para acrescentar, riscar item, mover de pasta.
- **Secundária: qualquer um corrigindo a IA.** A nota veio do WhatsApp na pasta errada; trocar
  precisa custar um toque.

## Entrada e saída

- **Entrada:** `push` da lista; deep link de push; `/notes/new` pelo header da lista.
- **Saída:** back = pop (com autosave garantido antes de sair). Seletor de pasta abre `formSheet`
  por cima e volta para cá.
- **Back:** nunca bloqueia. Autosave já salvou; não existe diálogo "descartar alterações?" porque
  não existe alteração não salva.

## Anatomia

1. **Header nativo** — título **"Nota"** (em criação, "Nova nota"), fixo. Ações por
   `HeaderActions`: pin (`pin` / `pin.fill`, com `selected`) e menu (`ellipsis.circle`) com Mover
   para pasta · Criar lembrete · Lixeira.
   *O header mostrava `noteTitle(content)` e o corpo renderizava a mesma primeira linha: a pessoa
   lia a frase duas vezes, com 40px de distância. Decidido com o usuário em 28/08 — **o título
   fica no corpo**, anatomia do Apple Notes.*
2. **Barra de propriedades** — pasta (ícone SF, toca e abre o picker), `#tags` derivadas, o botão
   `+ tag`, e `via WhatsApp · há 2 dias`. Somente leitura exceto pasta — tag se edita digitando
   `#` no corpo, que é o modelo inteiro.
   No iPhone os chips e o metadado **não cabem numa linha**; o `rowGap` é curto (`Space.xs`) de
   propósito, para o metadado quebrar colado nos chips em vez de flutuar sozinho no meio do
   caminho até o título.
   Depois de cada autosave, "Salvo" **substitui** o metadado por 1,5 s. Antes ele morava no
   header, e a pílula de vidro do iOS 26 mudava de largura a cada gravação.
3. **Corpo, modo leitura** — `readLines` (`src/lib/search.ts`) decide o que aparece:
   - a **primeira linha não vazia é o título**, em `subtitle` (22/600) — a mesma linha que
     `noteTitle` usa na lista, então a nota se chama igual nos dois lugares. Exceção: se ela for
     item de checklist, não vira título — promover um to-do a manchete custa a caixinha;
   - o resto é `default` (body 17/400), com `Space.sm` entre linhas. Antes eram `ThemedText`
     empilhados sem espaço nenhum, e cinco linhas viravam um bloco;
   - **`#tag` sai do texto exibido**, porque a mesma tag já é chip logo acima. O `content` fica
     intocado — é ele que volta inteiro para o WhatsApp e é ele que o modo edição mostra. Linha
     que ficaria vazia sem a tag mantém o texto original;
   - **linha vazia não vira linha**: o respiro entre parágrafos é o `gap` do container.
   O corpo inteiro é **um** alvo de toque com `flexGrow`, então o branco de uma nota curta é a
   área que abre a edição — antes eram 70% de tela morta.
4. **Corpo, modo edição** — `TextInput` multiline com o texto **cru** (com `#tag` e com `- [ ]`),
   cursor no fim. Sem toolbar de formatação: não há markdown rico.
5. **Checklist inline** — linha que começa com `- [ ]` ou `- [x]` renderiza um toggle na margem.
   Tocar reescreve **aquela linha** do texto (`readLines` devolve o índice no texto ORIGINAL, que
   é o que `toggleChecklistLine` precisa). O toggle é um `Pressable` dentro do corpo: ele ganha o
   gesto, então marcar um item **não** entra em edição.

## Dados

> Todos os hooks desta tela são **novos** — vivem em `src/hooks/use-notes.ts`, arquivo que
> ainda não existe. Ver `notas.md` §Dados para o prefixo de queryKey e a regra de realtime.

| O quê | Hook | Observação |
|---|---|---|
| Nota | `useNote(id)` → `['notes','item',id]` | `enabled: id !== 'new'` |
| Salvar | `useSaveNote()` | `id === 'new'` → insert e devolve id; senão update |
| Pin / lixeira | `useToggleNotePin`, `useTrashNote` | invalidam por prefixo `['notes']` |
| Pastas | `useNoteFolders()` | para o picker |

**Autosave:** debounce de 800 ms + no blur + no back. Em modo criação, o **primeiro** autosave é
que insere a linha e faz `router.setParams({ id })` — a partir daí é update.

Criar a linha vazia ao abrir a tela seria mais simples e está **rejeitado**: piscaria uma nota em
branco na lista de todo mundo via realtime, e exigiria limpeza no back.

## Ação primária

**Escrever.** O teclado abre sozinho em modo criação, e o cursor vai para o fim do texto em modo
edição — nunca para o começo, que é o erro clássico que faz o usuário rolar de volta.

## Ações secundárias

Pin · mover para pasta · criar lembrete (pré-preenche o form com a primeira linha da nota) ·
mandar para a lixeira. Destrutiva com action sheet nativo.

## Estados

- **Loading** — `Skeleton` com a forma: linha de título + bloco de texto. Nunca spinner centralizado
  numa tela que é 90% texto.
- **Empty** — não existe. Modo criação **é** a tela vazia, com placeholder: *"Escreve alguma
  coisa…"*.
- **Error** — nota não encontrada (apagada em outro device via realtime): estado próprio, com
  "Voltar para as notas". Falha de save: toast persistente + o texto **continua na tela**, nunca
  descartado.
- **Conteúdo longo** — scroll normal; header colapsa; o `TextInput` cresce.
- **Offline** — o texto fica; o save tenta de novo. Nunca sumir com o que o usuário digitou.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Teclado | continuidade | `react-native-keyboard-controller` — layout acompanha o teclado, sem listener + duração chutada |
| Toggle de checklist | feedback | marca em `Motion.fast`, haptic `selectionAsync` |
| Pin | mudança de estado | ícone troca `pin` → `pin.fill` com `scale` curto; haptic `impactAsync(Light)` |
| Indicador de salvo | feedback | "Salvo" aparece e desvanece em 1,5 s — discreto, no header. Sem spinner por letra digitada. |

Nada mais anima. É uma tela de escrever.

## Acessibilidade

- `TextInput` com `accessibilityLabel` "Conteúdo da nota".
- Toggle de checklist com `accessibilityState={{ checked }}` e label do item.
- Barra de propriedades navegável, pasta com `accessibilityRole="button"`.
- Dynamic Type XL: corpo escala junto; a barra de propriedades quebra em duas linhas.
- Alvos ≥ 44pt no toggle de checklist — a caixinha visual é menor, a área de toque não.

## Fora de escopo

Markdown rico · anexo · histórico de versões · colaboração em tempo real dentro da nota ·
compartilhar nota para fora do app.
