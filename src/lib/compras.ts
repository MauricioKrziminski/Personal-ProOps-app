import { NativeModules, Platform } from 'react-native';
import type PurchasesModule from 'react-native-purchases';
import type { PurchasesPackage } from 'react-native-purchases';

/**
 * Compras pela loja (RevenueCat). `appUserID` é SEMPRE o id do usuário no Supabase: é por ele que
 * o webhook acha o workspace. Nunca configurar com id anônimo.
 *
 * ## Só liga com chave E módulo nativo
 *
 * `react-native-purchases` é nativo. JS novo (OTA) sobre um binário de antes dele não pode fechar o
 * app na abertura (design.md §12), então perguntamos pelo módulo ANTES de carregar o pacote — `try`
 * em volta de `require` não serve no Metro. Sem chave ou sem módulo, o estado é `indisponivel`.
 */
// Referências estáticas: o Expo só troca `process.env.EXPO_PUBLIC_*` escrito por extenso.
const CHAVE =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : Platform.OS === 'android'
      ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
      : undefined;

/** Onde a pessoa cancela: a loja do aparelho. */
export const LOJA = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

export function comprasDisponiveis(): boolean {
  return Boolean(CHAVE) && Platform.OS !== 'web' && NativeModules.RNPurchases != null;
}

let sdk: typeof PurchasesModule | null | undefined;
function purchases(): typeof PurchasesModule | null {
  if (sdk === undefined) {
    sdk = comprasDisponiveis()
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('react-native-purchases').default as typeof PurchasesModule)
      : null;
  }
  return sdk;
}

let configurado = false;
let usuario: string | null = null;
/** As trocas de usuário andam em fila: comprar nunca corre antes do `logIn`. */
let fila: Promise<unknown> = Promise.resolve();

/** `userId` ao entrar/trocar, `null` ao sair. Chamado pela raiz, junto da sessão. */
export function identificar(userId: string | null): Promise<void> {
  const P = purchases();
  if (!P) return Promise.resolve();
  const passo = fila.then(async () => {
    try {
      if (userId && !configurado) {
        P.configure({ apiKey: CHAVE!, appUserID: userId });
        configurado = true;
        usuario = userId;
      } else if (userId && usuario !== userId) {
        await P.logIn(userId);
        usuario = userId;
      } else if (!userId && usuario !== null) {
        await P.logOut();
        usuario = null;
      }
    } catch (e) {
      console.warn('compras.identificar:', (e as Error)?.message);
    }
  });
  fila = passo;
  return passo;
}

export async function carregarPacotes(): Promise<PurchasesPackage[]> {
  const P = purchases();
  if (!P) return [];
  await fila;
  const ofertas = await P.getOfferings();
  return ofertas.current?.availablePackages ?? [];
}

/** `'cancelado'` quando a pessoa fechou a folha da loja: não é erro. */
export async function comprar(pacote: PurchasesPackage): Promise<'ok' | 'cancelado'> {
  const P = purchases();
  if (!P) throw new Error('Compras indisponíveis.');
  await fila;
  try {
    await P.purchasePackage(pacote);
    return 'ok';
  } catch (e) {
    if ((e as { userCancelled?: boolean })?.userCancelled) return 'cancelado';
    throw e;
  }
}

export async function restaurar(): Promise<void> {
  const P = purchases();
  if (!P) throw new Error('Compras indisponíveis.');
  await fila;
  await P.restorePurchases();
}
