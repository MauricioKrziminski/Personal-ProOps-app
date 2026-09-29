/**
 * A aparência de uma categoria (spec 2026-09-29-formulario-unico-e-categorias-design, Parte 3).
 *
 * O registro guarda o NOME (texto livre, `finance.md` → *Categorias*); ícone e cor moram na
 * tabela `categories`, por espaço. Sem linha lá vale o ícone adivinhado pelo nome
 * (`categoryIcon`) e nenhuma cor — o disco neutro de sempre.
 */
import type { IconName } from '@/components/ui/icon';
import type { NoteColorName } from '@/constants/theme';
import { categoryIcon } from '../design/category-icons.ts';
import { foldCategory } from './categories-merge.ts';

export type Categoria = {
  category: string;
  uses: number;
  icon: IconName | null;
  color: NoteColorName | null;
  budgets: number;
};

export type Aparencia = { icon: IconName; cor: NoteColorName | null };

/** A grade da folha de categoria, na ordem em que aparece. Todos existem no `MATERIAL` (teste). */
export const ICONES_DE_CATEGORIA: readonly IconName[] = [
  'cart', 'fork.knife', 'cup.and.saucer', 'car', 'fuelpump', 'bus', 'airplane', 'house',
  'bolt', 'drop', 'wifi', 'phone', 'heart', 'cross.case', 'pills', 'graduationcap',
  'book', 'tshirt', 'bag', 'gift', 'gamecontroller', 'film', 'music.note', 'pawprint',
  'figure.run', 'wrench.and.screwdriver', 'briefcase', 'banknote', 'creditcard', 'tag',
];

/** O nome de cada ícone para o leitor de tela — o SF Symbol não é frase. */
export const ROTULO_DO_ICONE: Record<string, string> = {
  cart: 'Carrinho', 'fork.knife': 'Talheres', 'cup.and.saucer': 'Café', car: 'Carro',
  fuelpump: 'Combustível', bus: 'Ônibus', airplane: 'Avião', house: 'Casa', bolt: 'Energia',
  drop: 'Água', wifi: 'Internet', phone: 'Telefone', heart: 'Coração', 'cross.case': 'Saúde',
  pills: 'Remédios', graduationcap: 'Educação', book: 'Livro', tshirt: 'Roupa', bag: 'Sacola',
  gift: 'Presente', gamecontroller: 'Jogos', film: 'Filme', 'music.note': 'Música',
  pawprint: 'Pet', 'figure.run': 'Esporte', 'wrench.and.screwdriver': 'Manutenção',
  briefcase: 'Trabalho', banknote: 'Dinheiro', creditcard: 'Cartão', tag: 'Etiqueta',
};

/** O nome como o banco o grava: minúsculo, sem espaço nas pontas. */
export function nomeDaCategoria(texto: string): string {
  return texto.trim().toLowerCase();
}

export function aparenciaDaCategoria(
  nome: string | null | undefined,
  categorias: readonly Categoria[],
  kind?: string | null
): Aparencia {
  const alvo = nome ? foldCategory(nome.trim()) : null;
  const linha = alvo ? categorias.find((c) => foldCategory(c.category) === alvo) : undefined;
  return { icon: linha?.icon ?? categoryIcon(nome, kind), cor: linha?.color ?? null };
}
