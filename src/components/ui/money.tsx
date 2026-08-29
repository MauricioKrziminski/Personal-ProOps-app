import { ThemedText } from '@/components/themed-text';
import { Fonts, type ThemeColor } from '@/constants/theme';
import { Type, tabular, type TypeVariant } from '@/design/tokens';
import { concealText, useConceal } from '@/components/ui/conceal';
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
  /**
   * Obedece ao "esconder saldo" global.
   *
   * Opt-in de propósito: valor de **entrada de formulário** e de confirmação ("você vai pagar
   * R$ 1.800") não pode sumir junto, senão o usuário confirma no escuro.
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
  concealable = false,
}: MoneyProps) {
  const { concealed } = useConceal();
  const oculto = concealable && concealed;

  const color: ThemeColor =
    tone === 'auto' ? (cents >= 0 ? 'success' : 'text') : tone === 'plain' ? 'text' : tone;

  const prefix = signed ? (cents > 0 ? '+' : cents < 0 ? '−' : '') : '';
  const isMoneyDisplay = variant === 'money' || variant === 'heroMoney';
  const texto = formatBRL(Math.abs(cents));

  return (
    <ThemedText
      themeColor={color}
      // Oculto não é selecionável: copiar blocos não serve para nada, e copiar o valor real por
      // baixo da máscara derrotaria o propósito.
      selectable={!oculto}
      accessibilityLabel={oculto ? 'Valor oculto' : undefined}
      style={[
        Type[variant],
        tabular,
        isMoneyDisplay && { fontFamily: Fonts?.rounded },
      ]}>
      {oculto ? concealText(texto.length - 3) : `${prefix}${texto}`}
    </ThemedText>
  );
}
