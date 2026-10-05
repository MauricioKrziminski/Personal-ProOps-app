# MoneyField — primeiro dígito sumia no "Aporte inicial" (05/10/2026)

Plano de metas, Reserva de emergência, staging, sessão dev@, somente leitura (Salvar nunca tocado).

- Antes (Android s26, `emulator-5574`): digitar `75,00`; quando a prévia recalcula (`busy` liga/desliga, `readOnly` troca a cor) o campo pinta `5,00` — `android-antes.png`.
- Causa: o 1º dígito é uma casa nova (`animar`) que vive do estilo animado do Reanimated (`opacity`/`transform` de `useAnimatedStyle`). O re-render posterior que muda só a cor (`readOnly`) reaplica o estilo no Android e perde o valor animado: a casa fica invisível, com o texto certo na árvore. O campo Valor de `/finance/lancar` não sofre porque nada re-renderiza o campo depois da animação. É a família "o repouso é escrito pelo React" (`design.md` §5).
- Correção em `Digito` (`src/components/ui/field.tsx`): 300 ms depois da troca a casa assenta no estilo final explícito (`REPOUSO`) e a camada que saiu deixa de existir; não depende mais do Reanimated.
- Depois: Android `android-depois-75.png`, `android-depois-1234.png`; iPhone 17 Pro (simulador) `ios-depois-75.png`, `ios-depois-1234.png` — todos os dígitos visíveis, com a prévia já recalculada.
- Teste: `src/lib/money-field-fit.test.ts` (checa o assentamento no fonte de `Digito`; falha sem a correção). O harness de `node --test` não executa efeitos/Reanimated, então a prova comportamental é a dos aparelhos acima.
