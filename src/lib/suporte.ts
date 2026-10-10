export const EMAIL_SUPORTE = 'gestao@proops.com.br';

export interface ContextoDoSuporte {
  versao: string | null;
  build: string | null;
  plataforma: string;
  userId: string | null;
  /** O que a pessoa estava fazendo / a mensagem de erro, quando houver. */
  detalhe?: string | null;
}

/** `mailto:` com versão, build, plataforma e id (o que o suporte precisa para achar a conta). */
export function mailtoSuporte(c: ContextoDoSuporte): string {
  const linhas = [
    '',
    '',
    '---',
    `Versão: ${c.versao ?? 'desconhecida'}${c.build ? ` (${c.build})` : ''}`,
    `Plataforma: ${c.plataforma}`,
    `Id: ${c.userId ?? 'sem sessão'}`,
    ...(c.detalhe ? [`Erro: ${c.detalhe}`] : []),
  ];
  const q = `subject=${encodeURIComponent('Suporte ProOps')}&body=${encodeURIComponent(linhas.join('\n'))}`;
  return `mailto:${EMAIL_SUPORTE}?${q}`;
}
