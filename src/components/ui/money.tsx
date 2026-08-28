import { ThemedText } from '@/components/themed-text';
import { Fonts, type ThemeColor } from '@/constants/theme';
import { Type, tabular, type TypeVariant } from '@/design/tokens';
import { formatBRL } from '@/hooks/use-items';

interface MoneyProps {
  /** SEMPRE centavos inteiros. Nunca float, nunca `parseFloat`. */
  cents: number;
  variant?: TypeVariant;
  /**
   * `auto` colore por sinal (verde entrando, cor de texto saindo — despesa NÃO é vermelha,
   * vermelho é para erro). `plain` não colore. Ou uma chave de cor explícita.
   */
  tone?: 'auto' | 'plain' | ThemeColor;
  /** Mostra `+`/`−` na frente. Útil em extrato, ruído em saldo. */
  signed?: boolean;
}

/**
 * Exibição de dinheiro. Sempre `tabular-nums` — sem isso o valor muda de largura ao animar e a
 * coluna da direita "dança" enquanto a lista rola.
 */
export function Money({ cents, variant = 'body', tone = 'plain', signed = false }: MoneyProps) {
  const color: ThemeColor =
    tone === 'auto' ? (cents >= 0 ? 'success' : 'text') : tone === 'plain' ? 'text' : tone;

  const prefix = signed ? (cents > 0 ? '+' : cents < 0 ? '−' : '') : '';
  const isMoneyDisplay = variant === 'money';

  return (
    <ThemedText
      themeColor={color}
      selectable
      style={[
        Type[variant],
        tabular,
        isMoneyDisplay && { fontFamily: Fonts?.rounded },
      ]}>
      {prefix}
      {formatBRL(Math.abs(cents))}
    </ThemedText>
  );
}
