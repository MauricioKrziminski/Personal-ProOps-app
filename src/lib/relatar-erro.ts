/**
 * Relato de erros do app para o painel de observabilidade (`POST /internal/errors`).
 *
 * `instalarRelatoDeErros()` pluga crash (ErrorUtils) e promessa rejeitada (Hermes); o Error Boundary
 * da raiz e quem quiser relatar um erro tratado usam `relatarErro`. A fila e as regras (dedupe, erro
 * esperado, nunca lançar, nunca em laço) moram em `relator-de-erros.ts`.
 *
 * Desligado em `__DEV__` — o Metro e o LogBox já mostram tudo. `EXPO_PUBLIC_RELATAR_ERROS_EM_DEV=1`
 * liga (é como a QA prova o caminho app → painel).
 */

import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { agentFetch } from '@/lib/agent-api';
import { criarRelator, type KindDoErro } from '@/lib/relator-de-erros';

const EM_DEV = process.env.EXPO_PUBLIC_RELATAR_ERROS_EM_DEV === '1';
const ligado = () => !__DEV__ || EM_DEV;

let rotaAtual: string | null = null;
/** A raiz informa a rota a cada navegação (`usePathname`); sem ela o relato vai com `route: null`. */
export function definirRotaAtual(rota: string | null) {
  rotaAtual = rota;
}

const relator = criarRelator({
  ligado,
  meta: () => ({
    platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : null,
    app_version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
    route: rotaAtual,
  }),
  // Sem login também vale (erro da tela de entrar): `agentFetch` manda o JWT quando existe.
  enviar: (errors) => agentFetch('/internal/errors', { method: 'POST', body: JSON.stringify({ errors }) }),
});

export function relatarErro(err: unknown, kind: KindDoErro = 'error', context?: Record<string, unknown>) {
  relator.relatar(err, kind, context);
}

let instalado = false;

export function instalarRelatoDeErros() {
  if (instalado || !ligado()) return;
  instalado = true;
  try {
    const g = globalThis as {
      ErrorUtils?: {
        getGlobalHandler?: () => ((e: unknown, fatal?: boolean) => void) | undefined;
        setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
      };
      HermesInternal?: {
        enablePromiseRejectionTracker?: (o: {
          allRejections: boolean;
          onUnhandled: (id: number, rejection: unknown) => void;
          onHandled: (id: number) => void;
        }) => void;
      };
    };
    const anterior = g.ErrorUtils?.getGlobalHandler?.();
    g.ErrorUtils?.setGlobalHandler?.((erro, fatal) => {
      relatarErro(erro, fatal ? 'crash' : 'error');
      anterior?.(erro, fatal); // o comportamento do React Native (LogBox, tela de erro, fechar) continua
    });
    // O RN só liga o rastreador em __DEV__; em release ninguém ouvia a rejeição sem tratamento.
    g.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejeicao) => {
        relatarErro(rejeicao, 'unhandled_rejection');
        if (__DEV__) console.warn('Rejeição de promise sem tratamento:', rejeicao);
      },
      onHandled: () => undefined,
    });
  } catch {
    // instalar nunca pode derrubar a abertura do app
  }
}
