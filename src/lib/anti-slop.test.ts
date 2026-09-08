import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A contagem anti-slop (`design.md` §10) medida por teste, não afirmada por quem escreveu.
 *
 * Ela já foi dada como zerada duas vezes e não estava: numa medição apareceram 3 hex e 4
 * `fontSize` soltos; depois a aba Notas inteira nasceu com uma paleta local (`NOTE_SKIN`, fundo
 * `#0F0F12` e um accent violeta que não existe em `Colors`) forçando dark no tema claro.
 *
 * A lição do `icon-map.test.ts` vale igual aqui: **guarda que depende de alguém olhar não é
 * guarda.** Cor nova precisa de par light e dark em `constants/theme.ts`, e tamanho de texto
 * precisa de um nome na escala `Type` — as duas regras agora quebram o build em vez de virarem
 * uma linha num handoff.
 *
 * Lê os arquivos como TEXTO de propósito: eles importam React Native e não rodam no
 * `node --test`. Mesma estratégia de `icon-map.test.ts` e `categories.test.ts`.
 */
const SRC = join(import.meta.dirname, '..');

/** Onde a cor e a escala PODEM ser literais — é o trabalho desses arquivos. */
const ALLOWED = new Set([
  join(SRC, 'constants', 'theme.ts'),
  join(SRC, 'design', 'tokens.ts'),
  /**
   * A cor do BANCO não é cor do app.
   *
   * A regra existe porque cor nossa precisa de par light/dark; o roxo do Nubank não tem par —
   * ele é roxo nos dois temas ou deixa de ser o roxo do Nubank. Ele também nunca pinta texto ou
   * superfície do app: só o fundo do cartão de crédito, misturado com preto. Allowlistar o
   * arquivo é mais honesto do que empurrar 26 marcas de terceiros para dentro da paleta.
   */
  join(SRC, 'design', 'card-brands.ts'),
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes('.test.') ? [full] : [];
  });
}

/**
 * Tira comentários antes de medir.
 *
 * Sem isso o teste acusa a própria documentação: `button.tsx` explica que substituiu 18
 * `color: '#fff'`, e o cabeçalho de `notes/index.tsx` cita os hex da paleta que foi removida.
 * Descrever o defeito não é cometê-lo.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    if (ALLOWED.has(file)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, i) => {
      const match = line.match(pattern);
      if (match) found.push(`${file.replace(SRC, 'src')}:${i + 1}  ${match[0].trim()}`);
    });
  }
  return found;
}

test('nenhuma cor hardcoded fora de constants/theme.ts', () => {
  // `#fff`, `#ffffff`, `#ffffffcc` — em aspas, que é como cor entra em estilo.
  assert.deepEqual(
    offenders(/['"]#[0-9a-fA-F]{3,8}['"]/),
    [],
    'toda cor vem de useTheme(); cor nova precisa de par light E dark em constants/theme.ts'
  );
});

test('nenhum fontSize solto fora de design/tokens.ts', () => {
  assert.deepEqual(
    offenders(/\bfontSize:\s*\d/),
    [],
    'tamanho de texto vem da escala Type (ThemedText type=...), nunca de um número na tela'
  );
});

test('nenhum fontWeight solto — peso é FAMÍLIA, não número', () => {
  /*
   * Este é o item da lista que MAIS engana, porque o defeito só aparece numa plataforma: fonte
   * custom no Android IGNORA `fontWeight` e cai no regular com negrito sintético. No simulador
   * iOS o texto fica certo, então a revisão passa e o bug viaja para o aparelho.
   *
   * Achados em 07/09/2026: a pílula de pasta em Notas, o contador de `QuickActions` e o input de
   * dinheiro. Três lugares, todos escritos depois da regra existir — é a prova de que contagem
   * que depende de alguém medir volta a subir sozinha.
   */
  assert.deepEqual(
    offenders(/\bfontWeight:/),
    [],
    'aponte para a face certa (Fonts.semibold, Fonts.bold), não para um número'
  );
});

test('rgba/hsl literais também não passam', () => {
  // A paleta local da aba Notas escapava por aqui: `accentSoft: 'rgba(139,92,246,0.18)'`.
  assert.deepEqual(
    offenders(/['"](?:rgba?|hsla?)\(\s*\d/),
    [],
    'cor em rgba() é cor hardcoded igual — o par light/dark mora em constants/theme.ts'
  );
});

/**
 * Truncar rótulo é esconder a informação que a linha existe para dar.
 *
 * Em 07/09/2026, num aparelho real, o Perfil mostrava "Avisos financeiros no c…", "Você negou a
 * permissão. Libe…" e "Trocar número do WhatsA…" — três linhas seguidas em que o texto acabava
 * antes do sentido. A queixa foi literal: *"como que o usuário vai saber se ele nao consegue nem
 * ler"*. Foram removidas 44 truncagens; a régua que ficou é esta:
 *
 * - **Identificador nunca trunca** — nome, título, rótulo, valor, mensagem de erro. Se não cabe,
 *   quem muda é o LAYOUT (a linha quebra, a célula cresce, a pílula desce), não o texto.
 * - **Prévia de um corpo pode ficar pela metade**, porque o texto inteiro está a um toque: o
 *   trecho da nota no cartão e o trecho da última mensagem na lista de conversas.
 *
 * A allowlist abaixo é a lista fechada dessas exceções. Uma entrada nova exige escrever aqui por
 * que aquele texto não é identificador — que é a pergunta que ninguém faz quando `numberOfLines`
 * entra sozinho numa tela.
 */
const TRUNCAGEM_PERMITIDA = new Set([
  // Slot de largura fixa: a barra inteira é geometria calculada e o rótulo já limita a escala
  // da fonte. Duas linhas moveriam a bolha e o berço para fora do lugar.
  'src/components/ui/curved-tab-bar.tsx',
  // Prévia do corpo da nota, no cartão da lista.
  'src/app/(tabs)/notes/index.tsx',
  // Prévia da última mensagem, na lista de conversas.
  'src/components/agent/conversation-row.tsx',
]);

test('nenhum rótulo truncado — texto quebra, layout cede', () => {
  const fora = offenders(/\bnumberOfLines=/).filter(
    (achado) => !TRUNCAGEM_PERMITIDA.has(achado.split(':')[0])
  );
  assert.deepEqual(
    fora,
    [],
    'rótulo não trunca: quebre a linha, alargue a célula ou desça a pílula — reticências escondem o dado'
  );
});
