/**
 * Imagens anexadas nesta sessão, por `client_message_id`.
 *
 * O servidor não guarda a imagem: a miniatura do balão e o "Tentar novamente" leem daqui.
 * Vive em memória, de propósito — ao reabrir o app o histórico mostra só o selo "Imagem".
 */
const porMensagem = new Map<string, string>();

export function guardarAnexo(clientMessageId: string, uri: string) {
  porMensagem.set(clientMessageId, uri);
}

export function anexoDaMensagem(clientMessageId?: string | null): string | undefined {
  return clientMessageId ? porMensagem.get(clientMessageId) : undefined;
}
