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
/**
 * Hint de `Field` cabe em DUAS linhas.
 *
 * `footnote` (13px) a 1,3× numa calha de 352dp dá ~44 caracteres por linha, então
 * duas linhas são ~90. O recorde do app tinha **199** — quatro linhas —, e a tela
 * de cartão empilhava cinco blocos assim. Foi a queixa literal do dono do
 * produto: *"esses textos explicativos embaixo do botão não está bonito"*.
 *
 * Explicação que não cabe em duas linhas não é apoio a um campo: ou vira uma
 * frase, ou o que sobra sobe para onde a decisão é tomada.
 *
 * ⚠️ O hint de `EmptyState` fica FORA: design.md §7 pede ali uma dica ACIONÁVEL
 * (normalmente o atalho do WhatsApp), e ela é o conteúdo da tela vazia, não apoio
 * a um campo. Por isso o teste procura `hint=` precedido de `<Field`.
 */
test('hint de Field cabe em duas linhas', () => {
  const MAX = 90;
  const longos: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    // O literal vem COLADO no `hint=` (como `hint="..."` ou `hint={\`...\`}`), com no
    // máximo um `{` e espaço no meio. Sem esta âncora o teste andava para dentro do
    // JSX seguinte e media o código do próximo campo como se fosse texto.
    for (const m of code.matchAll(/<Field\b[\s\S]{0,900}?\bhint=\s*\{?\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g)) {
      const texto = (m[1] ?? m[2] ?? m[3]).replace(/\s+/g, ' ').trim();
      // Em hint dinâmico, o que conta é o texto FIXO: `${valor}` vira o número que
      // ele representa, e medir a expressão mediria o código, não a frase.
      const visivel = texto.replace(/\$\{[^}]*\}/g, '0,00');
      if (visivel.length > MAX) {
        longos.push(`${file.replace(SRC, 'src')}  ${visivel.length} ch: ${visivel.slice(0, 48)}…`);
      }
    }
  }
  assert.deepEqual(
    longos,
    [],
    `hint acima de ${MAX} caracteres ocupa 3+ linhas a 1,3× em 384dp — vire uma frase`
  );
});

/**
 * Tamanho de texto não é composto na tela.
 *
 * `...Type.footnote` espalhado num `StyleSheet` de tela é como o helper text
 * nasceu ad-hoc: o paywall escrevia `rodape: { ...Type.footnote }` só para chegar
 * onde `<Note>` chega. `Type.x` LIDO (`Type.body.lineHeight` num `Skeleton`)
 * continua valendo — o que não pode é ESPALHAR o token para montar uma variante
 * nova de texto numa tela.
 */
test('nenhuma tela compõe variante de texto com spread de Type', () => {
  const fora: string[] = [];
  for (const file of walk(join(SRC, 'app'))) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, n) => {
        if (/\.\.\.Type\.(body|subhead|callout|footnote|headline)\b/.test(line)) {
          fora.push(`${file.replace(SRC, 'src')}:${n + 1}`);
        }
      });
  }
  assert.deepEqual(
    fora,
    [],
    'use <ThemedText type=...> ou <Note>: variante de texto mora no primitivo'
  );
});

/**
 * Glifo de texto não faz papel de ícone.
 *
 * O onboarding escrevia `✓` num `<Text>` para marcar a opção escolhida — o
 * mesmo papel que `<Icon name="checkmark">` cumpre com o símbolo da
 * plataforma, o tamanho de geometria e o mapa SF→Material. Glifo herda a
 * métrica da FONTE: ele cresce com o `fontScale`, muda de desenho entre
 * aparelhos e não tem cor semântica. É a mesma regra que já tirou `‹` e `＋`
 * das telas (§4 do design), e ela some sozinha se ninguém contar.
 */
test('nenhum glifo de texto fazendo papel de ícone', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, n) => {
        // Só os glifos que JÁ fizeram papel de ícone aqui. `×` fica de fora de
        // propósito: ele é sinal de multiplicação em comentário ("384 × 1,3"),
        // e proibi-lo transformaria a trava numa lista de exceções.
        if (/[✓✔✗✘＋]/.test(line)) fora.push(`${file.replace(SRC, 'src')}:${n + 1}`);
      });
  }
  assert.deepEqual(fora, [], 'use <Icon name=...>: glifo de texto cresce com a fonte e não tem mapa Android');
});

/**
 * Campo de formulário é `TextField`, não `TextInput` cru.
 *
 * Era o defeito mais visível do onboarding antigo: um `TextInput` com borda e
 * `...Type.body` escritos à mão, visivelmente diferente de todo outro campo do
 * app (contorno cinza em vez da superfície com raio `sm`). A tela que escreve o
 * próprio input escreve a própria versão de "campo com erro" logo depois — e aí
 * são dois desenhos de foco, dois de erro, dois de placeholder.
 *
 * Os PRIMITIVOS podem: eles são a implementação do campo. A exceção de tela é
 * uma só, e ela não é um campo:
 *
 * - `notes/[id].tsx` — o CORPO da nota é um editor de página inteira, multilinha,
 *   com `selection` controlada para a barra de blocos saber em que linha agir.
 *   Embrulhar isso num `TextField` seria pôr uma moldura de formulário em volta
 *   de uma folha de papel.
 */
const INPUT_CRU_PERMITIDO = new Set([
  'src/components/ui/field.tsx',
  'src/components/ui/search-field.tsx',
  'src/components/auth/otp-input.tsx',
  'src/components/auth/phone-field.tsx',
  'src/components/finance/money-input.tsx',
  'src/app/notes/[id].tsx',
  /*
    NÃO é um campo: `editable={false}`, sem foco, escondido do leitor de tela. `TextInput` é a
    ÚNICA primitiva do RN cujo texto é uma prop animável (`text`), e é assim que o número do
    herói conta até o valor novo sem um `setState` por quadro. Entra aqui porque o regex abaixo
    passou a pegar `createAnimatedComponent(TextInput)` — sem a entrada, a brecha seguiria
    aberta para um campo escrito à mão de verdade.
  */
  'src/components/ui/count-up-money.tsx',
]);

test('nenhuma tela desenha o próprio campo de texto', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const rel = file.replace(SRC, 'src');
    if (INPUT_CRU_PERMITIDO.has(rel)) continue;
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, n) => {
        // ⚠️ `>` FORA da classe: `useRef<TextInput>(null)` é a tipagem de uma
        // ref de foco e não desenha campo nenhum — cinco telas legítimas caíam
        // aqui quando ele estava dentro. O ELEMENTO vem seguido de espaço (as
        // props descem para a linha de baixo) ou de `/`.
        // `createAnimatedComponent(TextInput)` renderiza `<OutroNome>`, então o elemento sozinho
        // não bastava — era por ali que um campo à mão passaria sem ninguém ver.
        if (/<TextInput([\s/]|$)/.test(line) || /createAnimatedComponent\(\s*TextInput\s*\)/.test(line)) {
          fora.push(`${rel}:${n + 1}`);
        }
      });
  }
  assert.deepEqual(
    fora,
    [],
    'use <TextField> (ou o primitivo do domínio): campo escrito à mão diverge no foco, no erro e no placeholder'
  );
});

test('nenhuma tela monta lista de conta à mão', () => {
  // Só o próprio seletor pode iterar contas para desenhar opção; `accounts.tsx`
  // é a tela que GERENCIA contas (ali a lista é o conteúdo, não um campo).
  const PERMITIDO = new Set([
    'src/components/finance/account-picker.tsx',
    'src/app/finance/accounts.tsx',
    // Faturas: a fileira de chips FILTRA o conteúdo da tela, não escolhe onde
    // lançar — e só cartões aparecem nela, porque a tela inteira é de cartão.
    // A confusão que este teste existe para matar (um salário caindo na fatura
    // porque "Nubank" e "Nubank Cartão" tinham a mesma cara) não tem como
    // acontecer onde não há conta corrente na lista.
    'src/app/finance/invoices.tsx',
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

/**
 * Mês de CICLO nunca sai de `currentMonth()`.
 *
 * O ciclo é nomeado pelo mês em que TERMINA: com fechamento no dia 10, o dia 13/09 já pertence
 * ao ciclo chamado "outubro". `currentMonth()` devolve o mês CIVIL, e os dois são a mesma
 * `string YYYY-MM` — nada no compilador separa um do outro.
 *
 * Passando o civil, `cycle_series` devolve o ciclo ANTERIOR, já FECHADO, e a tela carimba nele a
 * data de fim do corrente. Aconteceu em duas telas ao mesmo tempo: a Hoje anunciava
 * "R$ 0,72 · Projeção positiva" num ciclo que fecha em −R$ 759,39 (número, sinal, cor e palavra
 * errados de uma vez), e Lançamentos abria um ciclo inteiro atrasada por até 20 dias/mês.
 *
 * Quem responde é `useCycleMonth`. Este teste é estreito de propósito: `currentMonth()` continua
 * CERTO para o que é civil mesmo — consumo de IA do mês (a cota é por mês de calendário), o
 * parâmetro de volta do detalhe e a semente de um seletor de mês.
 */
test('mês de ciclo nunca vem de currentMonth()', () => {
  assert.deepEqual(
    offenders(/use(?:CycleSeries|CycleLines|CycleRange)\([^)]*currentMonth\(\)/),
    [],
    'o mês que nomeia o ciclo vem de useCycleMonth(): currentMonth() é o mês CIVIL e devolve o ciclo anterior'
  );
});

/**
 * Todo `<Sheet>` abre com `<TaskHeader>`.
 *
 * Havia QUATRO cabeçalhos escritos à mão dentro de sheets — `styles.cabecalho`, `styles.head`,
 * `styles.sheetCabecalho` —, cada um com um padding vertical diferente, título em `smallBold`
 * (15/21) em vez de `title2` (20/26), e DOIS contrapesos de 72px que não centravam nada. O
 * quinto nasceria copiando o quarto.
 *
 * O primitivo também é quem carrega o respiro do topo: no Android o `Modal` ocupa a janela
 * inteira, e sheet sem `TaskHeader` nasce com o conteúdo em cima do relógio.
 */
test('todo Sheet abre com TaskHeader', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    // `<Sheet` seguido de espaço ou `>`: `\b` casaria `<SheetHeader` e o guarda ficaria verde só.
    for (const m of code.matchAll(/<Sheet[\s>]/g)) {
      const inicio = m.index ?? 0;
      if (!/<TaskHeader[\s/>]/.test(code.slice(inicio, inicio + 400))) {
        fora.push(`${file.replace(SRC, 'src')}:${code.slice(0, inicio).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(
    fora,
    [],
    'a primeira coisa dentro de um <Sheet> é <TaskHeader>: fechar mora lá, à esquerda, com o padding do primitivo'
  );
});

/**
 * `headerLeft` não existe mais.
 *
 * ⚠️ `react-native-screens` (`ScreenStackHeaderConfig.kt:374-382`) roda `toolbar.title = null`
 * sempre que existe um subview LEFT customizado. As três telas modais renderizavam ✕ + Salvar e
 * NENHUM título no Android — "Novo lançamento" e "Editar lançamento" eram a mesma tela na tela.
 * Modal agora é `headerShown: false` + `<TaskHeader>`.
 *
 * Allowlist ZERO, e é medido: `headerLeft` aparecia uma vez no repo e essa uma saiu.
 */
test('nenhuma tela monta headerLeft', () => {
  assert.deepEqual(
    offenders(/\bheaderLeft\b/),
    [],
    'no Android um subview LEFT apaga o título do toolbar: use headerShown:false + <TaskHeader>'
  );
});

/**
 * A saída de uma tarefa é `<TaskHeader onClose>`, não um ✕ solto numa tela.
 *
 * O `xmark` fora do primitivo é o começo de um cabeçalho à mão: foi assim que o `modalOptions`
 * do `_layout.tsx` e quatro linhas de sheet nasceram, cada uma com o seu padding.
 */
const XMARK_PERMITIDO = new Set([
  // O ✕ que REMOVE a tag da nota, dentro da pílula. Não é saída de tela.
  'src/app/notes/[id].tsx',
]);

test('nenhuma tela desenha o próprio botão de fechar', () => {
  const fora = offenders(/name="xmark"/).filter((achado) => {
    const arquivo = achado.split(':')[0];
    return arquivo.startsWith('src/app/') && !XMARK_PERMITIDO.has(arquivo);
  });
  assert.deepEqual(
    fora,
    [],
    'a saída de um sheet ou modal é <TaskHeader onClose>: ✕ solto vira cabeçalho à mão na linha seguinte'
  );
});

/**
 * `Segmented` tem de 2 a 4 opções.
 *
 * A partir de 5 a célula fica estreita demais e o rótulo parte no meio da palavra —
 * "Investimen/to" foi o caso real, no tipo de conta. Acima de 4, o controle é `SelectField`
 * (`design.md` §1: "escolher um" tem TRÊS controles, e qual deles é regra, não gosto).
 *
 * ⚠️ O `design.md` afirmava que este teste já existia. Não existia — foi escrito em 13/09/2026,
 * e a afirmação era a única coisa segurando a regra.
 */
test('Segmented não passa de 4 opções', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/<Segmented[\s\S]{0,1200}?\/>/g)) {
      const trecho = m[0];
      const opcoes = [...trecho.matchAll(/\{\s*value:/g)].length;
      if (opcoes > 4) {
        fora.push(
          `${file.replace(SRC, 'src')}:${code.slice(0, m.index ?? 0).split('\n').length}  ${opcoes} opções`
        );
      }
    }
  }
  assert.deepEqual(fora, [], 'acima de 4 opções o rótulo quebra no meio da palavra a 384dp — use SelectField');
});

/**
 * Toda tela de CONTEÚDO passa pelo `<Screen>`.
 *
 * `Screen` é quem carrega o ritmo vertical do app: `gap: Space.xl` entre blocos, calha
 * `Space.lg`, o respiro do topo calibrado no aparelho (`+ Space.sm`, nos dois sentidos) e o
 * padding de baixo que soma safe area + dock + FAB. Ele também resolve o teclado e a heurística
 * do large title do iOS, que exige o `ScrollView` na RAIZ da tela.
 *
 * ⚠️ **Espaçamento neste app já era todo tokenizado** — 13 literais crus no repo inteiro. O
 * desvio nunca foi "faltam tokens"; era tela escrevendo o PRÓPRIO padding. Eram duas: a Hoje
 * (que empilhava 96dp de vazio em volta do empty state, e tinha `+ Space.md` no topo contra o
 * `+ Space.sm` de todas as outras) e a do ciclo (calha 12 contra 16, gap 12 contra 24). As duas
 * eram exatamente as que o dono do produto chamou de desorganizadas.
 *
 * A allowlist é de telas com MOLDURA PRÓPRIA, não de exceções de estilo.
 */
const SEM_SCREEN = new Set([
  'src/app/index.tsx',                 // só um <Redirect>
  'src/app/design-preview.tsx',        // vitrine de dev: monta as raízes de aba à mão
  'src/app/onboarding.tsx',            // fluxo de tela cheia, com paginação própria
  // As seis portas de conta compartilham a moldura `AuthScreen`.
  'src/app/login.tsx',
  'src/app/signup.tsx',
  'src/app/forgot-password.tsx',
  'src/app/login-whatsapp.tsx',
  'src/app/link-email.tsx',
  'src/app/link-phone.tsx',
  // Conversa: lista INVERTIDA com composer fixo — o oposto de um scroll de conteúdo.
  'src/app/agent/new.tsx',
  'src/app/agent/[id].tsx',
]);

test('toda tela de conteúdo usa <Screen>', () => {
  const fora: string[] = [];
  for (const file of walk(join(SRC, 'app'))) {
    const rel = file.replace(SRC, 'src');
    if (rel.endsWith('_layout.tsx') || SEM_SCREEN.has(rel)) continue;
    if (!/<Screen[\s/>]/.test(stripComments(readFileSync(file, 'utf8')))) fora.push(rel);
  }
  assert.deepEqual(
    fora,
    [],
    'o ritmo vertical mora no <Screen>: tela que escreve o próprio padding é a que diverge'
  );
});

/**
 * `createAnimatedComponent(Pressable)` só onde o estilo é ESTÁTICO.
 *
 * ⚠️ **O `Pressable` recebe `style` como FUNÇÃO** (`({ pressed }) => [...]`), e o componente
 * animado do Reanimated **não a aplica** — o estilo simplesmente não chega. Quando esse estilo é
 * quem carrega o `flexDirection: 'row'`, a linha vira COLUNA: título, valor e botão empilhados,
 * com o botão encostado na esquerda. Foi exatamente isso na tela Hoje em 13/09/2026, nas TRÊS
 * seções de conta ao mesmo tempo, no Android e no iOS.
 *
 * ⚠️ **E não dá erro nenhum.** `uiautomator dump` continuava listando os três textos — só que em
 * `bounds` diferentes. Conferir a PRESENÇA do texto deu verde num layout quebrado; layout se
 * confere por geometria ou por imagem.
 *
 * O caminho certo é um `Animated.View` POR FORA, levando `layout`/`entering`/`exiting`, com o
 * `Pressable` normal dentro.
 */
const PRESSABLE_ANIMADO_OK = new Set([
  // Estilo ESTÁTICO (um objeto, não função): o atalho do painel não tem feedback por `pressed`,
  // ele anima por `useAnimatedStyle`. Sem função, não há o que se perder.
  'src/components/ui/quick-actions.tsx',
]);

test('createAnimatedComponent(Pressable) só com estilo estático', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.replace(SRC, 'src');
    if (PRESSABLE_ANIMADO_OK.has(rel)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/createAnimatedComponent\(\s*Pressable\s*\)/.test(code)) fora.push(rel);
  }
  assert.deepEqual(
    fora,
    [],
    'o style em função do Pressable não sobrevive ao componente animado: envolva num Animated.View'
  );
});

/**
 * A lista e o total do topo leem a MESMA janela.
 *
 * `useTransactions` recortava o mês CIVIL por conta própria (`monthBounds`), enquanto o resumo
 * da mesma tela pedia a janela a `useMonthRange`, que respeita a régua `Mês | Ciclo`. Com
 * fechamento no dia 10 as duas discordavam em ~20 dias: medido no staging em 13/09/2026, a
 * lista de "outubro" trazia 4 lançamentos do ciclo SEGUINTE (Meli+, DAS e salário de 20/10,
 * Carro Peças 3/3) e escondia 6 do ciclo que estava na tela, incluindo o salário de 20/09.
 *
 * Nada apontava o defeito: o total de RECEITA batia por coincidência — cada janela continha
 * exatamente um salário —, e o botão `Mês | Ciclo` ficava logo acima de uma lista que o
 * ignorava. Um card somando 8.326,63 em cima de uma lista de 3.842,78 foi a metade visível.
 *
 * O tipo já impede voltar a passar `month`. O que ele não vê é as duas leituras receberem
 * janelas de origens DIFERENTES, que é a forma que o defeito tinha.
 */
test('o resumo e a lista de lançamentos leem a mesma janela', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const lista = code.match(/useTransactions\(\{[\s\S]*?\bfrom:\s*([\w.]+)\.from\b/);
    // Tela sem lista de lançamentos não tem o que casar — a home do Financeiro tem só o resumo.
    if (!lista) continue;
    const nome = file.replace(SRC, 'src');
    const resumo = code.match(/useTransactionsSummary\(\s*([\w.]+)\.from\s*,\s*\1\.to\s*\)/);
    if (!resumo) fora.push(`${nome}: a lista declara janela e o resumo não sai da mesma variável`);
    else if (resumo[1] !== lista[1]) fora.push(`${nome}: resumo lê ${resumo[1]}, lista lê ${lista[1]}`);
  }
  assert.deepEqual(
    fora,
    [],
    'o total do topo soma a lista de baixo: as duas leituras saem do MESMO useMonthRange'
  );
});

/**
 * Dinheiro visível obedece ao "esconder saldo".
 *
 * `formatBRL` é puro e não conhece o olho do painel — então toda frase que interpolava um valor
 * (`entra X · sai Y`, `usado X de Y`, `mais X previstos`) continuava escrevendo o número por
 * extenso depois de a pessoa esconder o total logo acima. Esconder num lugar e vazar em três é a
 * falha nº 1 deste padrão, e o próprio `conceal.tsx` já dizia isso no cabeçalho: *"meio-olho é
 * pior que nenhum olho"*.
 *
 * O caminho é `<Money>` (bloco) ou `useBRL()` (dentro de frase). A allowlist abaixo é o que
 * **não** deve esconder, e cada entrada precisa do motivo escrito.
 */
test('valor em texto visível passa por Money ou useBRL', () => {
  /** Onde `formatBRL` cru está CERTO — e por quê. */
  const PERMITIDO: Record<string, string> = {
    'components/ui/money.tsx': 'é quem implementa o esconder',
    'components/ui/count-up-money.tsx': 'idem, na variante animada',
    'components/ui/conceal.tsx': 'é o próprio useBRL',
    // Superfície de DECISÃO: a pessoa está confirmando ou digitando ESTE valor agora, e
    // esconder o número que ela precisa conferir é o oposto de proteger (é a mesma régua do
    // `concealable={false}` do Money). Vale para toast, action sheet destrutivo e erro de campo.
    'app/finance/transaction-form.tsx': 'valor sendo digitado e a dica de parcelamento dele',
    'lib/dates.ts': 'é onde formatBRL nasce',
    'lib/brl-worklet.ts': 'deriva o separador do formatador, não mostra valor',
    'lib/month-view.ts': 'helper puro, sem tela chamando — quando tiver, recebe o brl por parâmetro',
  };
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.replace(`${SRC}/`, '');
    if (PERMITIDO[rel]) continue;
    // Linhas CRUAS: `stripComments` apaga blocos inteiros e desloca a numeração, e este teste
    // aponta arquivo:linha. Comentário de uma linha é descartado no filtro abaixo.
    const linhas = readFileSync(file, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      if (!linha.includes('formatBRL(')) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;
      if (/^\s*import /.test(linha)) return;
      // Já trata o esconder na própria linha.
      if (/concealed \?/.test(linha)) return;
      /*
        a11y é lido por quem já está com o aparelho na mão; confirmação, toast e erro de campo
        são superfície de DECISÃO — esconder o número que a pessoa precisa conferir agora é o
        oposto de proteger (mesma régua do `concealable={false}` do Money).

        A janela olha para os DOIS lados porque essas chamadas são quase sempre multilinha, e o
        marcador cai ora antes ora depois: `accessibilityLabel=` abre antes do valor, mas o
        `toast({...})` do rotativo é montado em `partes[]` várias linhas ACIMA da chamada.
      */
      const janela = linhas.slice(Math.max(0, i - 6), i + 7).join(' ');
      if (
        /accessibilityLabel|confirmDestructive|toast\(|message:|const what =|`Some |hint=|error=|label=/.test(
          janela
        )
      ) {
        return;
      }
      fora.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(
    fora,
    [],
    'dinheiro que a tela mostra sai de <Money> ou de useBRL() — formatBRL cru ignora o esconder saldo'
  );
});

/**
 * Toda face declarada em `Fonts` está carregada no `_layout.tsx` raiz.
 *
 * É o modo de falha mais caro que este projeto já teve duas vezes, sempre pela mesma causa — um
 * NOME que ninguém resolve. Face de fonte não cai no system font quando falta: **o texto some**.
 * Em 28/08 foi o `Icon` (nome de SF Symbol sem par no mapa do Android) e todos os ícones do app
 * ficaram invisíveis; aqui seria o `*negrito*` de uma nota desaparecendo da tela.
 *
 * Por texto e não por import: `constants/theme.ts` puxa `react-native` e `global.css`, que não
 * carregam no `node --test`. É a mesma estratégia do `icon-map.test.ts`.
 */
test('toda face de Fonts está carregada no _layout raiz', () => {
  const theme = readFileSync(join(SRC, 'constants', 'theme.ts'), 'utf8');
  const layout = readFileSync(join(SRC, 'app', '_layout.tsx'), 'utf8');

  const faces = [...theme.matchAll(/^\s+\w+:\s+'((?:HankenGrotesk|JetBrainsMono)_\w+)',/gm)].map(
    (m) => m[1]
  );
  assert.ok(faces.length >= 8, 'não achei as faces em theme.ts — o regex envelheceu');

  const faltando = faces.filter((face) => !layout.includes(face));
  assert.deepEqual(faltando, [], 'face declarada e não carregada faz o TEXTO SUMIR, sem erro');
});

/**
 * `NoteColors` e o CHECK do banco listam os MESMOS oito nomes.
 *
 * A cor da nota é guardada como nome de token, e o CHECK da migration é o que impede o app de
 * gravar um nome que não existe na paleta. Divergiram → ou a tela oferece uma cor que o banco
 * recusa com 23514 no salvar, ou existe no banco uma cor que a tela não sabe pintar e o trilho
 * some. Mesma régua do `categories.test.ts`, que prende a lista duplicada entre TS e Python.
 */
test('a paleta de nota e o CHECK do banco dizem a mesma coisa', () => {
  const theme = readFileSync(join(SRC, 'constants', 'theme.ts'), 'utf8');
  const migrations = join(SRC, '..', 'supabase', 'migrations');
  const sql = readdirSync(migrations)
    .filter((f) => f.includes('nota_ganha_lugar_cor_e_ordem'))
    .map((f) => readFileSync(join(migrations, f), 'utf8'))
    .join('\n');
  assert.ok(sql, 'a migration da cor sumiu — este teste perdeu o alvo');

  const naPaleta = [
    ...theme.slice(theme.indexOf('export const NoteColors')).matchAll(/^\s+(\w+): '#[0-9A-Fa-f]{6}',/gm),
  ].map((m) => m[1]);
  const noCheck = [...sql.matchAll(/color is null or color in\s*\n?\s*\(([^)]+)\)/g)]
    .map((m) => m[1].match(/'(\w+)'/g)?.map((x) => x.replace(/'/g, '')) ?? []);

  assert.ok(noCheck.length >= 2, 'esperava o CHECK em notes E em note_folders');
  for (const lista of noCheck) {
    assert.deepEqual(
      [...new Set(lista)].sort(),
      [...new Set(naPaleta)].sort(),
      'paleta e CHECK divergiram: ou a tela oferece cor que o banco recusa, ou o contrário'
    );
  }
});
