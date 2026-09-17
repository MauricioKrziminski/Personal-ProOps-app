# Concreto — identidade nova e sistema de movimento (16/09/2026)

Aprovado pelo dono do produto em 16/09/2026, seção por seção, a partir do pedido:

> *"quero algo bem fluido e bem animado, desde o loader, login até animações dos cartões abrindo
> uma tela quando eu clicar, mudando o cartão, melhorando tudo nessa parte… use como referência
> sites do awwwards… código robusto, nada de correções superficiais… separe bem o android e ios
> e teste nos dois ao final."*

E a trava que ele acrescentou ao aprovar:

> *"cuidado para não tirar da tela ou mover alguma feature, tem que ser estratégico para que
> features importantes e do mesmo 'nicho' fiquem juntos."*

Referências de movimento: dois vídeos do dono do produto (abertura com cortina em onda, botão que
vira loader, cartão que voa e gira até um carrossel 3D, cartão que se ancora no topo da tela
seguinte). Quadros extraídos e estudados; o vocabulário deles entra traduzido para o mundo abaixo.

## ⚠️ Direção revisada no mesmo dia: **Suave** (vale acima do visual Concreto abaixo)

Depois de ver a fundação no aparelho, o dono do produto recusou a forma: *"estou sentindo muito
quadrado as coisas, quero algo moderno, minimalista, nível o vídeo que eu mandei, olha o design do
vídeo, clean, bonito e minimalista… Arrume esses botões de novo, gráficos, esse ícone nada a ver"*.
A ARQUITETURA desta spec continua (cortina na raiz, portão de sessão, camada de voo, rotas reais,
Regra 0, fases). O que muda é a pele e o vocabulário de movimento, agora tirados dos vídeos:

| tema | Concreto (recusado) | Suave (vale) |
|---|---|---|
| forma | raio 2–12, azulejos, botão tecla | raio 6/12/18/24/28 e pílula; botão, chip, segmentado e avatar em pílula ou círculo |
| cor | papel/tinta + azul Bulcão | papel morno `#F2F1EE`, tinta `#0B0B0C`, superfície branca; **monocromático** — ação em tinta (branca no escuro); verde/vermelho/âmbar só como semântica |
| herói | negativo da página (papel no escuro) | bloco escuro nos dois temas (`#1C1C1E` no escuro), canto 24 |
| tipo | Jost + Martian Mono, títulos em minúsculas | **Plus Jakarta Sans**, pesos leves (título 600, número grande 500), caixa normal; Martian Mono 400 só no código inline das notas |
| cortina | campo de azulejos (Skia Atlas) | **onda curva** (`WaveCurtain`, `design/wave-math.ts`): a tinta sobe com a borda em curva; de um botão, um círculo que cresce |
| abertura | ondulação de azulejos + traço azul | a marca do splash e um anel fino que se desenha em volta dela (5 primeiras); depois a tinta sobe |
| carregando | azulejo girando | a pílula encolhe até uma cápsula e dois pontos trocam de lugar (`DotsLoader`) |
| campos | traço azul de 2px | caixa branca de canto 12 com fio claro; anel de tinta de 1,5px acende no foco |
| gráficos | hachura, losango, barra em 10 peças | curva suave com área em degradê leve, ponto com pulso; barra em pílula contínua |
| vazio | painel 2×2 de azulejos | selo redondo cinza com um símbolo do sistema |
| trava | campo de azulejos + azulejo azul | tinta, a marca num círculo suave com halo; a tinta sobe ao destravar |

Pendentes do vocabulário novo, nas fases que já os previam: a tab bar do Android vira a pílula
flutuante escura com o círculo claro no ativo (vídeo); a face do cartão e a Carteira seguem o
cartão metálico de canto 18 dos vídeos; as telas de conta ganham a curva de tinta no topo (o
"SLATE" do vídeo) no lugar do canto de azulejos.

## Decisões tomadas com o dono do produto

| pergunta | resposta |
|---|---|
| até onde o visual muda | **identidade nova também** (cores e tipografia); a marca (espiral) não muda |
| tocar num cartão no Financeiro | **abre a tela Carteira** (voo + carrossel 3D); o leque sai |
| abertura | **completa nas 5 primeiras aberturas, curta depois** (como hoje) |
| escopo extra | entrada da Hoje e do Financeiro, transição por plataforma, skeleton, trava e onboarding — **todos** |
| mundo visual | **Concreto** (sorteio da skill impeccable, semente `9782cdf2`), sobre a alternativa Cédula e o padrão da categoria |
| arquitetura do voo | **camada de voo na raiz + rotas reais** (Seção 1 aprovada) |

## Contrato de direção

- **THESIS** — o que se manda solto vira estrutura: palavras e números se encaixam num grid, como
  na Poesia Concreta. Recusa o padrão da categoria (escuro azulado, vidro, brilho, Inter).
- **OWN-WORLD** — papel `#F2F3F1` e tinta `#0D0D0C`; um azul Bulcão (`#2A45F0` / `#4B63FF`) só no
  que está ativo; azulejos de quatro peças girados em passos de 90°; campos chapados com fio de
  1px; Jost geométrica em minúsculas grandes; Martian Mono só em dado.
- **STORY** — a pessoa abre o app e vê a cortina de azulejos se desfazer em onda e deixar o dia
  dela organizado; confia no número porque ele nunca aparece falso, nem por um quadro.
- **FIRST VIEWPORT** — abertura: campo de azulejos de tinta com a espiral em papel no centro; a
  onda diagonal recolhe os azulejos e, sem sessão, o que sobra vira o friso do login, com
  "entrar" em minúsculas gigantes e o botão azul no fim do formulário.
- **FORM** — Concreto (Poesia Concreta + azulejos de Athos Bulcão), 4ª da lista por ressonância,
  semente `9782cdf2`. Assinatura: onda de azulejos; cartão que sai da pilha e fica em pé.
- **FINISH** — unreviewed and undocumented is unfinished; this build ends with the finish review,
  the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Desafiantes recusados e o que cada um doou (elevações):

| desafiante | elevação incorporada |
|---|---|
| mapa de orientação | o azul marca só o que está ativo agora, nunca decoração |
| anuário de design | uma família carrega título e rótulo; mono só em número |
| parede de caixas | escolher em dois tempos: o cartão sai meio da pilha antes de voar |
| bancada de montagem | carrossel e troca de fatura assentam no passo, nunca entre dois |
| campo de dados (Ikeda) | um único momento de inversão total da tela: o login confirmado |
| borda iridescente | cor de conteúdo (emissor, pasta) só em borda fina ou dentro do cartão |

## Regra 0 — nenhuma feature sai de tela nem muda de lugar

É a trava do dono do produto e vale acima de qualquer desenho desta spec.

1. **O que é redesenho é a pele e o movimento.** Toda tela mantém as mesmas ações, os mesmos
   dados, os mesmos menus e a mesma ordem de blocos, salvo as exceções listadas abaixo — e
   nenhuma delas remove acesso a nada.
2. **Agrupar por nicho só SOMA atalho** para destino que já existe; nunca tira o caminho antigo.
3. **Cada fase fecha com o inventário da tela** (tabela abaixo) conferido no aparelho: tudo o que
   estava lá continua alcançável no mesmo lugar ou em lugar declarado aqui.

### Inventário das telas cuja estrutura muda

| tela | continua exatamente | muda (declarado) |
|---|---|---|
| **Financeiro — bloco Cartões** | cabeçalho "Cartões" + "Ver todos"; linha "Fatura do X" abaixo da pilha (abre a fatura); escolha do cartão da frente gravada; botão próprio da fatura **na face** ("fecha em ›") | tocar no **corpo** do cartão abre a Carteira em vez do leque; a alça ▾/▴ sai (a troca de cartão passa a ser na Carteira, a um toque) |
| **Carteira** (nova) | — | agrupa a área de cartão: ver fatura, faturas anteriores do cartão (`/finance/invoices?account=`), todos os cartões (`/finance/cards`) — todos destinos que já existem |
| **Fatura** | pager de faturas (setas), menu "…" (Ver todas as faturas, Marcar como paga sem mexer no saldo), status, nome do cartão, contagem de lançamentos, total, fecha · vence, "Inclui X com data à frente", "Paga em", "Pago X · falta Y", lista por dia com ações, rodapé com Marcar como paga / Jogar para a próxima / Registrar pagamento e as legendas, sheet de pagamento | o card de total vira a **face do cartão ancorada** carregando status, nome, contagem, total e fecha · vence; as três linhas extras ficam logo abaixo dela; deslizar a face também troca de fatura (as setas continuam) |
| **Cartões** (lista) | total a pagar, ordem por urgência, faixa de atraso, detalhes e "Paguei" de cada cartão, "Faturas anteriores", estado vazio, `+` no header | cada bloco ganha a miniatura do cartão no cabeçalho; tocar nela abre a Carteira |
| **Telas de conta** | todos os campos, "Criar conta", "Entrar com o WhatsApp", "Esqueci minha senha", "Entrar como teste (dev)" em `__DEV__`, reenvio e troca de número no WhatsApp, mensagens de erro | a marca de 44px vira o friso de azulejos; o título vira exibição em minúsculas |
| **Trava** | prompt automático, toque para tentar de novo, frase de estado, título "App bloqueado" | aurora e disco de vidro viram campo de azulejos + azulejo central com a espiral |
| **Onboarding** | os 4 passos e todo o conteúdo, voltar do Android, porta de mão única | cabeçalho com friso; progresso em 4 azulejos |
| **Raízes de aba** | marca, título, ação e avatar do `AppHeader`; badge da Hoje (iOS e Android); menus do herói; olho de esconder saldo; FAB | título do `AppHeader` passa a minúsculas (sem bloco novo); coreografia de primeira entrada |
| **Tab bar Android** | 5 abas na mesma ordem, rótulos, badge, re-tap volta à raiz, mola `tab` | berço recortado vira azulejo indicador |

## Arquitetura

### Unidades novas

| unidade | arquivo | o que faz | depende de |
|---|---|---|---|
| `tile-math` | `src/design/tile-math.ts` | pura: geometria da grade, peça e giro de cada azulejo pela semente, fase de cada azulejo na onda a partir de `(progresso, origem, direção)`; friso do login (quais azulejos sobram) | nada — `node --test` |
| `TileField` | `src/components/motion/tile-field.tsx` | um `Canvas` Skia com `Atlas`: textura das 4 peças criada uma vez (`useTexture`), `useRSXformBuffer` calculando giro + escala por azulejo a partir de UM `SharedValue<number>`; cor de frente (tinta) e verso (motivo azul/papel) | `tile-math`, Skia, Reanimated |
| `SessionProvider` + `useSession` | `src/hooks/use-session.tsx` | fonte única da sessão (hoje cada tela assina a sua); expõe a sessão **mostrada** | Supabase |
| `SessionCurtain` | `src/components/motion/session-curtain.tsx` | overlay da raiz: `cobrir(origem?) → Promise`, `revelar() → Promise`; é quem o portão chama | `TileField` |
| `session-gate` | `src/lib/session-gate.ts` | pura: decide passagem direta × cortina (troca de `user.id`), e o teto de 1,5 s | `node --test` |
| `FlightLayer` | `src/components/motion/flight-layer.tsx` | camada na raiz, acima das telas e abaixo da trava: `launch({ id, from, to, render, rotate })`; registro de alvos (`FlightTarget`) e de origens ocultas (`FlightSource`) | Reanimated (`measure`) |
| `flight-math` | `src/design/flight-math.ts` | pura: interpolação de retângulo + rotação em quarto de volta, com o ponto de pivô certo para o cartão deitado↔em pé | `node --test` |
| `PressableScale` | `src/components/motion/pressable-scale.tsx` | o press-in que hoje está copiado em `Button`, `CardFace`, `PressCard`: escala + háptico opcional | Reanimated |
| `Reveal` / `Stagger` | `src/components/motion/reveal.tsx` | entradas com teto de atraso; troca esqueleto → conteúdo em cross-fade; Reduce Motion vira opacidade | Reanimated |
| `SplitReveal` | `src/components/motion/split-reveal.tsx` | texto que sobe de uma máscara letra a letra — **sempre o valor final**, nunca intermediário | Reanimated |
| `useFirstEntrance` | `src/hooks/use-first-entrance.ts` | registro em memória: coreografia de raiz roda uma vez por sessão | — |
| `useCurtainOpen` | parte do `SessionCurtain` | sinal para a raiz só coreografar depois que a cortina saiu | — |
| `CardFace` | `src/components/finance/card-face.tsx` | a face do cartão, três poses (`stack`, `upright`, `dock`), usada também pelo clone do voo | `card-brands`, tokens |
| `CardStack` (reescrito) | `src/components/finance/card-stack.tsx` | pilha sempre fechada; toque em dois tempos; lança o voo | `CardFace`, `FlightLayer` |
| `WalletCarousel` | `src/components/finance/wallet-carousel.tsx` | `Animated.ScrollView` horizontal com encaixe; giro 3D e escala derivados do deslocamento | `carousel-math` |
| `carousel-math` | `src/design/carousel-math.ts` | pura: deslocamento → índice, giro Y, escala, opacidade | `node --test` |
| rota Carteira | `src/app/finance/wallet.tsx` | tela; modal transparente sem animação nativa; fechar por ✕, voltar do Android (`beforeRemove`) e arraste | acima |
| `InvoiceDock` | `src/components/finance/invoice-dock.tsx` | a face ancorada no topo da fatura + troca por deslize | `CardFace` |
| `TileTabBar` | `src/components/ui/tile-tab-bar.tsx` (substitui `curved-tab-bar.tsx`) | laje + azulejo indicador que desliza e gira 90° por aba atravessada | `tab-tile` |
| `tab-tile` | `src/design/tab-tile.ts` (substitui `tab-cradle.ts`) | pura: posição e giro do indicador | `node --test` |

### Ordem na raiz (`_layout.tsx`)

`GestureHandlerRootView > AppThemeProvider > QueryClient > … > SessionProvider > … >`
`<Stack/>`, `<FlightLayer/>`, `<LockOverlay/>`, `<SessionCurtain/>` (que também é a abertura),
`<AndroidActionSheet/>`, `<ToastHost/>`.

Camadas: voo 800 < trava 900 < cortina 1000. No Android a ordem sai de `elevation` **e**
`zIndex` (lição da trava: só `zIndex` deixa o app clicável por baixo).

### Portão de sessão

- `SessionProvider` guarda `real` (Supabase) e `mostrada`.
- Evento com o mesmo `user.id` (refresh de token, `USER_UPDATED`, metadados do onboarding):
  `mostrada = real` na hora.
- `user.id` diferente (entrar, sair, trocar de conta): `await cortina.cobrir(origem)` →
  `mostrada = real` → espera um quadro → `await cortina.revelar()`.
- `Promise.race` com 1,5 s: a troca acontece mesmo se a animação falhar. A cortina nunca prende.
- A `origem` é o centro do botão que disparou (registrado pelo `Button` com `curtainOrigin`); sem
  origem, a onda nasce de baixo (sair) ou do topo (entrar sem botão).
- `Stack.Protected`, `index.tsx` e as telas leem a sessão **mostrada**. A lógica de auth não muda.
- `accept_pending_invites` roda uma vez, no provider, em `SIGNED_IN` (hoje roda por instância).

### Voo do cartão

1. Origem mede (`measure` no worklet) o retângulo do cartão tocado.
2. `FlightLayer.launch` monta o clone (`CardFace` com as mesmas props) no retângulo de origem e
   oculta a origem (`FlightSource` com opacidade 0 enquanto o voo estiver ativo).
3. A navegação acontece; o destino registra o retângulo de pouso com `FlightTarget` (`onLayout` +
   `measureInWindow`), oculto até o pouso.
4. O clone anima até o alvo com a mola `voo`, girando ±90° quando a pose muda (deitado ↔ em pé),
   com sombra `floating` só durante o voo.
5. No pouso: o alvo aparece, o clone some no mesmo quadro (`runOnJS` depois de `onFinish`).
6. Alvo que não se registra em 600 ms (tela fora de vista, dado sumiu): o clone encolhe e
   esmaece no lugar. Toque durante o voo é ignorado.

Passagens:

| de → para | pose | navegação |
|---|---|---|
| pilha (Financeiro) → Carteira | deitado → em pé | `push('/finance/wallet?card=')`, modal transparente, `animation: 'none'` |
| miniatura (Cartões) → Carteira | deitado → em pé | idem |
| Carteira → pilha (fechar) | em pé → deitado | anima, depois `back()` |
| Carteira → Fatura | em pé → deitado (doca) | `push('/finance/invoice/[id]?via=carteira')`; as `options` do `Stack.Screen` na raiz, como função de `route`, usam `animation: 'fade'` quando `via` vem preenchido. **Verificar no início da Fase 4**; se o expo-router não repassar a função, a saída é uma rota irmã fina (`finance/invoice/dock/[id]`) que reexporta a tela com `animation: 'fade'` |
| Fatura → Carteira (voltar) | — | pop nativo (gesto de borda do iOS preservado); a Carteira já está com o cartão no lugar |

A Carteira aberta por link (sem origem registrada) entra com `Stagger`, sem voo.

## Tokens

### Cor (`src/constants/theme.ts`, mesmos nomes de papel)

| papel | claro | escuro |
|---|---|---|
| `background` / `groupedBackground` | `#F2F3F1` | `#0D0D0C` |
| `surface` | `#FFFFFF` | `#171716` |
| `backgroundElement` | `#E6E7E3` | `#1F1F1D` |
| `backgroundSelected` | `#DADBD6` | `#2A2A27` |
| `surfaceRaised` | `#FFFFFF` | `#2F2F2C` |
| `text` | `#0D0D0C` | `#F2F3F1` |
| `textSecondary` | `#5E5E58` | `#9A9A94` |
| `tint` (texto, ícone, progresso) | `#2A45F0` | `#7A8BFF` |
| `tintFill` (novo: campo azul) | `#2A45F0` | `#4B63FF` |
| `onTint` (sobre `tintFill`) | `#FFFFFF` | `#FFFFFF` |
| `accentSoft` | `#E3E7FD` | `#1A1F3D` |
| `danger` / `success` / `warning` | `#B3261E` / `#1A7F4B` / `#8A5300` | `#FF8A7F` / `#5FD08F` / `#F2B356` |
| `separator` / `cardBorder` | `rgba(13,13,12,0.16)` / `rgba(13,13,12,0.12)` | `rgba(242,243,241,0.16)` / `rgba(242,243,241,0.10)` |
| `heroSurface` (herói = negativo da página) | `#0D0D0C` | `#F2F3F1` |
| `onHero` / `onHeroMuted` | `#F2F3F1` / `rgba(242,243,241,0.64)` | `#0D0D0C` / `rgba(13,13,12,0.62)` |
| `onHeroSuccess` / `onHeroDanger` / `onHeroWarning` | `#5FD08F` / `#FF8A7F` / `#F2B356` | `#1A7F4B` / `#B3261E` / `#8A5300` |
| `heroChip` / `heroSeparator` | `rgba(242,243,241,0.14)` / `rgba(242,243,241,0.16)` | `rgba(13,13,12,0.08)` / `rgba(13,13,12,0.14)` |
| `heroFooter` / `heroFooterPress` | `rgba(242,243,241,0.06)` / `rgba(242,243,241,0.12)` | `rgba(13,13,12,0.05)` / `rgba(13,13,12,0.10)` |
| `cardFace` (novo, face do cartão) | `#141413` | `#141413` |
| `tileInk` / `tileMotif` (novos, cortina) | `#0D0D0C` / `#2A45F0` | `#0D0D0C` / `#4B63FF` |

`heroTop`, `heroBottom`, `aurora*` saem junto com os componentes que os usam. Contraste medido:
texto 17,5:1; secundário 5,9 / 6,9; `tint` 5,9 / 6,0 sobre card; branco sobre `tintFill`
6,6 / 4,6; semânticas ≥ 4,5 sobre o próprio fundo e sobre o herói invertido. `NoteColors` e
`card-brands` ficam.

Splash nativo (`app.json` → `expo-splash-screen`): `#0D0D0C` com `mark-white.png` **nos dois
temas** (mudança nativa: exige build novo). Ícone adaptativo do Android fica como está.

### Tipografia

`@expo-google-fonts/jost` (400, 500, 600, 700) e `@expo-google-fonts/martian-mono` (400, 500, 600)
entram; Hanken Grotesk e JetBrains Mono saem ao fim da Fase 1. Jost tem `tnum`; as monos são de
largura fixa por natureza. Fontes carregam por `useFonts` (asset JS, entram por OTA).

| variante | face | tamanho / altura / tracking |
|---|---|---|
| `display` (nova) | Jost 600 | 52 / 50 / −2,0 — minúsculas |
| `largeTitle` | Jost 600 | 34 / 38 / −1,0 |
| `title` | Jost 600 | 26 / 30 / −0,6 |
| `title2` | Jost 600 | 20 / 24 / −0,3 |
| `headline` | Jost 600 | 17 / 22 / −0,1 |
| `body` | Jost 400 | 17 / 24 / 0 |
| `callout`, `subhead` | Jost 400 | 15 / 20 / 0 |
| `footnote` | Jost 400 | 13 / 18 / 0 |
| `caption` | Jost 500 | 12 / 15 / 0,2 |
| `meta` | Jost 600 | 11 / 14 / 1,6 — caixa alta |
| `heroMoney` | Jost 600 | 48 / 50 / −1,6 — `tnum` |
| `money` | Jost 600 | 32 / 36 / −0,8 — `tnum` |
| `code` | Martian Mono 500 | 12 / 16 / −0,2 |
| `ticker` | Martian Mono 500 | 13 / 18 / −0,3 |

Exibição em minúsculas: título do `AppHeader`, telas de conta, Carteira, onboarding. Header
nativo, corpo e rótulos continuam em caixa normal. Peso é família, nunca `fontWeight`. As faces
itálicas usadas pela nota passam a Jost Italic (a família tem).

### Forma, elevação, movimento

- `Radius`: `xs 2`, `sm 4`, `md 6`, `lg 8`, `xl 12`, `pill 999` (só chip e avatar). Botão é
  retângulo de `sm`. `borderCurve: 'continuous'` continua.
- `Elevation`: `none` em card; `floating`/`overlay` só em sheet, menu, toast e voo.
- `Motion.spring`: `encaixe` (`dampingRatio 0.86`, 420 ms), `voo` (0.9, 620 ms), `tab` (a atual,
  mantida), `sheet`, `settle`, `snap` (mantidas). `Motion.curtain`: 900 ms de onda, 60% de
  sobreposição entre azulejos. `pressScale` 0,96. `stagger` 30 ms com teto 400 ms (mantido).

### O que sai

`GradientSurface` (herói, cartão, onboarding, perfil), `GlassCard` no conteúdo, `Aurora`,
`Keyhole`, `CurvedTabBar`, `tab-cradle.ts`. O vidro do sistema (tab bar e header nativos do iOS)
fica.

## Fluxos

### Abertura

- Overlay = `SessionCurtain` fechado desde o primeiro quadro (mesmo par do splash nativo).
  `hideAsync()` só no primeiro `onLayout` e `setOptions({ fade: false })`, como hoje.
- Completa (5 primeiras aberturas, contador atual): a espiral se desenha em traço (`Path` com
  `end` 0 → 1) e se preenche; azulejos assentam em volta; ~1,8 s.
- Espera `fontes && sessão` (teto 2,5 s); então `revelar()`: sem sessão, a onda para no **friso**
  (o `AuthScreen` desenha o mesmo friso, mesma semente, mesma posição); com sessão, limpa tudo e
  emite `cortina aberta`.

### Entrar / sair / onboarding

- `Button` com `loading` encolhe até um quadrado (largura → altura, só `transform` via
  `scaleX` no fundo + cross-fade do rótulo) com um azulejo girando 90° por passo (`encaixe`).
- Sucesso: o portão cobre a partir do centro do botão, troca, revela na Hoje/onboarding.
- Erro: o quadrado volta a botão, `Field` treme (3 ciclos, 6 pt) e vibra.
- Sair: `cobrir()` de baixo, troca, `revelar()` até o friso.
- Concluir onboarding: `cortina.cobrir()` → grava a flag → `revelar()`.

### Telas de conta

`AuthScreen` ganha `stage` (friso) e `title` (exibição). Entrada: `SplitReveal` no título, depois
`Stagger` nos campos, botão e links. Rotas de conta com `animation: 'fade'`; parado, o friso gira
3–4 azulejos. Passo interno desliza no eixo horizontal. `Field`: borda de 2px animada no foco
(cor, sem mudar layout: a borda existe sempre, muda só de cor), rótulo acompanha. `OtpInput`:
cada dígito entra como azulejo. Mantém `KeyboardAwareScrollView` e rodapé dentro do scroll.

### Trava

Campo fechado + azulejo azul central com a espiral: autenticando gira, falhou treme, destravou a
onda sai radialmente do centro. Mantém `accessibilityViewIsModal`, `elevation 900`, prompt
automático com a guarda no hook, frases de estado, `flexShrink: 0` no título.

### Carteira

- Topo: `TaskHeader` (✕ à esquerda); nome do cartão em exibição, com cross-fade e parallax
  horizontal na troca; linha de estado ("fatura aberta · fecha 03/10", atraso em `danger`).
- Carrossel: cartão em pé com largura de 62% da tela; vizinhos em escala 0,86, giro Y ±28°,
  perspectiva 900, opacidade 0,6; encaixe por passo; háptico de seleção na troca de índice.
- Indicador: quadrados de 6pt; o ativo vira barra de 20pt em `tintFill`.
- Números do ativo: "fatura atual" (`CountUpMoney` entre cartões), fecha e vence em mono,
  barra de limite em `tint` (`danger` a partir de 90%), disponível, atraso quando houver.
- Ações no fim do conteúdo (`flexGrow` + `marginTop: 'auto'`): "ver fatura" (principal; sem
  fatura aberta, "ver cartões"), "faturas anteriores", "todos os cartões".
- Fechar: ✕, voltar do Android (`beforeRemove` → anima → `dispatch`), arraste para baixo no
  carrossel (`Gesture.Pan` com `activeOffsetY` e `failOffsetX`, para não roubar o deslize
  horizontal): segue o dedo, encolhe, fundo esmaece; solta além de 120 pt ou com velocidade →
  voo de volta; senão, mola de volta.
- Trocar de cartão grava a escolha (cache de módulo + AsyncStorage, como hoje); ao voltar, a
  pilha se reordena com `encaixe`.

#### Como ficou (fase 4, 16/09/2026) — vale acima do texto acima

- **A Carteira é `push` com `animation: 'fade'`**, não `transparentModal`: no iOS o modal é
  apresentado acima da raiz React e esconderia a camada de voo, e todo `push` depois de um modal
  vira modal no `react-native-screens` (a fatura perderia o header). Fechar não esmaece o fundo
  (atrás de um `push` o iOS não desenha a tela de baixo); esmaece o conteúdo.
- **Em pé = a face deitada girada 90°**; a face é desenhada em 340 e escalada, proporção
  1,586 ÷ √fontScale. Sem chip EMV; metal na cor do emissor, tinta por contraste.
- **Quem navega espera a decolagem** (`voar` resolve com a origem já escondida): no iOS a tela
  que sai é congelada no começo da transição.
- **O voo segue o pouso** enquanto voa: a fatura muda de lugar depois de medida (o seletor de
  meses chega depois, e o header nativo ajusta a rolagem).
- **Giro do carrossel no meio da troca** (seno, pico 50°); vizinhos em repouso planos.
- **Arraste para fechar** com ativação manual (só no topo da página, dedo descendo), página no
  `ScrollView` do gesture-handler, volta no `onFinalize`.
- **Menos texto** (pedido do dono do produto no meio da fase): estado numa palavra sob o nome,
  "R$ X livre de R$ Y" numa linha, rodapé da fatura sem legendas nem parágrafo, e a linha
  "Fatura do X" embaixo da pilha saiu — repetia nome, fechamento e total da face, cujo botão
  "fecha ›" abre a mesma fatura.
- **Ações aninhadas viram ações de acessibilidade** do card (o leitor de tela não alcança botão
  dentro de botão).
- Medido no emulador: carrossel com 25% de quadros lentos contra 48% da rolagem comum do
  Financeiro — o limite é o emulador em build de desenvolvimento. As flags estáticas do
  Reanimated ficam como estão até uma medida em release.

### Fatura

`InvoiceDock` no lugar do card de total, com as mesmas informações (ver inventário). Deslizar a
face troca de fatura (`Gesture.Pan` horizontal que chama o mesmo `router.setParams` das setas);
a face gira no eixo Y na troca e o total conta. Entrada sem voo: `Reveal`.

### Raízes

Primeira entrada por sessão, depois de `cortina aberta`: título do `AppHeader` com `SplitReveal`;
herói desenrola (recorte vertical animado); número do herói com `SplitReveal` já no valor final;
seções em `Stagger` (teto 400 ms). Reentrada: nada anima. Mudança de valor: `CountUpMoney`.

### Transições por plataforma

| | iOS | Android |
|---|---|---|
| detalhe | push nativo | `animation: 'default'` (eixo compartilhado Material no Android 13+) |
| formulário modal | sheet nativo | `slide_from_bottom` |
| conta | `fade` | `fade` |
| Carteira | coreografia própria | coreografia própria |
| tab bar | `NativeTabs` (vidro do sistema), `tintColor` = `tint` | `TileTabBar` |

Diferenças moram em `.ios.tsx` / `.android.tsx` ou `Platform.select` dentro de primitivo, nunca
na tela.

### Carregamento

`Skeleton`: faixa de varredura chapada (retângulo mais claro, borda dura, inclinação de 12°)
movida por **um** relógio de módulo compartilhado por todos os esqueletos; `Reveal` faz o
cross-fade de 180 ms para o conteúdo.

## Primitivos redesenhados

`Button`, `Card`, `Row`, `Field`, `SelectField`, `HeroPanel`, `Segmented`, `Chip`, `Sheet`,
`Toast`, `EmptyState`, FAB, `ProgressBar`, `Calendar`, `AppHeader`, `SectionHead`, `Money`,
`Mark` (forma igual; ganha o modo "desenhar"). As telas herdam; tela só é editada quando ela
monta à mão algo que o primitivo já cobre (e isso é anotado).

## Reduce Motion

Cortina e onda → cross-fade de 200 ms. Voo, giro 3D e parallax → cross-fade; o carrossel desliza
sem girar. `SplitReveal` e `Stagger` → opacidade. Botão → troca de rótulo por azulejo, sem
encolher. Feedback de estado (cor, tremor de erro reduzido a um ciclo) continua.

## Erros e bordas

- Cortina com teto de 1,5 s (sessão) e 2,5 s (abertura).
- Voo sem alvo em 600 ms → esmaece no lugar.
- Dado da Carteira que falha: `ErrorCard` com "Tentar de novo" no lugar do carrossel; ✕ continua.
- Carteira sem cartões (link direto): `EmptyState` com "Cadastrar cartão" (destino atual).
- Fonte do sistema a 1,3: a face do cartão continua escalando pela mesma conta de hoje; o título
  de exibição quebra linha, nunca trunca.
- `flexShrink: 0` em todo texto dentro de contêiner com `entering` (lição da trava).

## Testes

- `node --test`: `tile-math`, `flight-math`, `carousel-math`, `session-gate`, `tab-tile`.
- `anti-slop.test.ts`: hex/`fontSize` soltos (como hoje), nenhum `GradientSurface`/`GlassCard` em
  conteúdo, nenhum nome de fonte antiga, `Segmented` ≤ 4, `useSession` só pelo provider.
- `simple-finance-ui.test.ts`: fatura renderiza status, contagem, total, fecha · vence e as
  linhas extras dentro/abaixo da doca; pilha abre a Carteira pelo corpo e a fatura pelo botão.
- Portão: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída).
- Aparelho: simulador iPhone 17 Pro e emulador Android — claro e escuro, 384dp × fonte 1,3,
  Reduce Motion / `animator_duration_scale 0`; vídeo de abertura, login, logout, trava, Carteira
  ida e volta, Carteira → fatura, conferido quadro a quadro; `dumpsys gfxinfo` na Carteira e na
  cortina; inventário da Regra 0 conferido tela a tela. Usuário de teste do staging.

## Fases

Cada fase: implementar → testes → aparelho (iOS e Android) → commit. Sem tag, sem produção.

1. **Fundação** — fontes, tokens, `tile-math` + `TileField`, `PressableScale`, `Reveal`,
   `SplitReveal`, primitivos redesenhados, remoção de `GradientSurface`/`GlassCard` do conteúdo,
   `anti-slop` atualizado.
2. **Abertura, sessão e trava** — splash nativo, `SessionProvider`, `SessionCurtain`, portão,
   trava.
3. **Conta e onboarding.**
4. **Carteira** — `FlightLayer`, `CardFace`, `CardStack`, rota, `WalletCarousel`, `InvoiceDock`,
   miniaturas na lista.
5. **Raízes, transições e tab bar do Android.**
6. **Fechamento** — verificação cruzada, revisão final da skill impeccable, `DESIGN.md`,
   `.claude/rules/design.md` reescrito para o Concreto (mantendo as lições de engenharia),
   tabela de stack do `CLAUDE.md`.

## Riscos

- Splash nativo muda: exige build novo; OTA não leva essa parte. Fontes e o resto vão por JS.
- Identidade nova atinge todas as telas: a verificação cobre as cinco raízes e as telas de
  detalhe mais usadas (Lançamentos, Lançamento, Fatura, Cartões, Contas, Ciclo, Projeção,
  formulário de lançamento).
- `transparentModal` + `beforeRemove` no Android: verificar voltar por gesto e por botão.
- Skia `Atlas` com ~200 azulejos: medir quadros no emulador antes de fechar a Fase 1.

## Fora de escopo

Lógica de negócio, dados, agente, backend, migrations, cor de nota, cor de emissor, a marca, o
ícone do app, o conteúdo das telas.
