# Suave — Fase 3: Conta e onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** as telas de conta ficam como o login dos vídeos — a tinta da abertura (e da saída) PARA no
topo e vira o cabeçalho curvo da tela; entrar cobre a partir do botão; o código de 6 dígitos e o
onboarding entram no desenho Suave.

**Architecture:** a cortina ganha um destino de parada (`ate: 'capa'`): em vez de revelar até o
fim, ela para numa altura calculada por `progressoDaCapa` e desmonta — por baixo, o `AuthScreen`
desenha a MESMA curva (`AuthCap`, a `WaveCurtain` parada nesse progresso), então a passagem não
aparece. O portão decide o destino (sem sessão → capa) e a abertura recebe o destino da raiz. O
`Button` registra o próprio centro na cortina quando pedido (`origemDaCortina`), e a cobertura de
entrar nasce ali.

**Tech Stack:** Expo SDK 57, RN 0.86, Reanimated 4.5, Skia 2.6, react-native-keyboard-controller,
`node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-concreto-redesign-design.md` — seção *Direção revisada:
Suave* (vale acima do visual Concreto) e *Entrar / sair / onboarding*, *Telas de conta*.
**Planos anteriores:** fase 1 e fase 2 (leia as *Emendas* das duas).

## Global Constraints

- Regra 0 das telas de conta: todos os campos, "Criar conta", "Entrar com o WhatsApp", "Esqueci
  minha senha", "Entrar como teste (dev)" em `__DEV__`, reenvio e troca de número no WhatsApp,
  mensagens de erro. Onboarding: os 4 passos e todo o conteúdo, voltar do Android, porta de mão
  única.
- `verifyOtp` de recuperação devolve SESSÃO: nada de `setState` depois desse `await` (frontend.md).
- Cor só via `useTheme()`; zero `fontSize` solto; peso é família.
- Animação só em `transform`/`opacity`/buffer do Skia; Reduce Motion → cross-fade.
- A cortina nunca prende (teto e `abrirJa`).
- Commit: uma linha, sem `Co-Authored-By`. Sem tag, sem produção.
- Portão por tarefa: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída).

---

## Mapa de arquivos

| arquivo | ação | responsabilidade |
|---|---|---|
| `src/design/wave-math.ts` + `.test.ts` | modificar | `CAPA` e `progressoDaCapa(altura)` |
| `src/lib/session-gate.ts` + `.test.ts` | modificar | `Onda.ate?: 'capa'`; sair revela até a capa |
| `src/components/motion/session-curtain.types.ts` | modificar | `marcarPronto(destino)` |
| `src/components/motion/session-curtain.tsx` (+ `.web.tsx`) | modificar | revelar até a capa; abertura com destino |
| `src/app/_layout.tsx` | modificar | passa o destino da abertura |
| `src/components/auth/auth-cap.tsx` | criar | a curva parada no topo, com a marca e a frase |
| `src/components/auth/auth-screen.tsx` | modificar | capa, título de exibição, entrada depois da cortina |
| `src/components/ui/button.tsx` | modificar | `origemDaCortina` |
| `src/components/auth/email-login-screen.tsx`, `src/app/signup.tsx`, `src/app/forgot-password.tsx`, `src/components/login-screen.tsx` | modificar | título na capa; origem nos botões que entram |
| `src/components/auth/otp-input.tsx` | modificar | caixas Suave e dígito que assenta |
| `src/app/onboarding.tsx` | modificar | sai o `GradientSurface`; trilho em pílulas |

---

### Task 1: Onde a capa para (`wave-math`) e o destino na regra do portão

**Interfaces — Produces:** `CAPA = 0.2` (fração da altura onde fica a linha de base da borda);
`progressoDaCapa(altura: number): number`; `alturaDaCapa(altura: number): number` (o ponto mais
BAIXO da borda, à esquerda — é onde o conteúdo da tela pode começar); `Onda.ate?: 'capa'`.

- [ ] **Step 1: testes que falham** — em `src/design/wave-math.test.ts`:

```ts
test('a capa para com a linha de base em 20% da altura', () => {
  for (const H of [640, 874, 956]) {
    const p = progressoDaCapa(H);
    assert.ok(p > 0 && p < 1);
    const base = bordaDaOnda(p, 'revelar', H, amplitude(p, H));
    assert.ok(Math.abs(base - H * CAPA) < 0.5, `H=${H}: base ${base}`);
  }
});

test('a altura da capa é o ponto mais baixo da borda', () => {
  const H = 874;
  const p = progressoDaCapa(H);
  const A = amplitude(p, H);
  const c = pontosDaCurva(bordaDaOnda(p, 'revelar', H, A), 402, A);
  assert.equal(alturaDaCapa(H), c.y0);
});
```

  e em `src/lib/session-gate.test.ts`, trocando o teste de sair:

```ts
test('sair cobre de baixo e revela até a capa do login', () => {
  assert.deepEqual(ondaDaTroca(null, null), { mode: 'up', ate: 'capa' });
  assert.deepEqual(ondaDaTroca(null, { x: 0.5, y: 0.8 }), { mode: 'up', ate: 'capa' });
});
```

- [ ] **Step 2:** `node --test src/design/wave-math.test.ts src/lib/session-gate.test.ts` → FAIL.

- [ ] **Step 3: implementar** — em `wave-math.ts`:

```ts
/** Onde a borda da capa do login descansa: a linha de base em 20% da altura da tela. */
export const CAPA = 0.2;

/**
 * O progresso de REVELAR em que a linha de base cai em `CAPA`. A amplitude depende do progresso,
 * então não há fórmula fechada: bisseção, que converge em 30 passos para menos de um pixel.
 * A borda de revelar só sobe com `p`, então a função é monotônica e a bisseção é segura.
 */
export function progressoDaCapa(altura: number): number {
  'worklet';
  const alvo = altura * CAPA;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const meio = (lo + hi) / 2;
    const base = bordaDaOnda(meio, 'revelar', altura, amplitude(meio, altura));
    if (base > alvo) lo = meio;
    else hi = meio;
  }
  return (lo + hi) / 2;
}

/** O ponto mais baixo da borda da capa (a ponta esquerda): o conteúdo começa abaixo dele. */
export function alturaDaCapa(altura: number): number {
  'worklet';
  const p = progressoDaCapa(altura);
  const A = amplitude(p, altura);
  return pontosDaCurva(bordaDaOnda(p, 'revelar', altura, A), 0, A).y0;
}
```

  em `session-gate.ts`: `export interface Onda { mode: WaveMode; origin?: Ponto; ate?: 'capa' }`
  e `if (depois === null) return { mode: 'up', ate: 'capa' };` (a doc: "sair revela até a capa do
  login, que desenha a mesma curva").

- [ ] **Step 4:** testes → PASS; portão; commit `feat(motion): a cortina sabe parar na capa do login`.

---

### Task 2: A cortina para na capa, e a abertura recebe o destino

**Interfaces:** `CortinaApi.marcarPronto(destino: 'app' | 'conta'): void` (substitui a versão sem
argumento); `revelar(onda)` respeita `onda.ate`.

- [ ] **Step 1:** `session-curtain.types.ts` — `marcarPronto(destino: 'app' | 'conta'): void;` com a
  doc "a abertura para na capa quando o destino é uma tela de conta". `session-curtain.web.tsx`:
  `marcarPronto: () => {}` continua válido.

- [ ] **Step 2:** `session-curtain.tsx`:
  - `const { height: alturaDaTela } = useWindowDimensions();` no provider;
  - `pronto` guarda também o destino (`destino: 'app' | 'conta'`);
  - `descobrir(o, duracao)` passa a calcular `const alvo = o.ate === 'capa' ? progressoDaCapa(alturaDaTela) : 1;`,
    anima até `alvo` com `duracao * (0.35 + 0.65 * alvo)` e, ao chegar, desmonta (`setFase('aberta')`) —
    a capa do `AuthScreen` está por baixo com a mesma curva;
  - `animar(alvo: number, duracao)` aceita qualquer alvo;
  - na abertura, depois de `prontoOuTeto`: `const destino = pronto.current.destino; await descobrir({ ...ONDA_DA_ABERTURA, ate: destino === 'conta' ? 'capa' : undefined }, …)`
    (com teto estourado o destino fica `'app'`: revelar tudo é o lado seguro);
  - `MarcaDaAbertura` na parada da capa: a marca some antes (`k` sobre `min(alvo, 0.35)`), então
    nada muda nela.

- [ ] **Step 3:** `_layout.tsx` — `cortina.marcarPronto(session ? 'app' : 'conta')` no efeito do
  `pronto` (deps com `session`).

- [ ] **Step 4:** portão; commit `feat(motion): abertura e saída param na capa do login`.

---

### Task 3: A capa do login (`AuthCap`) e o `AuthScreen` novo

**Interfaces — Produces:** `AuthCap({ subtitle }: { subtitle?: string })`;
`AuthScreen({ children, footer, showBrand, title, subtitle })` — `title`/`subtitle` passam a ser
da moldura (as telas deixam de escrever o próprio cabeçalho).

- [ ] **Step 1: `src/components/auth/auth-cap.tsx`:**

```tsx
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WaveCurtain } from '@/components/motion/wave-curtain';
import { ThemedText } from '@/components/themed-text';
import { Mark } from '@/components/ui/mark';
import { Space } from '@/design/tokens';
import { progressoDaCapa } from '@/design/wave-math';
import { useTheme } from '@/hooks/use-theme';

/**
 * A capa das telas de conta: a tinta da abertura, parada no topo — o cabeçalho curvo dos vídeos.
 *
 * É a MESMA `WaveCurtain` da cortina, no mesmo progresso (`progressoDaCapa`) e do tamanho da
 * janela: quando a cortina da raiz para aqui e desmonta, a curva de baixo é idêntica e a passagem
 * não aparece. Por isso ela ocupa a JANELA inteira (a parte abaixo da curva é transparente) e fica
 * fora do fluxo — quem reserva o espaço do conteúdo é o `AuthScreen`, com `alturaDaCapa`.
 */
export function AuthCap({ subtitle }: { subtitle?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const progresso = useSharedValue(progressoDaCapa(height));

  return (
    <View pointerEvents="none" style={[styles.capa, { width, height }]}>
      <WaveCurtain
        progress={progresso}
        fase="revelar"
        mode="up"
        color={theme.curtain}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.marca, { top: insets.top + Space.lg }]}>
        <Mark size={36} color="onCurtain" />
        {subtitle ? (
          <ThemedText type="small" themeColor="onCurtainMuted" style={styles.frase}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capa: { position: 'absolute', top: 0, left: 0 },
  marca: { position: 'absolute', left: Space.xl, right: '40%', gap: Space.sm },
  frase: { flexShrink: 0 },
});
```

- [ ] **Step 2: `auth-screen.tsx`** — com `showBrand`, desenha `<AuthCap subtitle={subtitle} />` como
  primeiro filho do conteúdo do scroll, e o conteúdo passa a começar ABAIXO da capa
  (`paddingTop: alturaDaCapa(altura) + Space.xl`, `justifyContent: 'flex-start'`, rodapé com
  `marginTop: 'auto'`). Sem `showBrand`: `paddingTop: insets.top + Space.xxxl` como hoje.
  O título vira `<SplitReveal text={title} variant="display" play={aberta} />` e o conteúdo +
  rodapé entram em `<Reveal index={i}>` — mas só depois da PRIMEIRA vez que a cortina abriu:

```tsx
  const aberta = useCortinaAberta();
  const [visto, setVisto] = useState(aberta);
  if (aberta && !visto) setVisto(true);
```

  (trava: `visto` nunca volta a `false`, senão o formulário sumiria por baixo da cortina que cobre
  ao entrar). Antes de `visto`, o conteúdo NÃO monta — a capa está lá, e o resto entra depois.
  Os comentários de teclado (`KeyboardAwareScrollView`, rodapé dentro do scroll) ficam.

- [ ] **Step 3:** `email-login-screen.tsx`, `signup.tsx`, `forgot-password.tsx`, `login-screen.tsx`
  (WhatsApp): o `<ThemedText type="title">…</ThemedText>` + frase de cada passo sobe para
  `title`/`subtitle` do `AuthScreen` (a frase curta da conta vai para a capa: "Suas notas,
  lembretes e gastos, organizados num lugar só."). Passos internos (código, senha nova) trocam o
  `title` — `SplitReveal` remonta pela `key` do passo.

- [ ] **Step 4:** portão; aparelho (iOS e Android, claro e escuro): abrir sem sessão a frio → a
  tinta sobe e PARA no topo, sem salto na passagem; o título entra letra a letra e o formulário
  depois; 384dp × 1,3 → a frase da capa não invade a curva (se invadir, diminuir `right` da marca
  ou a frase vai para baixo da capa). Commit `feat(auth): capa curva nas telas de conta`.

---

### Task 4: Entrar cobre a partir do botão

**Interfaces — Produces:** `ButtonProps.origemDaCortina?: boolean`.

- [ ] **Step 1:** `button.tsx` — `const caixa = useRef<View>(null)`, `ref={caixa}` no wrapper, e no
  `onPress` (antes de chamar o do usuário), quando `origemDaCortina`:

```tsx
caixa.current?.measureInWindow((x, y, w, h) => {
  const { width, height } = Dimensions.get('window');
  if (width > 0 && height > 0) cortina.lembrarOrigem({ x: (x + w / 2) / width, y: (y + h / 2) / height });
});
```

  com `const cortina = useCortina();` (import de `@/components/motion/session-curtain`).

- [ ] **Step 2:** `origemDaCortina` no "Entrar" e no "Entrar como teste (dev)" do e-mail, no botão
  que confirma o cadastro, no que confirma a senha nova e no "Entrar" do WhatsApp.

- [ ] **Step 3:** portão; aparelho: entrar pelo botão → a cápsula aparece, o círculo de tinta nasce
  NO botão, cobre, e a Hoje é revelada subindo. Commit `feat(auth): entrar cobre a partir do botão`.

---

### Task 5: Código de 6 dígitos e onboarding no desenho Suave

- [ ] **Step 1: `otp-input.tsx`** — caixa: `backgroundColor: theme.surface`, `borderRadius:
  Radius.sm`, fio de 1dp `separator` sempre (largura constante — design.md §7b), e um anel de
  1,5dp por cima (ativo: `tint`; erro: `danger`) por opacidade, como o `Field`. O dígito entra
  assentando: `<Animated.Text key={`${i}:${digits[i]}`} entering={ZoomIn.springify().damping(16)}>`
  (dentro da caixa de tamanho fixo, sem mexer em layout). O cursor continua.

- [ ] **Step 2: `onboarding.tsx`** — o bloco que usa `GradientSurface from={heroTop} to={heroBottom}`
  vira `View` chapada `heroSurface` de canto `Radius.lg`; o `Trilho` vira pílula (altura 4,
  `Radius.pill`), cheio em `tint` com `scaleX` animado em mola, vazio em `backgroundElement`.
  Nada de conteúdo muda.

- [ ] **Step 3:** portão; aparelho: cadastro até o código (sem enviar código real — o campo e o
  erro bastam), onboarding nos 4 passos com voltar do Android. Commit
  `feat(auth): código e onboarding no desenho Suave`.

---

### Task 6: Verificação da fase

- [ ] Regra 0 das telas de conta e do onboarding, item por item, nos dois aparelhos.
- [ ] Sair (Perfil no iOS; saída LOCAL temporária no Android, com o armazenamento restaurado
  depois, para não revogar a sessão do `teste@`) → a tinta cobre de baixo e para na capa.
- [ ] Entrar com a conta `dev@` → círculo a partir do botão → Hoje.
- [ ] Reduce Motion nos dois; claro e escuro; 384dp × 1,3 a frio.
- [ ] Commit de ajustes, se houver.

## Emendas depois da execução (16–17/09/2026)

- **Placeholder do campo no iOS**: depois de sair da conta sem reiniciar o app, o `UITextField`
  desenhava o placeholder 16pt abaixo e a metade de cima não recebia foco. O `TextField` passa o
  placeholder um quadro DEPOIS de montar (só no iOS). Descartados na investigação: entrada com
  `translateY`, `FadeInLeft`, props de autopreenchimento, troca de tema.
- **Barra de status clara nas telas de conta**: a capa é tinta nos dois temas. No Android quem
  manda é a opção da tela (`contaOptions`); no iOS, o `StatusBar` que o `AuthScreen` monta.
- **Capa no tema escuro**: a curva tem a cor do fundo (`#0B0B0C` sobre `#0B0B0C`), então só a
  marca aparece. Aceito como está; um degrau de superfície na capa seria a próxima mexida.
- **Passagem entre as telas de conta em `fade`** (fase 5): a capa é a mesma nas quatro.
