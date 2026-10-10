import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { agentFetch } from '@/lib/agent-api';
import { localISODate } from '@/lib/dates';

export const nomeDoArquivoDeDados = (dia: string) => `proops-dados-${dia}.json`;

/**
 * "Baixar meus dados" (LGPD): pede o JSON ao agente (`GET /internal/export`, 3 por hora), grava no
 * cache e abre a folha de compartilhar do sistema. Devolve `false` se o aparelho não compartilha.
 */
export async function baixarMeusDados(): Promise<boolean> {
  const dados = await agentFetch<unknown>('/internal/export');
  const pasta = new Directory(Paths.cache, 'exportacao');
  if (pasta.exists) pasta.delete(); // o arquivo tem tudo em claro: nunca fica mais de um, nem depois
  pasta.create({ idempotent: true, intermediates: true });
  const arquivo = new File(pasta, nomeDoArquivoDeDados(localISODate()));
  arquivo.create({ overwrite: true });
  arquivo.write(JSON.stringify(dados, null, 2));
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(arquivo.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Meus dados do ProOps',
    });
    return true;
  } finally {
    if (arquivo.exists) arquivo.delete();
  }
}
