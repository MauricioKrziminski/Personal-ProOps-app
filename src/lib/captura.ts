/**
 * Captura de lançamentos pelas notificações dos bancos (Android). Puro: a lista de bancos, o envio da
 * fila local ao agente e o link do "a confirmar" para o formulário.
 * Spec: docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md
 */
import { hrefDoRascunho, type FinanceDraft } from './voice-draft.ts';

/** Mesma lista de `agent/app/routes/captures.py` (pacotes conferidos na Play Store em 12/10/2026). */
export const BANCOS = [
  { pacote: 'com.nu.production', nome: 'Nubank' },
  { pacote: 'com.itau', nome: 'Itaú' },
  { pacote: 'br.com.bb.android', nome: 'Banco do Brasil' },
  { pacote: 'com.bradesco', nome: 'Bradesco' },
  { pacote: 'br.com.gabba.Caixa', nome: 'Caixa' },
  { pacote: 'com.santander.app', nome: 'Santander' },
  { pacote: 'br.com.intermedium', nome: 'Inter' },
  { pacote: 'com.c6bank.app', nome: 'C6 Bank' },
  { pacote: 'com.picpay', nome: 'PicPay' },
  { pacote: 'com.mercadopago.wallet', nome: 'Mercado Pago' },
  { pacote: 'br.com.neon', nome: 'Neon' },
  { pacote: 'br.com.uol.ps.myaccount', nome: 'PagBank' },
] as const;

/** `adb shell cmd notification post` publica como este pacote: só para testar em desenvolvimento. */
export const PACOTE_TESTE = 'com.android.shell';

export function bancosDisponiveis(dev: boolean): { pacote: string; nome: string }[] {
  return dev ? [...BANCOS, { pacote: PACOTE_TESTE, nome: 'Teste (adb)' }] : [...BANCOS];
}

export type Capturada = { id: string; package: string; title: string; text: string; posted_at: number };
export type NotificacaoIn = { external_id: string; package: string; title: string; text: string; posted_at: string };

export function paraEnvio(fila: Capturada[]): NotificacaoIn[] {
  return fila.map((c) => ({
    external_id: c.id, package: c.package, title: c.title, text: c.text,
    posted_at: new Date(c.posted_at).toISOString(),
  }));
}

const LOTE = 20;

/** Envia a fila em lotes; apaga do aparelho só o que o agente ACEITOU. Erro para tudo (fica para depois). */
export async function enviarFila(deps: {
  pendentes: () => Capturada[];
  remover: (ids: string[]) => void;
  enviar: (itens: NotificacaoIn[]) => Promise<{ aceitos: string[] }>;
}): Promise<number> {
  const itens = paraEnvio(deps.pendentes());
  let removidos = 0;
  for (let i = 0; i < itens.length; i += LOTE) {
    const { aceitos } = await deps.enviar(itens.slice(i, i + LOTE));
    deps.remover(aceitos);
    removidos += aceitos.length;
  }
  return removidos;
}

export function hrefDaCaptura(c: { id: string; draft: FinanceDraft }) {
  const href = hrefDoRascunho(c.draft);
  return { ...href, params: { ...href.params, captura: c.id } };
}
