/**
 * Os Primeiros passos da Hoje, a partir de DADO REAL — nunca de uma flag "já vi o tutorial".
 *
 * Cada passo está feito quando o banco diz que está: o telefone verificado mora em
 * `profiles.phone` (só entra por OTP), conta é linha em `accounts`, lançamento é linha em
 * `transactions`. Assim o card some sozinho quando a pessoa faz a coisa por qualquer caminho —
 * pelo app, pelo agente ou pelo WhatsApp.
 */
export type PassoId = 'whatsapp' | 'conta' | 'lancamento';

export type Passo = {
  id: PassoId;
  titulo: string;
  feito: boolean;
  href: '/link-phone' | '/finance/accounts' | '/agent/new';
};

export function passosDeConfiguracao(i: {
  telefone: string | null | undefined;
  contas: number;
  temLancamento: boolean;
}): Passo[] {
  return [
    { id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: Boolean(i.telefone?.trim()), href: '/link-phone' },
    { id: 'conta', titulo: 'Cadastrar conta ou cartão', feito: i.contas > 0, href: '/finance/accounts' },
    { id: 'lancamento', titulo: 'Fazer o primeiro lançamento', feito: i.temLancamento, href: '/agent/new' },
  ];
}

export function progresso(passos: readonly Passo[]): { feitos: number; total: number; completo: boolean } {
  const feitos = passos.filter((p) => p.feito).length;
  return { feitos, total: passos.length, completo: feitos === passos.length };
}
