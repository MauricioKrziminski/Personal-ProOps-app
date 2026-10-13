import { requireOptionalNativeModule } from 'expo-modules-core';

export type NotificacaoCapturada = { id: string; package: string; title: string; text: string; posted_at: number };

type Nativo = {
  acessoConcedido(): boolean;
  abrirAjustes(): void;
  estado(): { ativa: boolean; pacotes: string[] };
  configurar(ativa: boolean, pacotes: string[]): void;
  pendentes(): NotificacaoCapturada[];
  remover(ids: string[]): void;
};

// Só existe no Android: no iOS nenhum app lê notificação de outro (spec).
const nativo = requireOptionalNativeModule<Nativo>('ProOpsCaptura');

export const capturaDisponivel = () => nativo != null;
export const acessoConcedido = () => nativo?.acessoConcedido() ?? false;
export const abrirAjustes = () => nativo?.abrirAjustes();
export const estadoDaCaptura = () => nativo?.estado() ?? { ativa: false, pacotes: [] };
export const configurarCaptura = (ativa: boolean, pacotes: string[]) => nativo?.configurar(ativa, pacotes);
export const notificacoesPendentes = (): NotificacaoCapturada[] => nativo?.pendentes() ?? [];
export const removerPendentes = (ids: string[]) => { if (ids.length) nativo?.remover(ids); };
