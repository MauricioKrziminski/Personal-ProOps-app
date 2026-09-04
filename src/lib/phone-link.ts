import { phoneDigits } from './phone-br.ts';

interface PhoneLinkedUser {
  id: string;
  phone?: string | null;
}

/**
 * Defesa final do fluxo de phone_change.
 *
 * O banco impede duas tentativas pendentes para o mesmo número. Ainda assim, a resposta do Auth
 * só entra na sessão do app se confirmar exatamente a conta que iniciou o fluxo e o telefone que
 * ela mostrou na tela. Comparar os dígitos nacionais tolera o formato com ou sem `+55` devolvido
 * por versões diferentes do GoTrue sem tolerar outro número.
 */
export function isExpectedPhoneLink(
  user: PhoneLinkedUser | null,
  expectedUserId: string,
  expectedPhone: string
): boolean {
  if (!user?.phone || user.id !== expectedUserId) return false;
  return phoneDigits(user.phone) === phoneDigits(expectedPhone);
}
