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

test('nenhuma face do tipo antigo sobrou', () => {
  // O tipo do app mudou duas vezes em 16/09/2026: Hanken + JetBrains Mono → Jost + Martian Mono
  // (Concreto) → Plus Jakarta Sans (Suave), com a Martian Mono 400 ficando SÓ para o código
  // inline das notas. Uma face antiga esquecida não dá erro: ela SOME, porque `Type` aponta pelo
  // nome e o pacote dela saiu do projeto.
  assert.deepEqual(
    offenders(
      /HankenGrotesk|JetBrainsMono|hanken-grotesk|jetbrains-mono|Jost_|google-fonts\/jost|MartianMono_(?!400Regular)/
    ),
    [],
    'o tipo do app é Plus Jakarta Sans (e Martian Mono 400 só no código das notas)'
  );
});

test('campo de ação como FUNDO é tintFill, nunca tint', () => {
  // `tint` é a cor de TEXTO e ícone de ação; o campo cheio (botão, selo) é `tintFill`, com o
  // rótulo em `onTint`. Hoje os dois têm o mesmo tom, e é exatamente por isso que a regra fica:
  // quando um accent voltar, é esta separação que impede o texto de virar fundo sem contraste.
  assert.deepEqual(
    offenders(/backgroundColor:[^,}\n]*theme\.tint\b/),
    [],
    'fundo de ação usa theme.tintFill (rótulo onTint); theme.tint é texto, ícone e progresso'
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
 * A sessão tem UMA assinatura, e ela mora em `use-session.tsx`.
 *
 * Cada `useSession()` abria a própria assinatura do Supabase, e o portão de sessão depende de
 * que toda a árvore leia a sessão MOSTRADA — uma segunda assinatura trocaria a tela antes de a
 * cortina cobrir, e `accept_pending_invites` rodava uma vez por instância.
 */
test('nenhum onAuthStateChange fora de hooks/use-session.tsx', () => {
  const fora = offenders(/\bonAuthStateChange\s*\(/).filter(
    (achado) => !achado.startsWith('src/hooks/use-session.tsx:')
  );
  assert.deepEqual(fora, [], 'leia a sessão por useSession(): uma assinatura só, a do provider');
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
  // da fonte. Duas linhas moveriam o círculo para fora do lugar do ícone.
  'src/components/ui/pill-tab-bar.tsx',
  // Prévia do corpo da nota, no cartão da lista. É PRÉVIA de um corpo, não identificador: o
  // texto inteiro está a um toque, e o título logo acima nunca trunca.
  'src/components/notes/note-card.tsx',
  // Prévia da última mensagem, na lista de conversas.
  'src/components/agent/conversation-row.tsx',
  // Rótulo do segmentado: `numberOfLines={1}` vem com `adjustsFontSizeToFit`, então ele ENCOLHE
  // até caber e não mostra reticências. A célula tem largura dividida, e partir a palavra ou
  // quebrar a linha de uma célula só desalinharia a trilha.
  'src/components/ui/segmented.tsx',
  // Dinheiro: `numberOfLines={1}` vem com `adjustsFontSizeToFit`, então o valor ENCOLHE até
  // caber e nunca mostra reticências. Sem o limite ele partia no meio dos dígitos numa coluna
  // estreita ("R$ 1.423,0" / "0"), que é pior que qualquer tamanho de fonte.
  'src/components/ui/money.tsx',
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
 * `SkiaCanvas` desfaz a escala errada, e são CINCO canvases no app. Mesma régua do caminho único para vidro
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
 * Botão `ghost` (texto puro) só onde ele é o PAR do primário (23/09/2026).
 *
 * A queixa foi literal: *"botão só de texto, sem nada atrás, está horrível… nem parece
 * clicável"* — era o "Adicionar detalhes (opcional)" solto num formulário, e havia mais seis
 * iguais ("Apagar lançamento", "Pessoas", "Mais ações"…). Ao lado do primário ("Cancelar" /
 * "Salvar", "Reenviar código" sob o código) o texto puro é a convenção das duas plataformas;
 * sozinho, ele vira `secondary`. Arquivo novo aqui exige dizer QUAL é o primário ao lado.
 */
const GHOST_PERMITIDO = new Set([
  'src/app/catalog.tsx', // o catálogo do design mostra a variante
  'src/app/forgot-password.tsx', // "Voltar" e "Reenviar código", pares do botão do passo
  'src/app/import.tsx', // "Marcar todos": ação de cabeçalho da lista da prévia
  'src/app/link-email.tsx', // "Cancelar"/"Trocar e-mail" e "Reenviar código", pares do passo
  'src/app/link-phone.tsx', // idem, com o número
  'src/app/notes/folders.tsx', // "Cancelar" ao lado de "Salvar"
  'src/app/onboarding.tsx', // "Agora não" sob "Continuar"
  'src/app/signup.tsx', // "Já tenho conta" sob "Criar conta"; "Reenviar código"
  'src/components/auth/email-login-screen.tsx', // "Criar conta" sob "Entrar"; links da linha
  'src/components/login-screen.tsx', // "Voltar"/"Trocar número" e "Reenviar código"
]);

test('botão ghost só como par do primário', () => {
  const fora = offenders(/variant="ghost"/).filter((achado) => !GHOST_PERMITIDO.has(achado.split(':')[0]));
  assert.deepEqual(fora, [], 'ghost sozinho não parece botão: use `secondary` (ou `tone="danger"` para apagar)');
});

/**
 * Placeholder de BUSCA cabe numa linha (23/09/2026).
 *
 * No Android o `TextInput` de uma linha não liga `singleLine`: o hint QUEBRA como texto comum e
 * a pílula (altura mínima de 48dp) corta a segunda linha. "Buscar por descrição, lugar ou
 * categoria" (42 caracteres) saía partido e cortado num Poco X6 Pro sem fonte aumentada, e a
 * 375dp × 1,3 no emulador. A pílula tem ~280dp de texto a 1,3×, o que dá ~24 caracteres; 20
 * deixa folga para 360dp. O "o quê" da busca já está no título da tela.
 */
test('placeholder de busca cabe em uma linha', () => {
  const MAX = 20;
  const longos: string[] = [];
  for (const file of walk(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/<(?:Search|SearchField)\b[\s\S]{0,400}?\bplaceholder=\s*\{?\s*(?:'([^']+)'|"([^"]+)")/g)) {
      const texto = m[1] ?? m[2];
      if (texto.length > MAX) longos.push(`${file.replace(SRC, 'src')}  ${texto.length} ch: ${texto}`);
    }
  }
  assert.deepEqual(longos, [], `placeholder de busca acima de ${MAX} caracteres quebra e é cortado no Android`);
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
 * do scroll edge effect do iOS 26, que exige o `ScrollView` na RAIZ da tela.
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
  // O press-in de bloco do app inteiro. O TIPO dele recusa `style` em função (`Omit<…, 'style'>`
  // + `StyleProp<ViewStyle>`), então quem chama não tem como passar a forma que se perde.
  'src/components/motion/pressable-scale.tsx',
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
 *
 * ⚠️ **E as duas esperam o MESMO `pronto`** (16/09/2026). A lista só liga com as bordas
 * definitivas; o resumo buscava com o palpite civil. No caminho feliz isso era trabalho dobrado,
 * e com o `cycle_range` falhando o card afirmava o total de setembro sobre uma lista de outubro
 * que nunca chegava. Mesma janela e mesma prontidão são a mesma garantia.
 */
test('o resumo e a lista de lançamentos leem a mesma janela', () => {
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const lista = code.match(/useTransactions\(\{[\s\S]*?\bfrom:\s*([\w.]+)\.from\b/);
    // Tela sem lista de lançamentos não tem o que casar — a home do Financeiro tem só o resumo.
    if (!lista) continue;
    const nome = file.replace(SRC, 'src');
    const resumo = code.match(/useTransactionsSummary\(\s*([\w.]+)\.from\s*,\s*\1\.to\s*,\s*\1\.pronto\s*\)/);
    if (!resumo) fora.push(`${nome}: o resumo não lê from/to/pronto da mesma variável da lista`);
    else if (resumo[1] !== lista[1]) fora.push(`${nome}: resumo lê ${resumo[1]}, lista lê ${lista[1]}`);
  }
  assert.deepEqual(
    fora,
    [],
    'o total do topo soma a lista de baixo: as duas leituras saem do MESMO useMonthRange'
  );
});

/**
 * O portão de carregamento só aceita CONSULTA.
 *
 * ⚠️ Ele aceitava `Consulta | boolean` e o exemplo da própria doc era
 * `useTelaPronta(summary, cycle, accounts, range.pronto)`. Um booleano não diz se ainda tem
 * alguém tentando: `range.pronto` ficava `false` para sempre com o `cycle_range` falhando, e o
 * Financeiro e os Lançamentos paravam no skeleton sem erro nem "Tentar de novo" (reproduzido no
 * emulador em 16/09/2026, injetando a falha só naquela RPC).
 *
 * Este teste lê a FONTE e não o tipo porque o `tsconfig` exclui `*.test.ts` — uma asserção de
 * tipo aqui dentro nunca seria conferida. As duas metades: a assinatura não reabre, e nenhuma
 * tela volta a passar um `.pronto` (ou qualquer booleano derivado) ao portão.
 */
test('o portão de carregamento só aceita consulta, nunca booleano', () => {
  const portao = stripComments(readFileSync(join(SRC, 'lib', 'tela-pronta.ts'), 'utf8'));
  const assinatura = portao.match(/export function telaPronta\(([^)]*)\)/);
  assert.ok(assinatura, 'não achei a assinatura de telaPronta');
  assert.equal(
    assinatura[1].replace(/\s+/g, ''),
    '...consultas:Consulta[]',
    'telaPronta voltou a aceitar algo além de Consulta'
  );

  const fora: string[] = [];
  for (const file of walk(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    // Só CHAMADAS: a definição (`function useTelaPronta(...): boolean {`) casaria o `boolean`.
    for (const chamada of code.matchAll(/(?<!function\s)useTelaPronta\(([^;{}]*?)\)/g)) {
      if (/\.pronto\b|\btrue\b|\bfalse\b|!/.test(chamada[1])) {
        fora.push(`${file.replace(SRC, 'src')}: ${chamada[1].replace(/\s+/g, ' ').trim()}`);
      }
    }
  }
  assert.deepEqual(fora, [], 'passe a CONSULTA de onde a condição deriva, não o booleano');
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
    'lib/widget-snapshot.ts': 'o retrato dos widgets aplica a máscara ele mesmo (`oculto`): widget não tem <Money>',
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

  // Lê as faces do bloco `Fonts` sem citar família: o regex não envelhece na próxima troca de tipo.
  const inicio = theme.indexOf('export const Fonts');
  const bloco = theme.slice(inicio, theme.indexOf('} as const', inicio));
  const faces = [...bloco.matchAll(/^\s+\w+:\s+'([A-Za-z]+_\d{3}\w*)',/gm)].map((m) => m[1]);
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

/**
 * O header da pilha raiz é translúcido desde o primeiro quadro no iOS 26, e nenhuma tela desfaz.
 *
 * ⚠️ **Era isto que "crashava em qualquer coisa"** (19/09/2026). A tela nascia com header opaco
 * (o `react-native-screens` a embrulha num `SafeAreaView` de topo) e virava translúcida no meio
 * da transição, quando o `<Stack.Screen options>` de dentro dela pedia título grande ou busca: o
 * inset do scroll e o estado da tela se realimentavam até o `ShadowTree::commit` estourar. O
 * mecanismo está no comentário do `headerTransparent` em `app/_layout.tsx`.
 *
 * E o título grande saiu do app: no iOS era ele que "descia junto com a tela" ao puxar — o header
 * é fixo por pedido do dono do produto. `headerLargeTitleEnabled` é o nome novo da mesma opção.
 */
test('header translúcido na raiz, nenhum título grande, nenhuma tela opaca por cima', () => {
  const layout = readFileSync(join(SRC, 'app', '_layout.tsx'), 'utf8');
  assert.match(stripComments(layout), /headerTransparent:\s*IOS_26_OU_MAIS/);
  assert.deepEqual(offenders(/headerLargeTitle(Enabled)?\s*:/), []);
  assert.deepEqual(offenders(/headerTransparent\s*:\s*false/), []);
});

/**
 * ⚠️ **Nenhuma tela de finanças decide "previsto" a partir do `status`.**
 *
 * A régua é a de `finance.md` e já estava escrita em `finance/invoice/[id].tsx`: compra de cartão
 * fica `pending` até a FATURA ser paga, então o `status` chama de "previsto" a compra que a
 * pessoa fez semana passada. A queixa foi literal (19/09/2026). Quem responde isso é
 * `estadoDaLinha` (`src/lib/settle-labels.ts`), e ele olha a DATA.
 *
 * Esta regra existe porque a condição já esteve copiada em quatro telas com três respostas
 * diferentes — é a mesma lição do `settle-labels.ts`, que nasceu de quatro cópias de
 * `status === 'pending'` decidindo se o botão dizia "Paguei" ou "Recebi".
 *
 * O que continua PERMITIDO: `status === 'pending'` para decidir a AÇÃO de dar baixa, e o filtro
 * de status da lista. O que a regra proíbe é ele virar rótulo.
 */
test('nenhuma tela decide "previsto" pelo status', () => {
  const previstoPorStatus =
    /const\s+(previst[oa]|prevista|atrasad[oa])\s*=\s*[\w.]*status\s*[=!]==?\s*'(pending|cleared)'/;
  const encontrados = offenders(previstoPorStatus).filter((linha) =>
    linha.startsWith('src/app/finance') || linha.startsWith('src/app/(tabs)'),
  );
  assert.deepEqual(
    encontrados,
    [],
    `"previsto" sai de estadoDaLinha() (settle-labels.ts), nunca do status:\n${encontrados.join('\n')}`,
  );
});

/**
 * Animação de LAYOUT só pelo ponto único (`components/motion/transicao.ts`), que a desliga no
 * Android: lá a view com `layout=` ficava presa no primeiro quadro, desenhada e tocável na posição
 * antiga (23/09/2026, `design.md` §5). Uma tela com `LinearTransition` direto traz o defeito de volta.
 */
test('LinearTransition só mora em components/motion/transicao.ts', () => {
  const dono = join(SRC, 'components', 'motion', 'transicao.ts');
  const achados = walk(SRC).filter(
    (f) => f !== dono && /\bLinearTransition\b/.test(stripComments(readFileSync(f, 'utf8'))),
  );
  assert.deepEqual(achados, []);
});

/*
  ⚠️ **O título de uma seção fica a `Space.md` do conteúdo — em todo lugar** (23/09/2026). Eram
  quatro medidas: 0 (o ciclo e as pastas, onde o `SectionHead` morava num `View` sem `gap` e o
  rótulo encostava no card — a queixa, com print), 6 no `Section`, 8 em Orçamentos, Recorrentes,
  Metas e no "Tipo" da importação, e 12 nas raízes. Uma medida só, a mesma entre cards irmãos.
  O `SectionHead` não tem espaço próprio: quem o dá é o `View` em volta, e é ele que este teste lê.
*/
/*
  ⚠️ **E o `BlockHeader` também** (25/09/2026). O teste só lia `<SectionHead`, e as raízes usam
  `BlockHeader`: em Notas, "Fixadas" morava num `View` sem `gap` e encostava no primeiro card, e
  "Notas"/"Pastas" tiravam o respiro de uma caixa de 44pt centrada — ~10, não 12 (*"eu não tinha
  pedido para padronizar em todos os lugares do app esse gap entre o label e o card"*). O pai pode
  ser um `View`/`Animated.View` com `styles.x` de `gap: Space.md`, ou o `<Bloco>` da tela, cujo
  estilo também é conferido.
*/
test('título de seção fica a Space.md do conteúdo, no Section e em volta de todo SectionHead e BlockHeader', () => {
  const row = readFileSync(join(SRC, 'components/ui/row.tsx'), 'utf8');
  const fora: string[] = [];
  if (!/\n  section: \{\s*gap: Space\.md,/.test(row)) fora.push('src/components/ui/row.tsx (Section)');
  const temGap = (texto: string, estilo: string) =>
    new RegExp(`\\b${estilo}: \\{[^}]*gap: Space\\.md\\b`).test(texto);
  for (const f of walk(SRC).filter((p) => !/(section-head|block-header)\.tsx$/.test(p))) {
    const texto = readFileSync(f, 'utf8');
    if (!/<(SectionHead|BlockHeader)\b/.test(texto)) continue;
    const linhas = texto.split('\n');
    linhas.forEach((linha, i) => {
      if (!/<(SectionHead|BlockHeader)\b/.test(linha)) return;
      // O pai é o primeiro `View` (ou `Bloco`) aberto acima — um `Pressable` em volta só do
      // título não conta. 40 linhas: há comentário longo entre o pai e o título em Notas.
      let ok = false;
      for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
        if (/<Bloco\b/.test(linhas[j])) {
          ok = /function Bloco\b[\s\S]*?style=\{styles\.bloco\}/.test(texto) && temGap(texto, 'bloco');
          break;
        }
        if (!/<(Animated\.)?View\b/.test(linhas[j])) continue;
        const tag = linhas.slice(j, j + 4).join(' ');
        const estilo = tag.match(/style=\{\[?\s*styles\.(\w+)/)?.[1] ?? '';
        ok = Boolean(estilo) && temGap(texto, estilo);
        break;
      }
      if (!ok) fora.push(`${f.replace(SRC, 'src')}:${i + 1}`);
    });
  }
  assert.deepEqual(fora, [], 'título de seção sem gap Space.md no View em volta');
});

/**
 * Interruptor de formulário é `SwitchRow`: UMA linha e o switch (23/09/2026). Quatro
 * formulários montavam à mão rótulo do `Field` + legenda + dica que trocava com o estado — três
 * textos para um toggle só, a queixa de "texto demais".
 *
 * Fica de fora a lista de avisos do Perfil: lá o switch é o `trailing` de uma `Row` de lista, com
 * título e subtítulo da linha — é o idioma de Ajustes, não de formulário.
 */
test('Switch de formulário só pelo SwitchRow', () => {
  const permitidos = new Set(['src/components/ui/switch-row.tsx', 'src/components/profile/alert-preferences-section.tsx']);
  const fora = offenders(/<Switch\b/).filter((o) => !permitidos.has(o.split(':')[0]));
  assert.deepEqual(fora, [], 'monte o interruptor com <SwitchRow>');
});

/**
 * Frase com valor dentro é UM texto, com o `Money` aninhado (23/09/2026). Montada em peças soltas
 * numa linha `flexWrap` ("R$ 0,00" + "de" + "R$ 30.000,00" + "· faltam" + …), cada peça quebrava
 * sozinha, o `Money` encolhia para caber (`adjustsFontSizeToFit`) e a linha de base desalinhava —
 * a queixa foi a tela de Metas a 384dp × fonte 1,3. Aninhado, o texto quebra entre palavras, no
 * mesmo tamanho.
 *
 * Fica de fora a linha "rótulo à esquerda, valor à direita", que não é frase.
 */
test('frase com dinheiro não é montada em peças numa linha que quebra', () => {
  const rotuloEValor = new Set([
    'src/app/finance/debts.tsx dividaTopo', // nome da dívida | total
    'src/app/finance/debts.tsx proximaLinha', // "Próxima · data" | valor, mesmo tamanho
    'src/components/finance/period-summary-card.tsx faixaLinha', // rótulo | valor da faixa
    'src/app/finance/transactions.tsx saldoLinha', // "Saldo" | valor, no extrato de uma conta
  ]);
  const fora: string[] = [];
  for (const file of walk(SRC).filter((f) => f.endsWith('.tsx'))) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/<View style=\{\[?styles\.(\w+)/g)) {
      const estilo = code.match(new RegExp(`\\n  ${m[1]}: \\{([^}]*)\\}`))?.[1] ?? '';
      if (!estilo.includes('flexWrap') || !estilo.includes("'row'")) continue;
      const bloco = code.slice(m.index! + m[0].length, code.indexOf('</View>', m.index!));
      if (!bloco.includes('<Money') || !bloco.includes('<ThemedText') || bloco.includes('<View')) continue;
      const chave = `${file.replace(SRC, 'src')} ${m[1]}`;
      if (!rotuloEValor.has(chave)) fora.push(chave);
    }
  }
  assert.deepEqual(fora, [], 'aninhe o <Money> dentro de um <ThemedText>');
});

/**
 * O título da linha de EXTRATO tem o mesmo piso de largura do título da `Row` (134dp, medido para
 * "Estacionamentoo" a 384dp). Com 96dp, a 384dp × fonte 1,3 "Financiamento" partia em
 * "Fina / nciamento" ao lado do valor na Projeção (24/09/2026) — palavra partida ao meio é o
 * defeito que o design.md §3 proíbe. Abaixo do piso, o valor desce para baixo do título.
 */
test('o título da linha de extrato tem o mesmo piso de largura do título da Row', () => {
  const row = readFileSync(join(SRC, 'components/ui/row.tsx'), 'utf8');
  const piso = row.match(/\n  labels: \{[^}]*minWidth: (\d+)/)?.[1];
  const extrato = row.match(/tituloDoExtrato: \{[^}]*minWidth: (\d+)/)?.[1];
  assert.ok(piso && extrato, 'os dois estilos existem');
  assert.equal(Number(extrato), Number(piso));
});

test('card que arrasta tem press-in: o filho do Deslizavel é PressableScale ou desenha o pressionado', () => {
  // 24/09/2026: metas, orçamentos, recorrentes e dívidas usavam um `Pressable` cru — o toque no
  // card não dava sinal nenhum (design.md §5: `scale 0.97` em card).
  const semSinal: string[] = [];
  for (const file of walk(join(SRC, 'app'))) {
    if (!file.endsWith('.tsx')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<Deslizavel\b[^<]*?>\s*<(Pressable|PressableScale)\b([^]*?)(?:<Card|<View)/g)) {
      if (m[1] === 'Pressable' && !/\(\{ pressed \}\)/.test(m[2])) {
        semSinal.push(`${file.slice(SRC.length + 1)}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(semSinal, []);
});

/*
  Placeholder é EXEMPLO, nunca um valor que parece preenchido (24/09/2026). O cadastro mostrava
  "Gabriel" — o nome do dono do produto — e o lançamento "Ex.: Nuuvem Wardog", uma compra real
  dele. "Nubank", "Viagem" e "28" num campo vazio liam como campo já preenchido. A régua: o que é
  exemplo começa com "Ex.:"; o resto é instrução ("Buscar…", "Escolher…", "Seu nome"), formato
  que ninguém confunde com dado ("voce@exemplo.com", "dd/mm/aaaa", "(11) 99999-9999") ou o
  PADRÃO do campo (frontend.md: campo com default mostra o default).
*/
const PLACEHOLDER_OK = [
  /^Ex\.: /,
  /^(Buscar|Escolher|Anotar|Escreve|Nome da|Seu |Título$|Sem fim$|Não repete$|dd\/mm\/aaaa$)/,
  /^voce@exemplo\.com$/,
  /^\(\d\d\) 99999-\d{4}$/,
  /^0$/,
];
const NOME_REAL = /gabriel|wardog|nuuvem|almeida/i;

test('Placeholder é exemplo ("Ex.: …") ou instrução, nunca dado que parece preenchido', () => {
  const erros: string[] = [];
  for (const arquivo of walk(SRC)) {
    // `catalog.tsx` é a vitrine de componentes (dev), com valor preenchido de propósito.
    if (arquivo.endsWith('catalog.tsx')) continue;
    const fonte = readFileSync(arquivo, 'utf8');
    for (const m of fonte.matchAll(/placeholder="([^"]*)"/g)) {
      const texto = m[1];
      if (NOME_REAL.test(texto) || !PLACEHOLDER_OK.some((r) => r.test(texto))) {
        erros.push(`${arquivo.replace(SRC, 'src')}: placeholder="${texto}"`);
      }
    }
  }
  assert.deepEqual(erros, []);
});

test('Busca nativa do iOS não esconde a barra de navegação (o "(tabs)" de 24/09/2026)', () => {
  assert.match(readFileSync(join(SRC, 'components/ui/search.ios.tsx'), 'utf8'), /hideNavigationBar=\{false\}/);
});

test('Botão do painel do arrasto é Tap simultâneo ao observador do dedo (iOS não recebia o toque)', () => {
  // 24/09/2026: no iPhone o `Pressable` do gesture-handler dentro do painel perdia o toque para o
  // `Gesture.Manual` que envolve o card. O botão declara a relação com ele.
  const fonte = readFileSync(join(SRC, 'components/ui/deslizavel.tsx'), 'utf8');
  assert.match(fonte, /Gesture\.Tap\(\)\s*\.simultaneousWithExternalGesture\(dedo\)/);
  assert.doesNotMatch(fonte, /<Pressable\b/, 'o painel não volta ao Pressable');
});

test('O item levantado no reordenar tem o raio do card: a sombra não desenha um quadrado', () => {
  // 25/09/2026: segurar uma pasta mostrava bordas retas atrás do ladrilho. A sombra (`boxShadow`)
  // mora no invólucro do `Reorderable`, que não tinha raio — ela contornava a CAIXA quadrada, e
  // os quatro cantos (fora do raio do card, dentro do quadrado) ficavam sem sombra.
  const fonte = readFileSync(join(SRC, 'components/ui/reorderable.tsx'), 'utf8');
  const camada = fonte.slice(fonte.indexOf('const camada'), fonte.indexOf(': { zIndex: 1 }'));
  assert.match(camada, /boxShadow/);
  assert.match(camada, /borderRadius: Radius\.md/, 'o levantado tem o raio dos cards que ele carrega');
  assert.match(camada, /borderCurve: 'continuous'/);
});

test('Nenhum « » em texto do app: o termo vai em negrito ou a frase se reescreve', () => {
  // 25/09/2026, pedido do dono do produto: *"Esse « » pode retirar completamente de todos os
  // lugares… coloque em negrito ou algo assim, mas não deixe nenhum caractere"*. Comentário pode.
  const achados: string[] = [];
  for (const arquivo of walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f))) {
    readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
      const t = linha.trim();
      if (/^(\/\/|\*|\/\*|\{\/\*)/.test(t)) return;
      if (/[«»]/.test(linha.replace(/\/\/.*$/, ''))) achados.push(`${arquivo.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(achados, []);
});

test('O input invisível do Valor não prende o arrasto: não alinha o texto à direita', () => {
  // 25/09/2026: arrastar começando na caixa do R$ não rolava o formulário (medido no s26, com e sem
  // teclado). O `EditText` do Android segura o gesto quando ele PODE ROLAR, e um de linha única
  // alinhado à direita sempre pode (o texto mora na ponta de uma área larguíssima). A caixa é o
  // maior alvo do formulário: era onde o dedo caía, e a tela não descia.
  const fonte = readFileSync(join(SRC, 'components/ui/field.tsx'), 'utf8');
  const captura = fonte.slice(fonte.indexOf('  captura: {'), fonte.indexOf('},', fonte.indexOf('  captura: {')));
  assert.doesNotMatch(captura, /textAlign: 'right'/, 'alinhado à direita, o EditText do Android sempre "pode rolar" na horizontal');
});

test('Campo centralizado ou à direita não prende o arrasto no Android (TextField)', () => {
  // 25/09/2026: o campo de quantidade ("A cada quantos meses", parcelas) é centralizado entre − e
  // +, e arrastar começando nele não rolava o formulário. No Android o `EditText` de linha única
  // alinhado ao centro/direita sempre "pode rolar" na horizontal e não solta o gesto. O `TextField`
  // desenha esses como multilinha de UMA linha, que quebra em vez de rolar.
  const fonte = readFileSync(join(SRC, 'components/ui/field.tsx'), 'utf8');
  const campo = fonte.slice(fonte.indexOf('export const TextField'), fonte.indexOf('interface DateFieldProps'));
  assert.match(campo, /Platform\.OS === 'android'/);
  assert.match(campo, /multiline: true/);
  assert.match(campo, /submitBehavior: 'blurAndSubmit'/);
});

test('O toast sobe acima do teclado: erro de formulário não some atrás dele', () => {
  // 25/09/2026: editar o valor de um pagamento e tocar em Salvar "não fazia nada" — o banco
  // recusava e o toast com o motivo nascia no pé da tela, ATRÁS do teclado aberto.
  const fonte = readFileSync(join(SRC, 'components/ui/toast.tsx'), 'utf8');
  assert.match(fonte, /<KeyboardStickyView/);
});

test('Toda rolagem deixa o toque passar com o teclado aberto (keyboardShouldPersistTaps, nunca o padrão never)', () => {
  // 25/09/2026, medido no s26: com o teclado aberto, o primeiro toque em "Registrar pagamento"
  // só fechava o teclado — sem pressIn, sem pagamento. A folha é um `Modal`, mas no React ela é
  // filha da rolagem da TELA, e o sistema de responder sobe pela árvore do React: no padrão
  // `never` aquela rolagem pega o toque na fase de captura para fechar o teclado. Com `handled`
  // o botão recebe o toque (como no iOS e no Android nativos) e tocar no vazio continua fechando.
  const TAG = /(?<![A-Za-z`])<((?:Animated\.)?(?:ScrollView|FlatList|SectionList|FlashList|KeyboardAwareScrollView|DragScrollView))\b/g;
  const fora: string[] = [];
  for (const file of walk(SRC)) {
    if (!file.endsWith('.tsx')) continue;
    const texto = stripComments(readFileSync(file, 'utf8'));
    for (const m of texto.matchAll(TAG)) {
      // Fim da tag de abertura: o primeiro `>` fora de chaves e de um genérico (`SectionList<T>`).
      let i = m.index! + m[0].length;
      let chaves = 0;
      let generico = texto[i] === '<' ? 1 : 0;
      if (generico) i += 1;
      for (; i < texto.length; i += 1) {
        const c = texto[i];
        if (c === '{') chaves += 1;
        else if (c === '}') chaves -= 1;
        else if (generico && c === '<') generico += 1;
        else if (generico && c === '>') generico -= 1;
        else if (!generico && chaves === 0 && c === '>' && texto[i - 1] !== '=') break;
      }
      // `always` só onde a rolagem mora SOBRE o teclado (a barra de formatação da nota). `never`
      // escrito é decisão declarada e passa; o defeito era o padrão IMPLÍCITO.
      if (!/keyboardShouldPersistTaps="(handled|always|never)"/.test(texto.slice(m.index!, i))) {
        fora.push(`${file.replace(`${SRC}/`, '')}: <${m[1]}>`);
      }
    }
  }
  assert.deepEqual(fora, []);
});

test('Pagamento de dívida não troca de tipo, não vira "vou pagar depois" nem sai de cartão no formulário', () => {
  // O trigger `tg_transactions_debt_payment` exige despesa PAGA: o Segmented de tipo e o "vou
  // pagar depois" num pagamento de dívida eram dois controles que o banco sempre recusaria.
  const fonte = readFileSync(join(SRC, 'app/finance/transaction-form.tsx'), 'utf8');
  assert.match(fonte, /const tipoTravado = [^;]*editing\?\.debt_id/);
  assert.match(fonte, /\{!tipoTravado && \(/);
  assert.match(fonte, /const podeAdiar = [^;]*!editing\?\.debt_id/);
  assert.match(fonte, /filter\(\(a\) => !editing\?\.debt_id \|\| a\.type !== 'credit_card'\)/, 'nem sai de cartão');
  // Nem vira série: a parcela já é projetada pelo cronograma da dívida, e uma recorrente ao lado
  // dela contaria o mesmo dinheiro duas vezes na projeção (25/09/2026).
  assert.match(fonte, /editing\.recurring_id \|\| editing\.installment_plan_id \|\| editing\.debt_id/, 'nem vira série');
  // "Este e as próximas parcelas": o CONTRATO muda antes e o pagamento é gravado no sucesso dele —
  // a ordem da folha de pagar, que faz o trigger gravar a parcela inteira no valor novo (25/09/2026).
  assert.match(fonte, /salvarDivida\.mutate\([\s\S]{0,600}?onSuccess: \(\) =>\s*gravar\(/, 'contrato antes do pagamento');
});

test('Formulário de lançamento só diz "Cadastrar uma conta" com as contas carregadas e vazias', () => {
  // 25/09/2026, no s26: abrindo o formulário, o campo Conta mostrava "Cadastrar uma conta" até a
  // consulta chegar — afirmar vazio exige a consulta respondida (frontend.md), e o botão levava
  // para outra tela quem tem contas.
  const fonte = readFileSync(join(SRC, 'app/finance/transaction-form.tsx'), 'utf8');
  // A ordem é o que conta: carregando → esqueleto; erro → tentar de novo; só então o vazio.
  assert.match(fonte, /contas\.isPending \? \(\s*<Skeleton[\s\S]{0,200}?contas\.isError \? \([\s\S]{0,200}?\(accounts \?\? \[\]\)\.length === 0 \? \(/);
});

test('Formulário aberto por link remonta quando o registro muda (key pelo id)', () => {
  // 25/09/2026: abrir `/finance/transaction-form?id=B` com o formulário de A aberto reaproveitava
  // a tela — o `useForm` só lê os valores na montagem, e ela seguia com os dados de A. Com a
  // `key`, outro id é outro formulário.
  const lancamento = readFileSync(join(SRC, 'app/finance/transaction-form.tsx'), 'utf8');
  assert.match(lancamento, /<TransactionForm\s+key=\{params\.id \?\? 'novo'\}/);
  const lembrete = readFileSync(join(SRC, 'app/reminder-form.tsx'), 'utf8');
  assert.match(lembrete, /<ReminderForm\s+key=\{/);
});

test('o nome que ficava entre « » vai em <Forte>, não solto na frase', () => {
  // 25/09/2026: *"eu pedi para retirar o « » e trocar por negrito a palavra que ficava dentro,
  // agora não tem nada"*. A primeira passada tirou as aspas e deixou o nome cru. O nome é DADO
  // (busca, pasta, descrição de extrato), então vai como filho de `Forte` — nunca como `*${x}*`.
  const soltos: string[] = [];
  const frase = /`(Nada encontrado para|A pasta|Pasta|Já existe uma pasta chamada|Renomear) \$\{/;
  for (const arquivo of walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f))) {
    readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
      if (frase.test(linha)) soltos.push(`${arquivo.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(soltos, []);
});

test('a cascata do Screen não embrulha o que não ocupa lugar na tela', () => {
  // 25/09/2026: com `stagger`, `Stack.Screen`, `HeaderActions` e as folhas viravam caixas vazias
  // que o `gap` espaçava — Orçamentos com 48dp de vão no topo, Projeção com 72dp.
  const fonte = readFileSync(join(SRC, 'components/ui/screen.tsx'), 'utf8');
  assert.match(fonte, /const SEM_CAIXA = new Set<unknown>\(\[Stack\.Screen, HeaderActions, HeaderMenu, Sheet\]\)/);
  assert.match(fonte, /if \(!isValidElement\(filho\) \|\| SEM_CAIXA\.has\(filho\.type\)\) return filho;/);
});

test('nome citado nem exemplo vão entre aspas: negrito onde o app desenha, frase nomeada no diálogo nativo', () => {
  // 25/09/2026, a padronização do negrito: além das « », o app citava nome e exemplo entre “ ” e
  // "" ("Arquivei "Carro"", "Manda “gastei 45 no mercado”"). Onde o app desenha, o nome vai em
  // `<Forte>` e o exemplo em `*assim*`; no diálogo nativo (sem negrito) a frase nomeia o tipo:
  // "Arquivar a meta Viagem?". Ficam as aspas de CITAÇÃO da fala da pessoa (a Conversa da Hoje) e
  // os conjuntos de pontuação do editor de notas.
  const dispensados = ['components/ui/ledger-row.tsx', 'lib/note-inline.ts', 'components/ui/icon.tsx'];
  const achados: string[] = [];
  for (const arquivo of walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f))) {
    if (dispensados.some((d) => arquivo.endsWith(d))) continue;
    readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
      const t = linha.trim();
      if (/^(\/\/|\*|\/\*|\{\/\*)/.test(t)) return;
      const codigo = linha.replace(/\/\/.*$/, '');
      if (/[“”]/.test(codigo) || /"\$\{/.test(codigo)) achados.push(`${arquivo.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(achados, []);
});

test('o conteúdo que substitui o esqueleto nasce no lugar, sem voltar ao invisível', () => {
  // 25/09/2026, medido no emulador: Orçamentos ia do esqueleto a ~0,8 s de tela em branco. A
  // cascata recomeçava do opacidade 0 e a montagem pesada engolia a animação até o teto. A entrada
  // continua tocando quando o app fica visível (a geração seguinte do relógio).
  const tela = readFileSync(join(SRC, 'components/ui/screen.tsx'), 'utf8');
  assert.match(tela, /const \[nasceuSemCascata\] = useState\(!stagger\)/);
  assert.match(tela, /<Cascata noLugar=\{nasceuSemCascata\}>/);
  const entrada = readFileSync(join(SRC, 'components/motion/entrada.tsx'), 'utf8');
  assert.match(entrada, /export function useRelogioDeEntrada\(atrasoMs: number, duracaoMs: number, nascerNoLugar = false\)/);
  assert.match(entrada, /if \(geracao === noLugarNaGeracao\) \{\s*relogio\.set\(1\);\s*return;/);
});

test('as conversas do Agente são buscadas ao entrar na conta, com as MESMAS opções da aba', () => {
  // 25/09/2026: *"eu abro a tela de agente e ele já mostra o campo de digitar e os atalhos, aí
  // passa um tempo depois que ele mostra o recente"*. O agente dorme no Cloud Run; buscar só ao
  // abrir a aba era esperar ele acordar. Duas cópias das opções divergiriam (chave, página).
  const abas = readFileSync(join(SRC, 'app/(tabs)/_layout.tsx'), 'utf8');
  assert.match(abas, /useBuscarConversasAntes\(\);/);
  const hook = readFileSync(join(SRC, 'hooks/use-agent-chat.ts'), 'utf8');
  assert.match(hook, /useInfiniteQuery\(\{ \.\.\.conversasQuery, enabled: isAgentConfigured \}\)/);
  assert.match(hook, /prefetchInfiniteQuery\(conversasQuery\)/);
});

test('toda tela de dados tem puxar para atualizar', () => {
  // 25/09/2026: *"não tem nem como puxar de cima para baixo para atualizar"* — na pasta de notas,
  // e o Detalhe do ciclo também não tinha. Quem não tem o gesto diz por quê.
  const semDados: Record<string, string> = {
    'app/guia.tsx': 'conteúdo fixo',
    'app/catalog.tsx': 'vitrine de desenvolvimento',
    'app/paywall.tsx': 'oferta, não lista',
    'app/reminder-form.tsx': 'formulário',
    'app/finance/transaction-form.tsx': 'formulário',
    'app/notes/[id].tsx': 'editor: puxar competiria com a rolagem do texto',
    'app/(tabs)/agent/index.tsx': 'compositor; o histórico tem o gesto',
    'app/finance/wallet.tsx': 'carrossel de cartões',
    'app/finance/manage.tsx': 'menu de destinos',
  };
  const faltando = walk(join(SRC, 'app'))
    .filter((f) => f.endsWith('.tsx') && readFileSync(f, 'utf8').includes('<Screen'))
    .map((f) => f.slice(SRC.length + 1))
    .filter((f) => !(f in semDados))
    .filter((f) => !/onRefresh|RefreshControl/.test(readFileSync(join(SRC, f), 'utf8')));
  assert.deepEqual(faltando, []);
});
