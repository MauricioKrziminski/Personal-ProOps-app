# Documentos de tela

Um documento por tela, escritos **antes** do código. Nenhuma tela é implementada sem o seu.

## Para que servem

Cada documento responde, em ordem: qual pergunta a tela resolve, para quem, o que aparece e
**por que naquela posição**, de onde vêm os dados, o que anima e por quê, e o que fica de fora.

A ordem dos blocos de uma tela é decisão de produto, não de layout — por isso a seção
**Anatomia** justifica cada posição, e a seção **Fora de escopo** existe para que a próxima pessoa
não reabra uma discussão já fechada.

Regra de leitura: se o documento e o código discordam, **o documento está desatualizado ou o
código está errado** — os dois não podem ficar como estão.

## Como usar

- **Implementando uma tela:** leia o documento inteiro antes de abrir o editor. Ele nomeia o hook,
  o queryKey e a RPC. Hook marcado `**(novo)**` ainda não existe — é trabalho a fazer.
- **Revisando:** o agente `ui-polisher` audita a tela contra `.claude/rules/design.md` **e** contra
  o documento dela.
- **Mudando de ideia:** edite o documento no mesmo commit que muda a tela.

## A seção **Visual** (obrigatória, hoje ausente em todos os 35 documentos)

Os documentos nasceram fortes em **anatomia** — o que aparece, em que ordem, por quê; estados;
navegação; movimento — e **mudos em aparência**. "Card de destaque em glass" e "`Row` com
trailing" são estrutura, não aparência: nenhum documento diz peso tipográfico por bloco,
densidade, contraste ou hierarquia de cor. As telas herdaram exatamente esse buraco e saíram
corretas e sem graça.

Toda tela ganha uma seção **Visual** com estes quatro campos — e só estes, porque a linguagem
global continua morando em `.claude/rules/design.md`:

| Campo | O que responde | O que NÃO é |
|---|---|---|
| **Hierarquia por bloco** | Quem é protagonista, quem é secundário, quem é ruído tolerado. Um protagonista por tela. | Não é a ordem dos blocos — isso já está em Anatomia. |
| **Peso tipográfico** | Que variante de `Type` cada bloco usa e por quê o protagonista pesa mais que o vizinho. | Não é `fontSize` solto: só nomes da escala. |
| **Densidade** | Respiro entre seções e dentro da linha; quantos itens cabem antes de rolar. | Não é padding literal em tela: é qual degrau de `Space`. |
| **Tratamento de superfície** | Opaco, agrupado ou glass; onde mora o contraste; o que carrega elevação. | Não é cor nova: um accent, uma família de cinza. |

### Os valores globais (decididos em 28/08, validados nos dois simuladores)

A causa mecânica do "telas muito simples" não era falta de enfeite: era **duas escalas
tipográficas concorrentes**. O `ThemedText` trazia a sua (14/16/32/48, tudo em peso 500), paralela
à `Type` de `src/design/tokens.ts`. Título 16/500 contra subtítulo 14/500 é um passo — nada
dominava, tudo lia como o mesmo cinza. Hoje `ThemedText` inteiro aponta para `Type`: **uma escala
só**, e a hierarquia se faz com peso e cor.

| Papel | Token | Por quê |
|---|---|---|
| Número herói | `money` 40/700 `Fonts.rounded` | Protagonista absoluto da tela. |
| Rótulo do herói | `caption` 12, caixa alta, `letterSpacing 0.6`, `textSecondary` | Contraste de escala de 3,3× contra o número. Rótulo grande rouba do valor. |
| Rótulo de seção | `caption` 12, caixa alta, `letterSpacing 0.6`, `textSecondary` | É etiqueta, não título: some do caminho. |
| Título de linha | `default` (body 17/400) | Régua da plataforma. |
| Secundário da linha | `footnote` 13 + `textSecondary` | **O degrau que faltava.** Em 15/500 empatava com o título. |
| Dinheiro na linha | `headline` 17/600 + `tabular` | Num app de dinheiro o valor ganha a linha — por peso, não por cor. |
| Ação | `smallBold` 15/600 | Botão primário leva o accent; secundário nunca disputa. |

**Densidade** (tiers de ritmo vertical 16/24/32/48): dentro da linha `Space.md`; rótulo colado no
seu cartão (`Space.xs + 2`); entre seções `Space.xl`; respiro do card de destaque `Space.lg`.

**Superfície:** todo agrupamento (`Section`, `Card`, linha de nota) leva `Elevation.raised`.
Branco sobre `groupedBackground` são ~3% de diferença de valor — sem a sombra o agrupamento não
existe no tema claro. O `GlassCard` leva hairline **e** elevação: vidro sobre cor chapada não tem
o que refratar.

> **O que continua em aberto:** estes valores vieram das regras de app nativo (`ui-ux-pro-max`,
> `references/pro-rules.md`) + a régua iOS, **não** de estudo de telas reais de apps rankeados — o
> MCP do Appllama segue desconectado. Eles consertam a hierarquia, que era o defeito mecânico.
> Direção estética (paleta própria, personalidade de marca) ainda pede referência real.

A linguagem de design (tokens, glass, movimento, estados, anti-slop) mora em
`.claude/rules/design.md`, não aqui. Os documentos assumem essa regra e não a repetem.

**Comece por aqui:** [HANDOFF-ACABAMENTO.md](HANDOFF-ACABAMENTO.md) — o que está aberto no
acabamento visual, com ambiente, armadilhas e critério de pronto. É o documento de passagem entre
sessões.

**Histórico e migrations:** [PROXIMO-PASSO.md](PROXIMO-PASSO.md) — a reconciliação das migrations
(ainda esperando o usuário) e o registro do que já foi corrigido.

**Decisões ainda abertas:** [DECISOES-PENDENTES.md](DECISOES-PENDENTES.md) — o que os documentos
assumiram e ainda precisa de decisão humana, mais os bugs confirmados no código durante a escrita.

> Nota de notação: as tabelas de Movimento escrevem `Motion.fast` / `Motion.base` como abreviação.
> A API real é `Motion.duration.fast` (`src/design/tokens.ts`).

## Índice

### Abas

| Tela | Pergunta que responde |
|---|---|
| [hoje](hoje.md) | O que eu preciso saber agora? |
| [notas](notas.md) | Onde está aquilo que eu anotei? |
| [financeiro](financeiro.md) | Como está o meu mês? |
| [gerenciar](gerenciar.md) | Onde fica aquela tela? |
| [perfil](perfil.md) | Como está a minha conta, e como eu mexo nas configurações? |

### Notas

| Tela | Pergunta que responde |
|---|---|
| [nota-detalhe](nota-detalhe.md) | O que eu escrevi aqui, e como eu mexo nisso? |
| [notas-pastas](notas-pastas.md) | Como eu organizo isso? / Onde essa nota vai? |
| [notas-lixeira](notas-lixeira.md) | Apaguei sem querer — dá para voltar? |

### Lembretes

| Tela | Pergunta que responde |
|---|---|
| [lembrete-detalhe](lembrete-detalhe.md) | Me avisa disso — e me avisa mesmo? |
| [lembrete-recorrencia](lembrete-recorrencia.md) | Repete quando, exatamente? |

### Dinheiro — o dia a dia

| Tela | Pergunta que responde |
|---|---|
| [transacoes](transacoes.md) | Cadê aquele lançamento — e o que realmente entrou e saiu neste mês? |
| [transacao-detalhe](transacao-detalhe.md) | O que é esse lançamento, de onde veio, e está certo? |
| [transacao-form](transacao-form.md) | Quero registrar (ou corrigir) isso aqui, agora. |
| [conta-a-pagar](conta-a-pagar.md) | Isso ainda vai sair da minha conta — não deixa eu esquecer. |
| [contas](contas.md) | Quanto eu tenho, e onde? |
| [conta-detalhe](conta-detalhe.md) | Por que o saldo desta conta está nesse número? |

### Dinheiro — cartão

| Tela | Pergunta que responde |
|---|---|
| [cartoes](cartoes.md) | Quanto vou pagar de cartão, e quando? |
| [fatura](fatura.md) | O que tem nesta fatura, e como eu marco como paga? |
| [faturas-historico](faturas-historico.md) | Quanto paguei de cartão nos últimos meses? |
| [parceladas](parceladas.md) | O que eu já comprometi nos próximos meses? |

### Dinheiro — planejar

| Tela | Pergunta que responde |
|---|---|
| [orcamentos](orcamentos.md) | Quanto ainda posso gastar em cada categoria este mês? |
| [metas](metas.md) | Quanto falta, e em quanto tempo eu chego? |
| [dividas](dividas.md) | Quanto disso é juro, e por onde eu começo? |
| [recorrentes](recorrentes.md) | O que vai sair todo mês sem eu fazer nada? |
| [projecao](projecao.md) | Posso gastar isso? |

### Dinheiro — olhar para trás

| Tela | Pergunta que responde |
|---|---|
| [patrimonio](patrimonio.md) | Estou ficando mais rico ou mais pobre? |
| [relatorios](relatorios.md) | Quanto entrou e saiu no ano — e o que escrevo na declaração? |

### Entrada de dados e IA

| Tela | Pergunta que responde |
|---|---|
| [importacao](importacao.md) | Dá para trazer o extrato inteiro de uma vez? |
| [importacoes-historico](importacoes-historico.md) | Cadê aquele extrato que comecei a importar? |
| [regras](regras.md) | A IA errou a categoria de novo — como eu ensino de vez? |
| [atividade-ia](atividade-ia.md) | O que a IA fez com o que eu falei — e dá para voltar atrás? |

### Conta, plano e acesso

| Tela | Pergunta que responde |
|---|---|
| [login](login.md) | Sou eu, deixa eu entrar. |
| [onboarding](onboarding.md) | E agora, o que eu faço? |
| [plano](plano.md) | O que eu tenho, quanto usei, e como saio disso? |
| [paywall](paywall.md) | O que ganho pagando, quanto custa, e se eu desistir? |
| [membros](membros.md) | Quem tem acesso a isso comigo? |
| [busca-global](busca-global.md) | Onde está aquilo? |

## As personas

Toda decisão de posição nos documentos se justifica por uma delas.

| Persona | Contexto | Pergunta |
|---|---|---|
| **Rafa, 29** | autônomo, renda irregular, manda áudio no trânsito | "Posso gastar isso?" |
| **Camila, 34** | CLT + freela, organizada, domingo à noite | "Onde meu dinheiro foi e onde eu furei?" |
| **Jorge, 46** | dívidas e cartão, perto do vencimento | "O que vence e quanto?" |
| **Marina, 26** | segundo cérebro, anota 10× por dia | "Onde está aquilo que anotei?" |
| **Casal** | workspace compartilhado | "Quem lançou isso?" |

**Regra transversal:** o app é a *segunda* superfície — a primeira é o WhatsApp. Toda tela vazia
ensina o atalho do WhatsApp; toda tela cheia mostra o que a IA entendeu e deixa corrigir num
toque. Corrigir a IA precisa ser mais fácil do que digitar do zero.
