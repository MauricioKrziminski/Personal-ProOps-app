/**
 * Telefone brasileiro — o dado que é a chave do produto inteiro.
 *
 * O telefone não é "mais um campo do login": é o vínculo entre a conta do app e o WhatsApp
 * (`profiles.phone`), e é por ele que o `process-jobs` acha o dono de uma mensagem. Digitar
 * errado aqui não dá erro de login — dá um app vazio que nunca recebe nada.
 *
 * Antes a normalização era uma linha repetida em dois lugares da tela de login:
 * `phone.startsWith('+') ? phone : '+55' + phone.replace(/\D/g,'')`. Ela aceitava `1`,
 * `(11) 9` e `abc`, mandava para a Meta e devolvia a mensagem de erro do Supabase em inglês.
 *
 * Aqui a regra é uma só e testada. **BR-only de propósito**: o produto fala português, o número
 * é de WhatsApp brasileiro, e aceitar DDI arbitrário só serviria para o usuário se enganar em
 * silêncio.
 */

const DDI = '55';

/**
 * Só os dígitos NACIONAIS (sem DDI), no máximo 11.
 *
 * O `55` da frente só é tratado como DDI quando sobra número demais para ser nacional — porque
 * **55 também é DDD** (Santa Maria/RS). `5511999999999` (13) é DDI+DDD; `5599998888` (10) é o
 * telefone de Santa Maria e fica inteiro.
 */
export function phoneDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  const national = digits.startsWith(DDI) && digits.length > 11 ? digits.slice(2) : digits;
  return national.slice(0, 11);
}

/**
 * Máscara progressiva: formata enquanto se digita, sem esperar o campo ficar completo.
 *
 * Celular tem 11 dígitos (`(11) 99999-9999`), fixo tem 10 (`(11) 3333-4444`) — o ponto de corte
 * do hífen muda com o comprimento, e é por isso que isto não é um regex único.
 */
export function formatPhoneBR(input: string): string {
  const d = phoneDigits(input);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;

  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;

  const split = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/**
 * O número está completo o bastante para pedir um código?
 *
 * Serve para habilitar o botão — o custo de um falso positivo é um SMS/template gasto e um erro
 * em inglês vindo da Meta.
 */
export function isValidPhoneBR(input: string): boolean {
  const d = phoneDigits(input);
  if (d.length !== 10 && d.length !== 11) return false;
  // DDD brasileiro começa em 11.
  if (Number(d.slice(0, 2)) < 11) return false;
  // 11 dígitos é celular, e celular BR sempre começa com 9 depois do DDD.
  if (d.length === 11 && d[2] !== '9') return false;
  return true;
}

/** O formato que o Supabase Auth e a Meta esperam. */
export function toE164BR(input: string): string {
  return `+${DDI}${phoneDigits(input)}`;
}

/**
 * O número de volta para o usuário, na tela do código.
 *
 * Confirmar para ONDE o código foi é o que evita o beco sem saída do OTP: sem isso, "não chegou"
 * e "digitei errado" são indistinguíveis.
 */
export function displayPhoneBR(input: string): string {
  const d = phoneDigits(input);
  return d ? `+${DDI} ${formatPhoneBR(d)}` : input;
}
