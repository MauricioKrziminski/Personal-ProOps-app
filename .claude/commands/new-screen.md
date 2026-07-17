---
description: Cria uma tela nova seguindo o design system do app (glass, estados, animações)
argument-hint: "<nome-da-tela> <o que ela mostra/faz>"
---

Crie a tela: $ARGUMENTS

Siga `.claude/rules/design.md` e `.claude/rules/frontend.md`. Checklist obrigatório:

1. **Rota**: decidir se é aba (`src/app/(tabs)/`) ou tela de stack/modal (`src/app/<dominio>/`, registrada no `_layout.tsx` raiz; form = `presentation: 'modal'`).
2. **Estrutura**: `ScrollView`/`FlatList` com `paddingBottom: BottomTabInset` (se sob tabs), conteúdo em `GlassCard`, textos via `ThemedText`, cores via `useTheme()`, espaçamento via `Spacing`.
3. **Dados**: hook TanStack no padrão de `src/hooks/use-items.ts` (queryKey própria, `useRealtimeInvalidate` se a tabela recebe dados via WhatsApp).
4. **Estados**: loading + empty (emoji, título, dica acionável) + error com retry — os três, sem exceção.
5. **Movimento**: entrada `FadeInDown` com stagger em listas; haptics em ações; micro-interações com moti onde couber.
6. **Form** (se houver): react-hook-form + zod; dinheiro via `MoneyInput` em centavos.
7. Verificar: `npx tsc --noEmit` + `npx expo lint` + conferir dark e light mode.
8. Ao final, rodar o subagente `ui-polisher` na tela e aplicar o que ele apontar.
