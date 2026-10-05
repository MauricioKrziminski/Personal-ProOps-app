/**
 * A abertura a frio com token vencido e rede ruim: o auth-js devolve `session: null` +
 * `AuthRetryableFetchError` SEM apagar o storage e sem `SIGNED_OUT`. Isso NÃO é "sem sessão"
 * (a pessoa continua logada, só está offline), e mostrar o login era perder o dia dela.
 * Pura, fora do React, para rodar em `node --test`.
 */
export const TETO_SEM_REDE_MS = 12_000;

export const ehErroDeRede = (e: unknown): boolean =>
  (e as { name?: string } | null)?.name === 'AuthRetryableFetchError';

interface Lido<S> {
  data: { session: S | null };
  error: unknown;
}

export async function carregarSessao<S>(d: {
  getSession: () => Promise<Lido<S>>;
  /** Veredito: sessão, ou `null` = de fato sem sessão (sem erro de rede). */
  receber: (s: S | null) => void;
  /** Passou o teto e continua sem rede: a tela mostra "Sem conexão". */
  semConexao: () => void;
  vivo: () => boolean;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
  tetoMs?: number;
}): Promise<void> {
  const esperar = d.esperar ?? ((ms) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const agora = d.agora ?? Date.now;
  const inicio = agora();
  const teto = d.tetoMs ?? TETO_SEM_REDE_MS;
  // O próprio `getSession` retenta o refresh por dezenas de segundos antes de devolver o erro,
  // então o teto conta do INÍCIO: passado ele sem veredito, avisa já. "Sem conexão" não é
  // veredito (se a sessão chegar depois, `receber` apaga o aviso); storage vazio nem espera.
  const aviso = setTimeout(() => d.vivo() && d.semConexao(), teto);
  try {
    for (let i = 0; d.vivo(); i++) {
      const { data, error } = await d.getSession();
      if (!d.vivo()) return;
      if (data.session || !ehErroDeRede(error)) return d.receber(data.session);
      if (agora() - inicio >= teto) return d.semConexao();
      await esperar(Math.min(1000 * 2 ** i, 4000));
    }
  } finally {
    clearTimeout(aviso);
  }
}

/**
 * O resultado de `refreshSession()` como token. `null` = refresh DEFINITIVO (sem sessão, token
 * inválido): quem chama sai. Rede caindo lança: não é sessão acabada, e `signOut()` apaga o
 * storage mesmo offline.
 */
export function tokenDoRefresh(r: {
  data: { session: { access_token: string } | null };
  error: unknown;
}): string | null {
  if (r.error && ehErroDeRede(r.error)) throw r.error;
  return r.error ? null : (r.data.session?.access_token ?? null);
}
