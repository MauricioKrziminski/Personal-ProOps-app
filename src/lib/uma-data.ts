/**
 * "Ainda vai sair/cair" com UMA data (10/10/2026, padrão do Mobills, Organizze e YNAB): a data
 * escolhida É o vencimento e grava `occurred_at = due_at`. Fora do cartão e fora de compra
 * parcelada, o par "Data da compra" + "Vence em" só aparece se a pessoa pedir ("outra data").
 */
export type ContextoUmaData = {
  /** Ocorrência de série: sempre uma data (26/09/2026). */
  serie: boolean;
  /** Parcela de compra: a data dela já está no cronograma, o vencimento é à parte. */
  naCompra: boolean;
  podeAdiar: boolean;
  pending: boolean;
  outraData: boolean;
};

/** A data única é o vencimento: um campo só, e o vencimento escondido anda junto com ele. */
export function dataUnicaEVencimento(c: ContextoUmaData): boolean {
  return c.podeAdiar && c.pending && (c.serie || (!c.naCompra && !c.outraData));
}

/** O link "Comprou em outra data?" só existe onde a data única vale e a pessoa ainda não o abriu. */
export function oferecerOutraData(c: ContextoUmaData): boolean {
  return !c.serie && dataUnicaEVencimento(c);
}

/** Registro pendente com data da compra diferente do vencimento abre já com os dois campos. */
export function abreComDuasDatas(r: { status?: string; occurred_at?: string; due_at?: string | null; recurring_id?: string | null; invoice_id?: string | null } | undefined): boolean {
  return Boolean(r && r.status === 'pending' && !r.recurring_id && !r.invoice_id && r.due_at && r.due_at !== r.occurred_at);
}

/** O mesmo, sobre o estado restaurado do formulário (datas em texto, `dd/mm/aaaa`, iguais entre si). */
export function abreComDuasDatasGuardado(g: { pending?: boolean; occurred_at?: string; due_at?: string | null } | undefined): boolean {
  return Boolean(g && g.pending && g.due_at && g.due_at !== g.occurred_at);
}

/**
 * Registro pendente SEM vencimento gravado (antigo): o campo abre com a data dele, e salvar sem
 * mexer não pode gravar `due_at = occurred_at` (nada alterado = nada a gravar).
 */
export function vencimentoAGravar(
  editing: { due_at: string | null; occurred_at: string },
  dueAt: string | null,
): string | null {
  return editing.due_at == null && dueAt === editing.occurred_at ? editing.due_at : dueAt;
}

export type PendenciaReservada = { pending: boolean; due_at: string | null };

/**
 * Trocar a conta por um CARTÃO desliga "Ainda vai sair" (a fatura já cobre o caixa), mas voltar
 * para uma conta na mesma visita devolve o que a pessoa tinha. Enquanto em cartão, nada é escrito.
 */
export function aoTrocarDeConta(c: {
  paraCartao: boolean;
  pending: boolean;
  due_at: string | null;
  reservada: PendenciaReservada | null;
}): { pending: boolean; due_at: string | null; reservada: PendenciaReservada | null } {
  if (c.paraCartao) {
    return {
      pending: false,
      due_at: null,
      reservada: c.pending ? { pending: true, due_at: c.due_at } : c.reservada,
    };
  }
  return c.reservada
    ? { pending: true, due_at: c.reservada.due_at, reservada: null }
    : { pending: c.pending, due_at: c.due_at, reservada: null };
}

export function rotuloOutraData(kind: string | null | undefined): string {
  return kind === 'income' ? 'Lançar em outra data?' : 'Comprou em outra data?';
}
