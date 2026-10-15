import { requireOptionalNativeModule } from 'expo-modules-core';

/** `dono`: o usuário logado quando a notificação foi guardada (null = item de uma versão sem dono). */
export type NotificacaoCapturada = { id: string; package: string; title: string; text: string; posted_at: number; dono?: string | null };

type Nativo = {
  acessoConcedido(): boolean;
  abrirAjustes(): void;
  estado(): { ativa: boolean; pacotes: string[]; dono?: string | null };
  configurar(ativa: boolean, pacotes: string[], dono: string | null): void;
  pendentes(): NotificacaoCapturada[];
  remover(ids: string[]): void;
};

// Só existe no Android: no iOS nenhum app lê notificação de outro (spec).
const nativo = requireOptionalNativeModule<Nativo>('ProOpsCaptura');

export const capturaDisponivel = () => nativo != null;
export const acessoConcedido = () => nativo?.acessoConcedido() ?? false;
export const abrirAjustes = () => nativo?.abrirAjustes();
export const estadoDaCaptura = (): { ativa: boolean; pacotes: string[]; dono?: string | null } =>
  nativo?.estado() ?? { ativa: false, pacotes: [] };
/** `dono` = id do usuário logado: a fila é dele, e o que for de outro dono sai sem ser enviado. */
export const configurarCaptura = (ativa: boolean, pacotes: string[], dono: string | null = null) => nativo?.configurar(ativa, pacotes, dono);
export const notificacoesPendentes = (): NotificacaoCapturada[] => nativo?.pendentes() ?? [];
export const removerPendentes = (ids: string[]) => { if (ids.length) nativo?.remover(ids); };
