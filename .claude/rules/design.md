# Design — Liquid Glass estilo iOS (obrigatório)

O app deve ser **totalmente moderno e bonito, estilo iOS**. Nenhuma tela é entregue "crua".

## Superfícies

- **Liquid Glass** em cards, headers e sheets: componente central `src/components/glass/glass-card.tsx` (`GlassCard`). Ele já resolve `isLiquidGlassAvailable()` → `GlassView` nativo (iOS 26+) com fallback `BlurView` (`expo-blur`) em iOS antigo/Android/web. **Nunca** usar `GlassView`/`BlurView` direto numa tela — sempre via `GlassCard` (variants: `regular` | `clear`).
- **Tab bar**: `NativeTabs` do expo-router (`src/components/app-tabs.tsx`), liquid glass nativa no iOS 26. SF Symbols no iOS, PNG `renderingMode="template"` no Android (ícones em `assets/images/tabIcons/`).

## Tokens (fonte única: `src/constants/theme.ts`)

- **Cores**: sempre via `useTheme()` (`src/hooks/use-theme.ts`) → `Colors[scheme]`. Nunca hardcodar hex em telas. Chaves: `text, textSecondary, background, backgroundElement, backgroundSelected, tint, danger`.
- **Dark mode**: automático (`userInterfaceStyle: automatic`). Toda cor nova precisa das variantes light e dark.
- **Tipografia**: `Fonts` por plataforma (iOS `ui-rounded` para display, `system-ui` texto). Escala em `src/components/themed-text.tsx` (`title` 48, `subtitle` 32, `default` 16, `small` 14) — usar `ThemedText type=...`, não `fontSize` solto.
- **Spacing**: escala `Spacing.half..six` (2..64). `BottomTabInset` no padding inferior de toda tela com tabs. `MaxContentWidth` (800) para web/tablet.

## Movimento e feedback

- Animações com **react-native-reanimated v4** (entradas `FadeInDown` com stagger por índice em listas — padrão já usado nas telas atuais) e **moti** para micro-interações (press, aparição de FAB, progresso).
- **expo-haptics** em toda ação importante: submit de form, delete, login/logout, complete de meta.
- Transições de navegação suaves; modais como sheet (`presentation: 'modal'`).

## Estados obrigatórios em TODA tela nova

1. **Loading** — skeleton ou spinner discreto dentro de GlassCard.
2. **Empty** — emoji grande + título + dica acionável (padrão das telas atuais, ex.: dica de mandar mensagem no WhatsApp).
3. **Error** — GlassCard de erro com mensagem amigável + botão "Tentar de novo" (refetch). Nunca falhar silenciosamente para o empty state.

Cantos generosos (radius ≥ 16), profundidade e translucidez. Textos de UI em pt-BR.
