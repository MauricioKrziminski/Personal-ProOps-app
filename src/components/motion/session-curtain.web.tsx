import type { ReactNode } from 'react';

import type { CortinaApi } from './session-curtain.types';

/** No web não há splash nativo nem troca que precise esconder: a cortina é transparente. */
const SEM_CORTINA: CortinaApi = {
  cobrir: async () => {},
  revelar: async () => {},
  abrirJa: () => {},
  lembrarOrigem: () => {},
  tomarOrigem: () => null,
  marcarPronto: () => {},
};

export function CortinaProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useCortina(): CortinaApi {
  return SEM_CORTINA;
}

export function useCortinaAberta(): boolean {
  return true;
}
