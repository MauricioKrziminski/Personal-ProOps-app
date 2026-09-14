/**
 * O segredo da trava: o PIN, guardado como HASH com salt no SecureStore.
 *
 * ⚠️ **O que isto protege, e o que NÃO protege.** A ameaça é quem pegou o celular desbloqueado —
 * a mesma que `conceal.tsx` documenta e só resolve pela metade ("quem consegue olhar a tela
 * também consegue tocar nela"). Contra quem EXTRAIU o aparelho isto não protege: seis dígitos são
 * um milhão de combinações e um SHA-256 sem alongamento de chave cai em segundos numa GPU.
 *
 * O hash ainda paga o que custa, por um motivo só: **o PIN daqui pode ser o mesmo de outro
 * lugar.** Um dump legível entregaria um segredo que não é só deste app. É por isso que ele não
 * vai em claro nem para o SecureStore.
 *
 * ⚠️ **O PIN nunca encosta no `AsyncStorage`.** Lá fica só a PREFERÊNCIA (ligado/desligado,
 * carência), que não é segredo. O segredo fica no Keychain (iOS) / Keystore (Android).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { ESPERA_SEGUNDOS, esperaRestante, TENTATIVAS_ATE_ESPERAR } from '@/lib/lock-policy';

const CHAVE_HASH = 'lock-pin-hash';
const CHAVE_SALT = 'lock-pin-salt';

/** Seis dígitos, e só dígitos — o teclado da tela de PIN não oferece outra coisa. */
export const TAMANHO_PIN = 6;

async function hash(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function definirPin(pin: string): Promise<void> {
  // Salt aleatório POR INSTALAÇÃO: sem ele, o mesmo PIN gera o mesmo hash em todo aparelho e uma
  // tabela pronta de 1 milhão de entradas resolve todos de uma vez.
  const salt = Array.from(Crypto.getRandomBytes(16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(CHAVE_SALT, salt);
  await SecureStore.setItemAsync(CHAVE_HASH, await hash(pin, salt));
}

export async function conferirPin(pin: string): Promise<boolean> {
  const [salt, esperado] = await Promise.all([
    SecureStore.getItemAsync(CHAVE_SALT),
    SecureStore.getItemAsync(CHAVE_HASH),
  ]);
  if (!salt || !esperado) return false;
  return (await hash(pin, salt)) === esperado;
}

export async function temPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CHAVE_HASH)) !== null;
}

/**
 * Some com o PIN. Chamado ao desligar a trava e **ao sair da conta**.
 *
 * ⚠️ "Esqueci o PIN" é SAIR DA CONTA, não uma recuperação própria: o Supabase Auth já tem a dele,
 * e inventar um segundo caminho de recuperação é inventar uma segunda porta para a mesma casa.
 */
export async function apagarPin(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CHAVE_HASH),
    SecureStore.deleteItemAsync(CHAVE_SALT),
  ]);
}

/* ── a contagem de tentativas ───────────────────────────────────────────────────────────────
 *
 * Fica no `AsyncStorage` (não é segredo) e **sobrevive a fechar o app**. Guardá-la só em memória
 * faria a espera ser derrotada por um force-quit, que é o gesto mais óbvio de quem está tentando
 * adivinhar — a trava viraria enfeite.
 *
 * O relógio é lido AQUI e não na tela: o React Compiler recusa `Date.now()` no corpo do
 * componente ("impure function during render"), e ele tem razão — valor que muda a cada render
 * não pode participar do render.
 */

const CHAVE_ERROS = 'lock-erros';

/** Registra um erro e devolve quantos segundos esperar (0 = pode tentar de novo). */
export async function registrarErro(): Promise<number> {
  const bruto = await AsyncStorage.getItem(CHAVE_ERROS);
  const antes = bruto ? (JSON.parse(bruto) as { n: number }) : { n: 0 };
  const n = antes.n + 1;
  await AsyncStorage.setItem(CHAVE_ERROS, JSON.stringify({ n, em: Date.now() }));
  return n >= TENTATIVAS_ATE_ESPERAR ? ESPERA_SEGUNDOS : 0;
}

/** Quantos segundos ainda faltam. Chamada pelo tique da tela. */
export async function esperaAgora(): Promise<number> {
  const bruto = await AsyncStorage.getItem(CHAVE_ERROS);
  if (!bruto) return 0;
  const { n, em } = JSON.parse(bruto) as { n: number; em: number };
  return esperaRestante(n, em ?? null, Date.now());
}

/** Acertou: zera. */
export async function zerarErros(): Promise<void> {
  await AsyncStorage.removeItem(CHAVE_ERROS);
}
