---
description: Cria uma tela nova seguindo o design system do app (tokens, estados, movimento)
argument-hint: "<nome-da-tela> <o que ela mostra/faz>"
---

Crie a tela: $ARGUMENTS

Siga `.claude/rules/design.md` e `.claude/rules/frontend.md`. Checklist obrigatório:

1. **Rota**: decidir se é aba (`src/app/(tabs)/`) ou tela de stack/modal (`src/app/<dominio>/`, registrada no `_layout.tsx` raiz; form = `presentation: 'modal'`).
2. **Estrutura**: dentro do `<Screen>` (ritmo vertical, calha e busca moram nele; tela de conteúdo fora dele quebra o `anti-slop.test.ts`), conteúdo em `Card` opaco, textos via `ThemedText`, cores via `useTheme()`, espaçamento via `Space`.
3. **Dados**: hook TanStack no padrão de `src/hooks/use-items.ts` (queryKey própria, `useRealtimeInvalidate` se a tabela recebe dados via WhatsApp).
4. **Estados**: loading (`Skeleton` com a forma do conteúdo) + empty (`EmptyState`: símbolo, título, dica acionável; `compacto` quando não é a única coisa da tela) + error com retry — os três, sem exceção.
5. **Movimento**: a entrada vem da cascata do `<Screen>`; haptics em ações; animação só com propósito (`design.md` §5).
6. **Form** (se houver): react-hook-form + zod; dinheiro via `MoneyField` em centavos.
7. Verificar: `npx tsc --noEmit` + `npx expo lint` + conferir dark e light mode.
8. Ao final, rodar o subagente `ui-polisher` na tela e aplicar o que ele apontar.
