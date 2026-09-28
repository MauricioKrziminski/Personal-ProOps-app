import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';

type Biblioteca = typeof import('expo-speech-recognition');

/**
 * A fala do PRÓPRIO aparelho, transcrita enquanto a pessoa fala (28/09/2026, *"ir transcrevendo o
 * áudio à medida que eu falo"*): SFSpeechRecognizer no iPhone, SpeechRecognizer no Android. Custa
 * zero — o servidor não é chamado —, e o texto aparece no campo do Agente palavra a palavra.
 *
 * Quando ela não existe (binário sem o módulo, Android 12 ou antes — sem modo contínuo —, aparelho
 * sem serviço de fala) quem responde é o caminho de antes: grava e transcreve na Groq.
 *
 * ⚠️ Pergunta pelo módulo ANTES de carregar a biblioteca, como os widgets (`publicar.ios.tsx`):
 * ela chama `requireNativeModule` na importação, e sem o nativo isso fecha o app na abertura —
 * `try` em volta do `require` não segura, o Metro manda o erro ao `reportFatalError`.
 */
let biblioteca: Biblioteca | null | undefined;
function carregar(): Biblioteca | null {
  if (biblioteca === undefined) {
    biblioteca = requireOptionalNativeModule('ExpoSpeechRecognition')
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('expo-speech-recognition') as Biblioteca)
      : null;
  }
  return biblioteca;
}

/**
 * O reconhecedor do sistema recusou nesta sessão do app. `isRecognitionAvailable()` diz que sim
 * nesses casos — só o `start` descobre —, então a primeira recusa desliga a escuta ao vivo até o
 * app reabrir, e a tela grava e transcreve na Groq:
 *
 * - `service-not-allowed`: Siri e ditado desligados, ou o modelo de fala não instalado.
 * - `language-not-supported`: sem português no reconhecedor.
 * - `audio-capture`: no iPhone é também o código 300 do sistema ("Failed to initialize
 *   recognizer"), o serviço de fala que não subiu — no simulador, depois de uma ou duas escutas,
 *   toda escuta seguinte falhava assim (28/09/2026). Se o microfone estiver mesmo quebrado, a
 *   gravação da Groq diz isso com o erro dela.
 */
let recusou = false;
const RECUSAS: readonly (ExpoSpeechRecognitionErrorCode | null)[] = [
  'service-not-allowed',
  'language-not-supported',
  'audio-capture',
];
export function reconhecedorRecusou(erro: ExpoSpeechRecognitionErrorCode | null): boolean {
  if (!RECUSAS.includes(erro)) return false;
  recusou = true;
  return true;
}

/** Dá para ouvir ao vivo neste aparelho? */
export function falaAoVivoDisponivel(): boolean {
  const lib = carregar();
  if (!lib || recusou) return false;
  // Sem modo contínuo (Android 12 ou antes) a escuta pararia na primeira pausa.
  if (Platform.OS === 'android' && Number(Platform.Version) < 33) return false;
  try {
    return lib.ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export type FimDaEscuta = { erro: ExpoSpeechRecognitionErrorCode | null };

export interface Escuta {
  /** Para e entrega o que ainda estava sendo reconhecido. */
  parar: () => void;
  /** Para e descarta (saiu da tela). */
  cancelar: () => void;
}

/**
 * O texto de uma escuta: os trechos FINAIS juntados e o parcial por cima.
 *
 * No Android o modo contínuo devolve vários trechos finais, um por frase; no iPhone, um resultado
 * que cresce a sessão inteira e fecha num final só. Juntar os finais e mostrar o parcial por cima
 * vale para os dois — o parcial nunca é somado, ele é substituído a cada evento.
 */
export function textoDaEscuta(finais: readonly string[], parcial: string): string {
  return [...finais, parcial]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Começa a ouvir. `aoMudar` recebe o texto acumulado da escuta a cada palavra; `aoTerminar` é
 * chamado UMA vez, quando o reconhecedor termina (parado, erro ou silêncio).
 *
 * Permissão negada volta `'negada'` sem abrir escuta nenhuma; a tela oferece os Ajustes.
 */
export async function ouvir(
  aoMudar: (texto: string) => void,
  aoTerminar: (fim: FimDaEscuta) => void,
): Promise<Escuta | 'negada' | null> {
  const lib = carregar();
  if (!lib) return null;
  const m = lib.ExpoSpeechRecognitionModule;
  const permissao = await m.requestPermissionsAsync();
  if (!permissao.granted) return 'negada';

  const finais: string[] = [];
  let parcial = '';
  let erro: ExpoSpeechRecognitionErrorCode | null = null;
  let terminou = false;
  const inscricoes = [
    m.addListener('result', (e) => {
      const texto = e.results[0]?.transcript ?? '';
      if (e.isFinal) {
        finais.push(texto);
        parcial = '';
      } else {
        parcial = texto;
      }
      aoMudar(textoDaEscuta(finais, parcial));
    }),
    m.addListener('error', (e) => {
      erro = e.error;
    }),
    m.addListener('end', () => {
      if (terminou) return;
      terminou = true;
      inscricoes.forEach((s) => s.remove());
      aoTerminar({ erro });
    }),
  ];

  m.start({
    lang: 'pt-BR',
    interimResults: true,
    continuous: true,
    maxAlternatives: 1,
    // Pontuação no iPhone; no Android só existe com o modelo no aparelho, e lá é ignorada.
    addsPunctuation: true,
    iosTaskHint: 'dictation',
  });

  return {
    parar: () => m.stop(),
    cancelar: () => m.abort(),
  };
}
