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

1. **Header nativo** — título é a primeira linha da nota, truncado; em modo criação, "Nova nota".
   `headerRight`: pin (`pin` / `pin.fill`) e menu (`ellipsis.circle`) com Mover para pasta ·
   Criar lembrete · Lixeira.
2. **Barra de propriedades** — uma linha discreta abaixo do header: pasta (com ícone SF, toca e
   abre o picker), `#tags` derivadas, e `via WhatsApp · há 2 dias`. Somente leitura exceto pasta —
   tag se edita digitando `#` no corpo, que é o modelo inteiro.
3. **Corpo** — `TextInput` multiline, ocupando o resto da tela, fonte de leitura confortável
   (Body, não Footnote). Sem toolbar de formatação: não há markdown rico.
4. **Checklist inline** — linha que começa com `- [ ]` ou `- [x]` renderiza um toggle na margem.
   Tocar reescreve **aquela linha** do texto. É a única "riqueza" do editor, e existe porque
   mantém a nota sendo texto puro que volta pro WhatsApp.

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
