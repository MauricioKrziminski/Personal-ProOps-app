import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef } from 'react';

import { AgentApiError } from '@/lib/agent-api';
import { audioPossuiSinal } from '@/lib/agent-chat';

/** `negada`: sem permissão do microfone; `falhou`: o gravador não subiu. */
export type InicioDaGravacao = 'gravando' | 'negada' | 'falhou';

/**
 * A gravação com medição que a conversa do Agente e o "Por voz" do Financeiro compartilham:
 * permissão, modo de áudio, nível ao vivo e o arquivo no fim. Quem chama guarda o próprio estado
 * da tela (a conversa também ouve ao vivo; a folha também transcreve).
 *
 * `parar()` devolve o arquivo — silêncio total é `AgentApiError` 422, com o arquivo já apagado.
 * Depois de transcrever, quem chamou apaga o arquivo com `apagarGravacao`.
 */
export function useGravadorDeVoz() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const estado = useAudioRecorderState(recorder);
  const niveis = useRef<number[]>([]);
  /** O modo de áudio é global: só desligamos o que ESTE gravador ligou. */
  const modoLigado = useRef(false);

  useEffect(() => () => {
    // O hook libera o gravador ao desmontar; o modo de áudio precisa voltar se a pessoa sair
    // com o microfone aberto.
    if (modoLigado.current) void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (estado.isRecording && typeof estado.metering === 'number') niveis.current.push(estado.metering);
  }, [estado.durationMillis, estado.isRecording, estado.metering]);

  const desligarModo = useCallback(async () => {
    modoLigado.current = false;
    await setAudioModeAsync({ allowsRecording: false });
  }, []);

  const iniciar = useCallback(async (): Promise<InicioDaGravacao> => {
    try {
      const permissao = await requestRecordingPermissionsAsync();
      if (!permissao.granted) return 'negada';
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      modoLigado.current = true;
      await recorder.prepareToRecordAsync();
      recorder.record();
      niveis.current = [];
      return 'gravando';
    } catch {
      if (modoLigado.current) await desligarModo().catch(() => undefined);
      return 'falhou';
    }
  }, [desligarModo, recorder]);

  /** Para e devolve o arquivo gravado. */
  const parar = useCallback(async (): Promise<string> => {
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      if (!uri) throw new Error('recording_without_file');
      if (!audioPossuiSinal(niveis.current)) {
        throw new AgentApiError(422, 'empty_audio', 'O microfone não captou som. Confira a entrada de áudio e tente novamente.');
      }
      return uri;
    } catch (erro) {
      if (uri) apagarGravacao(uri);
      throw erro;
    } finally {
      // O arquivo gravado ainda pode ser transcrito se o modo não voltar.
      await desligarModo().catch(() => undefined);
    }
  }, [desligarModo, recorder]);

  /** Interrompe e descarta (cancelar, app em segundo plano): nada é transcrito. */
  const cancelar = useCallback(async () => {
    try { await recorder.stop(); } catch { /* já parado */ }
    if (recorder.uri) apagarGravacao(recorder.uri);
    await desligarModo().catch(() => undefined);
  }, [desligarModo, recorder]);

  return { iniciar, parar, cancelar, gravando: estado.isRecording, metering: estado.metering };
}

export function apagarGravacao(uri: string) {
  try { new File(uri).delete(); } catch { /* cache da gravação pode já ter sido limpo */ }
}
