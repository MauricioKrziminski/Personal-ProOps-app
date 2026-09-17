---
name: Personal ProOps app
description: Notas, lembretes e finanças pessoais operados por conversa — o lugar calmo onde tudo aparece organizado.
colors:
  ink: "#0B0B0C"
  warm-paper: "#F2F1EE"
  white-surface: "#FFFFFF"
  paper-step: "#E8E7E3"
  paper-step-selected: "#DDDCD7"
  graphite: "#6B6B70"
  ink-hero: "#0B0B0C"
  ink-hero-dark: "#1C1C1E"
  night-paper: "#0B0B0C"
  night-surface: "#161618"
  night-step: "#1C1C1E"
  bone: "#F4F4F2"
  night-graphite: "#9B9BA0"
  brick: "#C0362C"
  ledger-green: "#157A45"
  amber-note: "#8A5300"
typography:
  display:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: "46px"
    letterSpacing: "-1.2px"
  headline:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: "38px"
    letterSpacing: "-0.9px"
  title:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "31px"
    letterSpacing: "-0.6px"
  money-hero:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: "51px"
    letterSpacing: "-1.4px"
    fontFeature: "tnum"
  body:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "23px"
    letterSpacing: "-0.1px"
  label:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
rounded:
  xs: "6px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gutter: "20px"
  xl: "24px"
  xxl: "32px"
  xxxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white-surface}"
    rounded: "{rounded.pill}"
    height: "50px"
    padding: "0 24px"
  button-secondary:
    backgroundColor: "{colors.paper-step}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "50px"
  card:
    backgroundColor: "{colors.white-surface}"
    rounded: "{rounded.md}"
    padding: "16px"
  hero-panel:
    backgroundColor: "{colors.ink-hero}"
    textColor: "{colors.bone}"
    rounded: "{rounded.lg}"
    padding: "20px"
  text-field:
    backgroundColor: "{colors.white-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "50px"
  segmented:
    backgroundColor: "{colors.paper-step}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
  tab-bar-android:
    backgroundColor: "{colors.ink-hero}"
    textColor: "{colors.bone}"
    rounded: "{rounded.pill}"
    height: "68px"
---

# Design System: Personal ProOps app

## Overview

**Creative North Star: "Papel e Tinta"**

O app é uma folha de papel morno onde a tinta só aparece para o que importa: o número que responde
a pergunta da tela, a ação que resolve, o estado que pede atenção. Tudo o mais recua para superfícies
brancas e cinzas quentes, com cantos generosos e muito ar. A referência são os dois vídeos do dono do
produto — um login com a tinta descendo em curva, um cartão metálico que voa e fica em pé num
carrossel —, e daí vem a regra de movimento: ele existe para costurar uma tela na outra, nunca para
enfeitar um dado que a pessoa está lendo.

A densidade é de app de conferir: vários números por tela, cada um com rótulo curto acima e nada de
parágrafo explicativo. A explicação de uma ação mora na confirmação dela. A cor não é da marca (a
marca é monocromática); ela é semântica — verde para dinheiro que entra, tijolo para atraso e erro,
âmbar para atenção — e a cor do banco aparece só dentro da forma de um cartão de crédito.

**Key Characteristics:**
- Papel morno (`warm-paper`) e superfície branca no claro; tinta quase-preta no escuro.
- Ação primária é uma pílula de tinta; secundária, uma pílula no cinza do papel.
- Um bloco de destaque por tela, em tinta nos dois temas.
- Plus Jakarta Sans em pesos leves; números tabulares.
- Cantos de 12 a 28 e pílulas; nada de quina viva.
- Texto mínimo: rótulo curto, valor, e só a frase que muda uma decisão.

## Colors

Monocromático com três semânticas: a tinta faz o papel do accent.

### Primary
- **Tinta** (`ink`): ação primária (pílula preenchida), estado ativo, barra de progresso de estado, o
  texto principal. No tema escuro a tinta vira **Osso** (`bone`) e o rótulo por cima inverte.

### Neutral
- **Papel Morno** (`warm-paper`): o fundo de toda tela no claro.
- **Superfície Branca** (`white-surface`): cards, campos, linhas agrupadas.
- **Degrau do Papel** (`paper-step`, `paper-step-selected`): trilhos, botão secundário, chips de ícone, pressionado.
- **Grafite** (`graphite`): texto secundário, rótulos, ícones inativos.
- **Bloco de Tinta** (`ink-hero`, `ink-hero-dark` no escuro): o herói de cada raiz, a barra de abas do Android, a cortina da abertura.
- **Papel Noturno** (`night-paper`), **Superfície Noturna** (`night-surface`), **Degrau Noturno** (`night-step`), **Grafite Noturno** (`night-graphite`): os mesmos papéis no tema escuro.

### Conversation
- **Balão** (`bubble`, `onBubble`): a fala da pessoa. Tinta com o texto invertido — a mesma
  superfície da ação primária, porque nas duas quem fala é quem manda.
- **Trilho** (`rail`): o fio de 1px que liga uma fala ao registro que ela virou, e os dias da
  agenda entre si. Nunca contorna nem sublinha: só LIGA.

### Chart
- **Faixa do gráfico** (`chart1`…`chart6`): seis degraus de tinta para a rosca e as barras, do
  mais escuro ao mais claro. Não são seis cores — são seis intensidades da mesma, e é por isso
  que a rosca continua legível em preto e branco.
- **Luz do herói** (`heroGlow`, `heroGlowClear`): o clarão que atravessa o bloco de tinta e anda
  com a rolagem. Só no herói, só com o degradê terminando em transparente.

### Semantic
- **Tijolo** (`brick`): atraso, erro, destrutivo.
- **Verde de Livro-Caixa** (`ledger-green`): dinheiro que entra, confirmado.
- **Âmbar de Nota** (`amber-note`): atenção (orçamento perto do limite).

### Named Rules
**The Ink Is The Accent Rule.** Nenhuma cor decora. Ação é tinta; cor é só semântica.

**The Issuer Inside The Card Rule.** A cor de um banco só existe dentro da forma de um cartão de
crédito (face, miniatura, carrossel). Numa linha de lista ela volta a ser proibida.

## Typography

**Display Font:** Plus Jakarta Sans
**Body Font:** Plus Jakarta Sans
**Label/Mono Font:** Plus Jakarta Sans (Martian Mono só no código inline das notas)

**Character:** uma geométrica humanista em pesos leves — título em 600, número grande em 500, corpo em
400 —, com tracking negativo nos tamanhos grandes. Numerais tabulares carregam dinheiro sem mono.

### Hierarchy
- **Display** (600, 36/46): o nome do cartão na Carteira, telas de conta e onboarding. Uma por tela.
- **Headline** (600, 30/38): título grande de tela.
- **Title** (600, 24/31): título de card e de seção importante.
- **Money Hero** (500, 40/51, tabular): o número do herói.
- **Body** (400, 16/23): texto corrido e linhas.
- **Label** (500, 12/16, caixa normal): rótulos de seção, metadados, contadores.

### Named Rules
**The Label Before Value Rule.** O rótulo curto vem antes do número, nunca uma frase depois dele.

**The Weight Is Family Rule.** Peso é a face (`PlusJakartaSans_600SemiBold`), nunca `fontWeight` — o
Android ignora e sintetiza negrito.

## Layout

Coluna única com calha de 16dp; 24dp entre blocos, 8dp dentro de um bloco, 12dp entre linhas
irmãs. O ritmo mora no `Screen`, não na tela. A régua de largura é 384dp com fonte do sistema a
1,3×: nada trunca — a linha quebra e a célula cresce. Ações de uma lista ficam no fim do conteúdo,
nunca ancoradas sobre ele; nas raízes, a barra de abas flutua e o conteúdo passa por baixo dela.

### Named Rules
**The Nothing Truncates Rule.** Identificador (nome, título, valor) nunca termina em reticências.

## Elevation & Depth

Profundidade vem de amplitude, não de sombra: papel, superfície branca e o bloco de tinta são três
degraus bem separados. Cards levam um fio de 1px e uma sombra quase imperceptível; sombra de
verdade só no que flutua (FAB, barra de abas, toast, o cartão em voo).

### Shadow Vocabulary
- **Raised** (`0 1px 2px rgba(0,0,0,0.06)`): cards em repouso.
- **Floating** (`0 4px 12px rgba(0,0,0,0.10)`): FAB, barra de abas.
- **Overlay** (`0 12px 32px rgba(0,0,0,0.16)`): sheet, menu, o cartão durante o voo.

### Named Rules
**The Glass Is Chrome Rule.** Vidro só na chrome do sistema (a barra de abas do iOS, a faixa do
cabeçalho). Conteúdo é sempre opaco.

## Shapes

Cantos contínuos (squircle) em tudo: 12 em campos e linhas, 18 em cards e no cartão de crédito, 24
no herói, 28 em sheets. Botões, chips, segmentados, avatares e a barra de abas são pílulas ou
círculos. A borda de tinta das telas de conta e da cortina é uma curva — começa baixa à esquerda,
faz uma barriga e sobe para a direita.

## Components

### Buttons
- **Shape:** pílula (999), altura 36 / 50 / 54.
- **Primary:** tinta com rótulo invertido; ao carregar, a pílula encolhe até uma cápsula e dois pontos trocam de lugar.
- **Press:** escala 0,97 com háptico leve.
- **Secondary / Ghost / Destructive:** degrau do papel; texto puro; tijolo.

### Chips
- **Style:** pílula no degrau do papel; filtro de lista, nunca campo gravado.

### Cards / Containers
- **Corner Style:** 18.
- **Background:** superfície branca (noturna no escuro), fio de 1px.
- **Shadow Strategy:** Raised.
- **Internal Padding:** 16.

### Inputs / Fields
- **Style:** caixa branca de canto 12 com fio claro; rótulo acima, em 13/500.
- **Focus:** um anel de tinta de 1,5px acende em volta.
- **Error:** o anel vira tijolo e a caixa treme uma vez.

### Navigation
- **iOS:** a barra de abas do sistema em Liquid Glass, seleção em tinta.
- **Android:** pílula de tinta flutuante com um círculo claro que desliza até o ícone ativo (o ícone
  escuro é recortado dentro do círculo); rótulos nas cinco abas; sobe na primeira entrada.
- **Raízes:** faixa com a marca, o título e ações em círculos de 36.

### Block Header
O cabeçalho de todo bloco de raiz: título, uma contagem num selo redondo quando ela informa, e
uma ação de texto à direita. `voice="app"` troca o selo pela marca — é assim que se distingue o
que o produto está dizendo do que a pessoa disse.

### Tile
O ladrilho do mosaico: selo do ícone, rótulo, valor, legenda e um slot de minigráfico no canto.
Três formas — `fill` (divide a fileira), `half` e `wide` (a grade). `compact` é o contador de duas
linhas. O conteúdo alinha pelo TOPO: dois ladrilhos da mesma altura com conteúdos de tamanhos
diferentes precisam pôr os dois números na mesma linha de base.

### Data Views
- **Anel** (`RingGauge`): proporção de UM valor contra um limite. Skia, cor resolvida FORA do
  canvas.
- **Curva com dedo** (`ScrubChart`): a série do caixa, arrastável; o valor do dia segue o dedo.
- **Rosca** (`DonutChart`): a repartição, nos seis degraus de tinta.
- **Pista** (`RunwayBar`): a escada de queima de hoje até a próxima entrada — a altura é o que
  sobra livre e ela desce a cada saída. Arrastar dá o dia e um háptico por degrau.
- **Linha do livro-caixa** (`LedgerRow`): selo, título, legenda, a citação do que a pessoa disse,
  valor e data. A citação vai entre aspas e sem trilho: as aspas já a marcam.

### Conversation (signature)
A Hoje é uma conversa organizada, em duas vozes. O que o app diz vem em bloco, com a marca no
cabeçalho. O que a PESSOA disse vem num balão de tinta com o texto real da mensagem, e o registro
que aquela fala virou fica encaixado logo abaixo, ligado por um fio de 1px. A chegada de uma fala
nova toca o encaixe — e só ela: o que já estava na tela quando ela montou não se mexe.

### Credit Card (signature)
A face é a cor do banco com um degradê curto e uma faixa de brilho, canto 18, contactless, nome e
estado. Desenhada em 340dp e escalada; "em pé" é a mesma face girada 90°. A pilha do Financeiro voa
para a Carteira (carrossel 3D guiado pelo dedo) e a fatura ancora o cartão no topo.

### Session Curtain (signature)
A abertura e toda troca de conta passam por uma cortina de tinta com borda curva: a marca do
splash com um anel que se desenha, depois a tinta sobe. Entrar a partir de um botão cobre com um
círculo que nasce dele. As raízes entram em cascata junto com a tinta saindo.

## Do's and Don'ts

### Do:
- **Do** usar a pílula de tinta para a única ação primária da tela.
- **Do** manter um bloco de destaque por tela, em `ink-hero`.
- **Do** escrever rótulo curto + valor; a explicação vai na confirmação da ação.
- **Do** usar `tabular-nums` em todo número que conta, mede ou custa.
- **Do** verificar em 384dp com fonte 1,3 e nos dois temas.
- **Do** resolver cor FORA do `Canvas` do Skia e passá-la por prop — lá dentro não há contexto do
  React, e `useTheme()` devolve a paleta errada sem erro nenhum.

### Don't:
- **Don't** colocar legenda embaixo de botão nem parágrafo explicativo em tela de conferir.
- **Don't** usar cor como decoração — nem a do banco fora do cartão, nem roxo como accent.
- **Don't** usar vidro, degradê ou brilho em conteúdo.
- **Don't** truncar identificador; quebre a linha.
- **Don't** mover dado que a pessoa está lendo por estética.
- **Don't** pôr etiqueta acima de um título: ela gasta a primeira linha dizendo o que ninguém veio
  ler. A data vem DEPOIS da saudação.
- **Don't** marcar o mesmo fato duas vezes — aspas e trilho colorido na mesma citação é uma marca
  a mais.
