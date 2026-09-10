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

/**
 * `Canvas` do Skia só existe dentro de `ui/skia-canvas.tsx`.
 *
 * **A superfície do Skia guarda o px/dp com que nasceu.** Mudou a densidade da tela com o app
 * rodando — "tamanho de exibição" nas configurações, dobrável trocando de painel — e o desenho
 * sai na escala VELHA enquanto as `View`s ao lado já se reposicionaram. Em 09/09/2026 isso apareceu
 * como "a bola da aba selecionada está fora do lugar": o berço da `CurvedTabBar` desenhado a
 * 145,4dp com raio 38,5 quando o JS mandava 124,8 e 33 — os dois × 1,1667, que é 3,5/3,0 —, com a
 * bolha (uma `View`) no lugar certo ao lado. O código da barra estava correto o tempo todo.
 *
 * `SkiaCanvas` desfaz a escala errada, e são CINCO canvases no app. Mesma régua do `GlassCard`
 * e do `Icon`: a decisão mora no primitivo, com o motivo escrito uma vez — um canvas novo
 * importado direto nasceria com o defeito de volta, em silêncio.
 */
test('nenhum Canvas do Skia fora de ui/skia-canvas.tsx', () => {
  /*
    Casa o ARQUIVO inteiro, não linha a linha.
    `import { Circle, Line, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia'`
    já tem 98 colunas: somar `Canvas` estoura a régua e o formatador quebra o import em várias
    linhas — aí nenhuma linha tem `Canvas` E o `from`, e um guarda por linha fica verde com o
    defeito de volta. Testado: a violação plantada em `sparkline.tsx` passou batido assim.
  */
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith(join('ui', 'skia-canvas.tsx'))) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const imp of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@shopify\/react-native-skia'/g)) {
      if (/\bCanvas\b/.test(imp[1])) fora.push(file.replace(SRC, 'src'));
    }
  }
  assert.deepEqual(
    fora,
    [],
    'use SkiaCanvas de @/components/ui/skia-canvas: o Canvas cru fica preso na escala px/dp em que nasceu'
  );
});

/**
 * A densidade que o Skia usa é lida UMA VEZ, no carregamento do módulo.
 *
 * É o coração do conserto e a parte que some sem deixar rastro. `RNSkPlatformContext::_pixelDensity`
 * nasce na construção do módulo nativo (`PlatformContext.java`) e nada o atualiza; `SkiaCanvas`
 * compara aquele valor com o `scale` de agora e desfaz a diferença. Se alguém mover o
 * `PixelRatio.get()` para DENTRO do componente — que é o que parece mais "reativo" —, os dois
 * lados passam a ser o mesmo número, `correcao` vira 1 para sempre e o conserto desliga **sem
 * erro, sem aviso e sem teste vermelho**: só volta a barra torta no aparelho de quem mexeu no
 * tamanho de exibição.
 *
 * Não dá para pegar isso renderizando (não há Skia no `node --test`), então o guarda lê o texto:
 * a chamada tem que estar em coluna zero, fora de qualquer função.
 */
test('SkiaCanvas lê PixelRatio no carregamento do módulo, não a cada render', () => {
  const code = stripComments(
    readFileSync(join(SRC, 'components', 'ui', 'skia-canvas.tsx'), 'utf8')
  );
  const noModulo = /^const\s+\w+\s*=\s*PixelRatio\.get\(\);/m.test(code);
  const chamadas = [...code.matchAll(/PixelRatio\.get\(\)/g)].length;

  assert.ok(
    noModulo,
    'PixelRatio.get() precisa ser uma const de módulo: dentro do componente ele devolve a escala de AGORA, igual ao useWindowDimensions, e a correção vira 1'
  );
  assert.equal(
    chamadas,
    1,
    'uma chamada só — uma segunda, dentro do render, seria a que o componente acabaria usando'
  );
});


/**
 * O app não fala mais com Edge Function.
 *
 * `supabase/functions/` é legado em desmonte, e o último chamado do app — `import-statement` —
 * saiu em 09/09/2026. Ele não era só legado: recebia `user_id` e `workspace_id` NO CORPO e
 * confiava neles. O `verify_jwt` do Supabase provava que ALGUM usuário válido chamou, não que
 * fosse aquele — qualquer autenticado importava lançamentos para o workspace de outro trocando
 * duas linhas do POST. A rota Python (`/internal/import-statement`) tira o usuário do `sub`.
 *
 * Sem este guarda, a próxima tela que precisar de servidor copia o padrão da tela ao lado — que
 * é exatamente como o chamado velho sobreviveu meses depois de o substituto existir. O caminho
 * é `agentFetch` (`src/lib/agent-api.ts`).
 */
test('nenhuma chamada a Edge Function no app', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/\bfunctions\s*\.\s*invoke\b/.test(code) || /\/functions\/v1\//.test(code)) {
      fora.push(file.replace(SRC, 'src'));
    }
  }
  assert.deepEqual(
    fora,
    [],
    'use agentFetch de @/lib/agent-api: as Edge Functions estão sendo apagadas, e a que o app chamava lia o dono do dado do CORPO do POST'
  );
});

/**
 * Nenhuma leitura do app passa por RPC que devolve UMA LINHA POR DIA.
 *
 * O PostgREST corta a resposta em **1000 linhas** (`db-max-rows`) e o corte é SILENCIOSO: a
 * lista chega menor, sem erro e sem aviso. `cash_flow_forecast` e `forecast_with_drafts`
 * devolvem `setof` — uma linha por dia —, então acima de ~2,7 anos o app somava "entra/sai",
 * tirava o saldo do fim e procurava o primeiro dia negativo sobre uma série truncada, e
 * escrevia em cima disso o rótulo do horizonte que o usuário pediu.
 *
 * Medido no staging em 10/09/2026, pela API autenticada: pedindo 3.650 dias vinham 1.000
 * linhas, último dia 05/06/2029, saldo **R$ 16.164,60 otimista**. Pior: 3, 5 e 10 anos
 * mostravam todos a MESMA data — o rótulo mudava, o número não. E já estava em produção desde
 * o teto de 3 anos (1.096 linhas).
 *
 * O caminho é `forecast_json`, que devolve UMA linha com a série inteira dentro — o teto do
 * PostgREST é por linha, não por tamanho. As RPCs `setof` continuam existindo para o AGENTE
 * (que fala com o Postgres direto e nunca passou por esse teto) e para APK antigo em campo.
 *
 * Isto não pode ser vistoria: nada quebra quando volta, só o número fica errado.
 */
test('nenhuma leitura do app usa RPC de projeção linha-por-dia', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/rpc\(\s*['"`](cash_flow_forecast|forecast_with_drafts)['"`]/.test(code)) {
      fora.push(file.replace(SRC, 'src'));
    }
  }
  assert.deepEqual(
    fora,
    [],
    'use rpc("forecast_json"): o PostgREST corta setof em 1000 linhas e a projeção fica otimista sem avisar'
  );
});

/**
 * Nenhuma tela monta lista de conta à mão.
 *
 * O mesmo campo já teve OITO implementações — `<Row title={a.name}/>` em quatro
 * telas e `<Chip label={...}/>` em outras quatro —, e em todas elas um cartão de
 * crédito e uma conta corrente têm a mesma cara. Foi assim que um salário de
 * R$ 4.000 entrou na fatura do cartão em 09/09/2026, sem erro nenhum na tela.
 *
 * A regra não dá para ser vistoria: a nona tela nasce copiando a oitava. Quem
 * precisa escolher conta usa `AccountPicker`; quem precisa escolher item de uma
 * lista curta usa `SelectField`.
 */
test('nenhuma tela monta lista de conta à mão', () => {
  // Só o próprio seletor pode iterar contas para desenhar opção; `accounts.tsx`
  // é a tela que GERENCIA contas (ali a lista é o conteúdo, não um campo).
  const PERMITIDO = new Set([
    'src/components/finance/account-picker.tsx',
    'src/app/finance/accounts.tsx',
  ]);
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const rel = file.replace(SRC, 'src');
    if (PERMITIDO.has(rel)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    // `<coleção de contas>.map(...)` com um Chip ou Row desenhado dentro.
    const itera = /\b(?:accounts|contas|pagadoras|cartoes|cartões)\b[^\n]{0,40}\.map\(/g;
    for (const m of code.matchAll(itera)) {
      const corpo = code.slice(m.index ?? 0, (m.index ?? 0) + 700);
      if (/<(?:Chip|Row)\b/.test(corpo)) {
        fora.push(rel);
        break;
      }
    }
  }
  assert.deepEqual(
    fora,
    [],
    'use AccountPicker de @/components/finance/account-picker: uma lista de nomes não diz qual é cartão, e foi assim que um salário caiu na fatura'
  );
});

/**
 * Dois donos do mesmo slot de header.
 *
 * `HeaderActions` e `HeaderMenu` escrevem os DOIS em `headerRight`, cada um pelo seu
 * `<Stack.Screen options={...} />`. `setOptions` faz merge raso: a mesma chave escrita duas
 * vezes não soma, o último ganha. Numa tela que monta os dois, o botão declarado primeiro
 * simplesmente **não existe** no Android — sem erro, sem aviso, sem nada no log.
 *
 * Foi o que aconteceu com o detalhe do lançamento: ele declarava "Editar" e logo abaixo o
 * menu "…", e o menu apagava o "Editar". Como TODA lista do app (Hoje, Financeiro,
 * Lançamentos, Mês, Projeção, Parcelas, Faturas, Busca) desemboca nessa tela, editar um
 * lançamento pelo app ficou inalcançável — a queixa de 10/09/2026 foi literal: *"eu queria
 * conseguir editar direto nessa tela já"*.
 *
 * O caminho certo é UM componente por header: `<HeaderActions actions={...} menu={...} />`.
 */
test('nenhuma tela declara HeaderActions e HeaderMenu juntos', () => {
  const fora: string[] = [];
  for (const file of walk(join(SRC, 'app'))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/<HeaderActions\b/.test(code) && /<HeaderMenu\b/.test(code)) {
      fora.push(file.replace(SRC, 'src'));
    }
  }
  assert.deepEqual(
    fora,
    [],
    'os dois escrevem headerRight e o último ganha — passe o menu por <HeaderActions menu={{ title, actions }} />'
  );
});

/**
 * "Últimos lançamentos" nunca lista o que ainda não aconteceu.
 *
 * O hook não filtrava data e ordenava por `created_at`. Enquanto o materializador gravava 90
 * dias, isso passava despercebido — eram 3 linhas. Em 10/09/2026 a janela virou 365 dias e o
 * cron criou as 12 ocorrências da mesma recorrente NO MESMO INSTANTE: a lista da Hoje e a do
 * Financeiro viraram doze "Manutenção dentista", uma por mês, até agosto de 2027.
 *
 * O corte certo é a DATA (`occurred_at <= hoje`), não o `status`: compra no cartão fica
 * `pending` até a fatura ser paga e ainda assim é lançamento que aconteceu.
 */
test('useRecentTransactions só lista o que já aconteceu', () => {
  const code = stripComments(readFileSync(join(SRC, 'hooks/use-finance.ts'), 'utf8'));
  const hook = code.slice(code.indexOf('export function useRecentTransactions'));
  const corpo = hook.slice(0, hook.indexOf('export function', 1));
  assert.match(
    corpo,
    /\.lte\(\s*['"`]occurred_at['"`]/,
    'sem o corte por data a lista mostra ocorrência futura da recorrente como "último lançamento"'
  );
  assert.match(
    corpo,
    /\.order\(\s*['"`]occurred_at['"`]/,
    'ordenar por created_at põe o que o cron acabou de materializar no topo'
  );
});
