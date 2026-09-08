/**
 * Erro de autenticação em português.
 *
 * A tela de login mostrava `err.message` cru do Supabase. Ou seja: a única frase que o usuário
 * lê quando erra o código, num app cujo texto é pt-BR informal, era
 * `Token has expired or is invalid` — e ela nem distingue "expirou" de "digitei errado", que
 * são dois problemas com saídas diferentes (pedir outro vs. conferir os dígitos).
 *
 * A ordem do casamento importa: `code` primeiro (é estável), `status` depois, e só então o
 * texto — a mensagem da API muda entre versões e é o critério mais frágil.
 */

interface AuthLike {
  message?: string;
  code?: string;
  status?: number;
}

/** Fallback: nunca vazar inglês técnico, mesmo em erro que não foi previsto. */
const GENERIC = 'Não deu para continuar agora. Tente de novo em instantes.';

export function authErrorMessage(err: AuthLike | null | undefined): string | null {
  if (!err) return null;

  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();

  // Rate limit do Supabase: a mensagem carrega os segundos que faltam, e devolver esse número é
  // a diferença entre "espere" e "espere 39 segundos".
  if (code.startsWith('over_') || err.status === 429 || msg.includes('for security purposes')) {
    const seconds = err.message?.match(/(\d+)\s*seconds?/i)?.[1];
    return seconds
      ? `Aguarde ${seconds} segundos para pedir outro código.`
      : 'Muitos pedidos seguidos. Espere um minuto e tente de novo.';
  }

  if (code === 'otp_expired' || msg.includes('expired')) {
    return 'Esse código expirou. Peça um novo.';
  }

  // Conta por e-mail (0051). `code` primeiro, pelo mesmo motivo de sempre.
  if (code === 'email_not_confirmed') {
    return 'Esse e-mail ainda não foi confirmado. Confira a caixa de entrada.';
  }
  if (code === 'user_already_exists' || code === 'email_exists') {
    return 'Já existe uma conta com esse e-mail. Entre ou recupere a senha.';
  }
  if (code === 'phone_exists') {
    return 'Esse número já está vinculado a outra conta. Entre com o WhatsApp para acessar os dados dela.';
  }
  if (code === 'weak_password' || msg.includes('password should')) {
    return 'Senha fraca. Use pelo menos 8 caracteres.';
  }
  if (code === 'same_password') {
    return 'A senha nova é igual à antiga.';
  }
  if (code === 'invalid_credentials' && msg.includes('login')) {
    // `Invalid login credentials` — e-mail ou senha. Não dizemos qual: é enumeração de conta.
    return 'E-mail ou senha incorretos.';
  }

  if (code === 'invalid_credentials' || msg.includes('invalid') || msg.includes('incorrect')) {
    // `Token has expired or is invalid` cai aqui quando não bateu no ramo de expirado acima.
    if (msg.includes('email')) return 'Esse e-mail não parece válido.';
    return msg.includes('phone') || msg.includes('number')
      ? 'Esse número não parece válido. Confira o DDD e o 9 na frente.'
      : 'Código incorreto. Confira os 6 dígitos.';
  }

  if (code === 'validation_failed') {
    return 'Esse número não parece válido. Confira o DDD e o 9 na frente.';
  }

  if (code === 'otp_disabled' || code === 'signup_disabled' || msg.includes('not allowed')) {
    return 'O login por WhatsApp está indisponível. Tente mais tarde.';
  }

  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) {
    return 'Sem conexão. Confira a internet e tente de novo.';
  }

  return GENERIC;
}
