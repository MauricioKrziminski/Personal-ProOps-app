import { ThemedText } from '@/components/themed-text';
import { type ThemeColor } from '@/constants/theme';
import { Type, tabular, type TypeVariant } from '@/design/tokens';
import { concealText, useConceal } from '@/components/ui/conceal';
import { formatBRL } from '@/hooks/use-items';
import { moneySign } from '@/lib/dates';

interface MoneyProps {
  /** SEMPRE centavos inteiros. Nunca float, nunca `parseFloat`. */
  cents: number;
  variant?: TypeVariant;
  /**
   * `auto` colore por sinal (verde entrando, cor de texto saindo — despesa NÃO é vermelha,
   * vermelho é para erro). `plain` não colore. Ou uma chave de cor explícita.
   */
  tone?: 'auto' | 'plain' | ThemeColor;
  /**
   * Mostra `+` na frente do valor POSITIVO. Útil em extrato, ruído em saldo.
   *
   * ⚠️ **O `−` do negativo não depende deste prop** (10/09/2026). Ele era opt-in junto com o
   * `+`, e o resultado era um saldo de −R$ 42.427,85 escrito "R$ 42.427,85" com a cor `danger`
   * como única pista de que a pessoa DEVE esse dinheiro em vez de TER. Cor não é sinal: some
   * em print, em daltonismo e em leitor de tela. Um caso já denunciava o defeito sozinho —
   * `import.tsx` escreve `cents={-somaDespesas}` de propósito e o `Math.abs` engolia.
   */
  signed?: boolean;
  /**
   * Obedece ao "esconder saldo" global. **Ligado por padrão.**
   *
   * Nasceu opt-in e isso estava errado: com 96 `<Money>` no app, marcar um a um garante que
   * metade fica de fora, e um esconder que vaza no extrato, na conta e no patrimônio é teatro —
   * a falha nº 1 documentada desse padrão. Ocultar é a regra; aparecer é a exceção.
   *
   * `concealable={false}` fica para **superfície de decisão**: o valor que a pessoa está
   * digitando, e o valor que ela confirma ("você vai pagar R$ 1.800"). Ali esconder faria alguém
   * confirmar no escuro, que é pior do que qualquer risco de alguém olhar por cima do ombro.
   */
  concealable?: boolean;
}

/**
 * Exibição de dinheiro. Sempre `tabular-nums` — sem isso o valor muda de largura ao animar e a
 * coluna da direita "dança" enquanto a lista rola.
 */
export function Money({
  cents,
  variant = 'body',
  tone = 'plain',
  signed = false,
  concealable = true,
}: MoneyProps) {
  const { concealed } = useConceal();
  const oculto = concealable && concealed;

  const color: ThemeColor =
    tone === 'auto' ? (cents >= 0 ? 'success' : 'text') : tone === 'plain' ? 'text' : tone;

  const prefix = moneySign(cents, signed);
  const texto = formatBRL(Math.abs(cents));

  return (
    <ThemedText
      themeColor={color}
      // Oculto não é selecionável: copiar blocos não serve para nada, e copiar o valor real por
      // baixo da máscara derrotaria o propósito.
      selectable={!oculto}
      accessibilityLabel={oculto ? 'Valor oculto' : undefined}
      // `Type[variant]` já carrega a família certa (Hanken no display, JetBrains no `ticker`).
      // `flexShrink: 0` desfaz o padrão do `ThemedText`: numa linha "rótulo … R$ 1.350,00" os
      // dois encolheriam proporcionalmente e o VALOR quebraria no meio dos dígitos. Número não
      // cede — quem cede é o rótulo ao lado.
      style={[Type[variant], tabular, { flexShrink: 0 }]}>
      {oculto ? concealText() : `${prefix}${texto}`}
    </ThemedText>
  );
}
