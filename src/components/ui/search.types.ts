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
  /**
   * iOS: deixar a barra sumir ao rolar. Padrão `false` — a busca é FIXA sob o título (pedido do
   * dono do produto, 19/09/2026). Ignorado no Android, onde ela é uma faixa do `Screen`.
   */
  hideWhenScrolling?: boolean;
}
