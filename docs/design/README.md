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

A linguagem de design (tokens, glass, movimento, estados, anti-slop) mora em
`.claude/rules/design.md`, não aqui. Os documentos assumem essa regra e não a repetem.

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
