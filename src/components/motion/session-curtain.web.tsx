import type { ReactNode } from 'react';

import type { FaseDaCortina } from '@/lib/session-gate';
import type { CortinaApi } from './session-curtain.types';

/** No web não há splash nativo nem troca que precise esconder: a cortina é transparente. */
const SEM_CORTINA: CortinaApi = {
  preparar: () => {},
  cobrir: async () => {},
  cobrirDaCapa: async () => {},
  cobrirJa: () => {},
  revelar: async () => {},
  abrirJa: () => {},
  lembrarOrigem: () => {},
  tomarOrigem: () => null,
  marcarPronto: () => {},
  segurarAbertura: () => {},
};

export function CortinaProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useCortina(): CortinaApi {
  return SEM_CORTINA;
}

export function useCortinaFase(): FaseDaCortina {
  return 'aberta';
}

export function useCortinaAberta(): boolean {
  return true;
}

export function useCortinaSaindo(): boolean {
  return true;
}
