export type SegmentedOption<T extends string> = { value: T; label: string };

export interface SegmentedProps<T extends string> {
  /** De duas a quatro opções curtas; listas variáveis usam SelectField ou Chip. */
  options:
    | readonly [SegmentedOption<T>, SegmentedOption<T>]
    | readonly [SegmentedOption<T>, SegmentedOption<T>, SegmentedOption<T>]
    | readonly [SegmentedOption<T>, SegmentedOption<T>, SegmentedOption<T>, SegmentedOption<T>];
  value: T;
  onChange: (value: T) => void;
}
