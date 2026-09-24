import { createContext, useContext } from 'react';

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
  /**
   * Encolhe a fonte para caber (`adjustsFontSizeToFit`). DESLIGADO por padrão desde 24/09/2026:
   * no iPhone o texto que encolhe numa passada de layout estreita não volta a crescer, e valores
   * soltos no ciclo ("Comecei com", a parcela do macbook) ficavam minúsculos. Onde o layout dá
   * espaço — a `Row` manda o valor para baixo do título quando ele não cabe — não há o que
   * encolher. Quem tem geometria FIXA (face do cartão, ladrilho, herói) liga por
   * `DinheiroEncolhe`, sem cada tela lembrar.
   */
  encolhe?: boolean;
}

/**
 * Bloco de geometria FIXA — a face do cartão, o ladrilho, o número do herói: lá o valor não tem
 * para onde descer, e encolher é o único jeito de não partir no meio dos dígitos nem cortar.
 */
export const DinheiroEncolhe = createContext(false);

/**
 * Dentro de um card que arrasta (`Deslizavel`) o valor não é selecionável: no Android o arrasto
 * que começa em cima do número selecionava a palavra, e o toque longo ali é o menu do card.
 */
export const DentroDeArrasto = createContext(false);

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
  encolhe: encolhePedido,
}: MoneyProps) {
  const { concealed } = useConceal();
  const noBlocoFixo = useContext(DinheiroEncolhe);
  const encolhe = encolhePedido ?? noBlocoFixo;
  const oculto = concealable && concealed;
  const noArrasto = useContext(DentroDeArrasto);

  const color: ThemeColor =
    tone === 'auto' ? (cents >= 0 ? 'success' : 'text') : tone === 'plain' ? 'text' : tone;

  const prefix = moneySign(cents, signed);
  const texto = formatBRL(Math.abs(cents));

  return (
    <ThemedText
      themeColor={color}
      // Oculto não é selecionável: copiar blocos não serve para nada, e copiar o valor real por
      // baixo da máscara derrotaria o propósito.
      selectable={!oculto && !noArrasto}
      accessibilityLabel={oculto ? 'Valor oculto' : undefined}
      // `flexShrink: 0` desfaz o padrão do `ThemedText`: numa LINHA "rótulo … R$ 1.350,00" quem
      // cede é o rótulo ao lado, não o número.
      //
      // ⚠️ Isso NÃO basta numa COLUNA estreita (23/09/2026): ali o texto é medido na largura do
      // pai e, sem limite de linhas, partia no meio dos dígitos — "R$ 1.423,0" / "0" na face do
      // cartão a 375dp × fonte 1,3. Dinheiro fica em UMA linha e, se não couber, encolhe até
      // caber; reticência nunca aparece, porque `adjustsFontSizeToFit` reduz antes de cortar.
      numberOfLines={1}
      adjustsFontSizeToFit={encolhe}
      minimumFontScale={encolhe ? 0.5 : undefined}
      style={[Type[variant], tabular, { flexShrink: 0 }]}>
      {oculto ? concealText() : `${prefix}${texto}`}
    </ThemedText>
  );
}
