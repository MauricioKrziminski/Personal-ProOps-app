/**
 * O contrato da busca — **a mesma chamada nas duas plataformas**.
 *
 * Mora num `.types.ts` porque as implementações são arquivos separados (`search.tsx` e
 * `search.ios.tsx`) e o TypeScript resolve o import pelo arquivo-base: sem um tipo compartilhado,
 * uma das duas poderia divergir de props sem ninguém perceber até rodar no device.
 */
export interface SearchProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  /** O campo é só-ícone à esquerda e o placeholder some ao digitar. */
  accessibilityLabel?: string;
  /** iOS: deixar a barra sumir ao rolar. Ignorado onde o campo mora no corpo da tela. */
  hideWhenScrolling?: boolean;
  /**
   * A tela NÃO recua o próprio conteúdo (lista com `Screen scroll={false}`, header de
   * `FlashList`): o campo põe a calha padrão por conta.
   *
   * É prop e não um `<View>` em volta no call site de propósito — envolvendo por fora, o padding
   * sobreviveria no **iOS**, onde a busca não desenha nada no corpo, e abriria um buraco de 12 px
   * no topo da tela.
   */
  gutter?: boolean;
}
