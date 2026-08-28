# Lixeira — `src/app/(tabs)/notes/trash.tsx`

Hoje apagar nota é `onLongPress` → `Alert` → `delete` definitivo, e o delete **falha em silêncio
total** (`useDeleteNote` não tem tratamento de erro). Perder uma nota por toque errado, sem
confirmação visível e sem volta, é o jeito mais rápido de fazer alguém parar de confiar no app.

Com `deleted_at` + purga aos 30 dias, apagar deixa de ser irreversível.

## Pergunta que responde

> "Apaguei sem querer — dá para voltar?"

Tela de baixa frequência e alta importância. Ninguém abre a lixeira por prazer; quem abre está
com um problema, e precisa resolver em dois toques.

## Persona

**Qualquer usuário, em pânico leve.** O tom da tela é de calma: diz quanto tempo resta, não
assusta, e deixa restaurar sem perguntar nada.

## Entrada e saída

- **Entrada:** `headerRight` da tela de Pastas; atalho em Perfil › Dados.
- **Saída:** back = pop. Restaurar mantém na tela, com a linha saindo da lista.
- **Back:** normal, nunca bloqueado.

## Anatomia

1. **Header nativo** — "Lixeira". `headerRight`: "Esvaziar" (só aparece com item, e só com
   confirmação).
2. **Faixa explicativa** no topo, uma linha: *"Notas na lixeira são apagadas de vez depois de 30
   dias."* Não é um card, é uma linha de texto secundário. A informação precisa estar visível
   **antes** de o usuário decidir se corre.
3. **Lista** — `Row` por nota: primeira linha do conteúdo, prévia curta, e **"apaga em N dias"**
   calculado de `deleted_at`. Ordenada por `deleted_at desc` — o que acabou de ser apagado é o que
   a pessoa veio buscar.
4. Sem chips, sem filtro, sem busca. Lixeira grande é sintoma, não caso de uso.

## Dados

> Todos os hooks desta tela são **novos** — vivem em `src/hooks/use-notes.ts`, arquivo que
> ainda não existe. Ver `notas.md` §Dados para o prefixo de queryKey e a regra de realtime.

| O quê | Hook | Observação |
|---|---|---|
| Lista | `useNotesList({ trash: true })` | mesma query da lista, com `.not('deleted_at','is',null)`; usa `notes_trash_idx` |
| Restaurar | `useRestoreNote()` | `update deleted_at = null` |
| Apagar de vez | `usePurgeNote()` | `delete` real |
| Esvaziar | `usePurgeNote()` em lote | — |

Purga automática é do cron `purge-trashed-notes` (`17 4 * * *`, `delete` SQL puro). A tela **não**
esconde item vencido por conta própria: se está lá, dá para restaurar. Confiar na data mostrada e
depois não restaurar seria pior que não mostrar data.

## Ação primária

**Restaurar.** Um toque na linha restaura direto — sem abrir a nota, sem confirmar. Restaurar é
não-destrutivo; pedir confirmação para desfazer um erro é ruído.

## Ações secundárias

Context menu: Ver conteúdo · Apagar de vez.
"Esvaziar lixeira" no header, com action sheet nativo e a contagem escrita: *"Apagar 12 notas de
vez?"* — número no texto, porque "esvaziar" sem número é como as pessoas apagam mais do que
queriam.

## Estados

- **Loading** — `Skeleton` de 4 linhas.
- **Empty** — ícone `trash`, "Lixeira vazia", subtítulo tranquilizador: *"Nada apagado nos últimos
  30 dias."* Aqui o empty é **boa notícia** e o texto reflete isso.
- **Error** — inline com retry.
- **Conteúdo longo** — prévia em uma linha; "apaga em N dias" nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Restaurar | mudança de estado | linha sai com `LinearTransition` em `Motion.base`; haptic `notificationAsync(Success)`; toast "Nota restaurada" |
| Apagar de vez | mudança de estado | mesma saída, haptic `notificationAsync(Warning)` |
| Esvaziar | mudança de estado | lista esvazia com stagger curto (40 ms) e cai no empty |
| Entrada | continuidade | `FadeInDown`, stagger 60 ms |

## Acessibilidade

- `Row` anuncia conteúdo + prazo ("Comprar leite, apaga em 12 dias").
- "Apaga em N dias" é texto, nunca só cor.
- "Esvaziar" com `accessibilityLabel` que inclui a contagem.
- Alvos ≥ 44pt.
- Dynamic Type XL: prazo quebra para a linha de baixo em vez de truncar.

## Fora de escopo

Busca dentro da lixeira · restaurar em lote · lixeira de lembretes (lembrete tem `active`, que é
outra semântica) · configurar o prazo de 30 dias.
