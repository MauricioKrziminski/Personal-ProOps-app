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
      {oculto ? concealText() : `${prefix}${texto}`}
    </ThemedText>
  );
}
