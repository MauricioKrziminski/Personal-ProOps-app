# Arrastar o card para os lados (estilo WhatsApp)

Item 5 do lote de 23/09/2026 (noite).

## O pedido

> *"Em todos os cards que eu aperto e seguro para aparecer o menu, tem que poder também arrastar
> para o lado direito e fazer uma ação e o lado esquerdo fazer outra ação, que nem no WhatsApp."*

**Decisões do dono do produto (23/09/2026):**
- As ações são escolhidas card a card: as mais úteis e mais usadas. Um lado pode ficar vazio
  quando nada faz sentido ali. Quando o menu tem mais ações que as do arrasto, entra **"Mais"**,
  que abre o mesmo menu de baixo do toque longo.
- **Arrastar até o fim** executa a ação da ponta **só quando ela se desfaz** (Fixar, Arquivar,
  Pausar), com "Desfazer" no aviso. Apagar nunca vai sozinho.
- A tabela abaixo foi aprovada linha a linha.

## Regras que valem para todo card

- **Direita** = a ação rápida do item. **Esquerda** = tirar da lista (Arquivar ou Apagar), e
  "Mais" ao lado quando sobram ações.
- **O toque longo não muda.** O arrasto é um atalho a mais; o menu continua com todas as ações.
- **Apagar confirma**, como hoje. Quem confirma é a própria ação: o arrasto só a chama.
- **Um card aberto por vez.** Abrir outro fecha o anterior, e rolar a lista fecha o aberto.
- **Botão revelado** é tocável e tem rótulo de acessibilidade. As mesmas ações continuam
  alcançáveis pelo leitor de tela, no menu.
- **Voltar do iPhone:** numa tela empurrada, o arrasto para a direita só começa a partir de
  ~24pt da borda esquerda. Perto da borda, o gesto é o de voltar do sistema. Nas raízes de aba
  (sem voltar) não há zona morta.
- **Cores:**
  - Apagar é `danger`.
  - Arquivar, Mais e as neutras usam `backgroundElement` com tinta.
  - A ação rápida da direita usa `tintFill`/`onTint`.
  - Nada de cor nova (monocromático, design.md §2b).
- **Háptico:** seleção ao cruzar o ponto de abrir; impacto leve ao cruzar o ponto de "até o
  fim" (é ali que soltar passa a executar, como no Mail e no WhatsApp). O resultado vibra pelo
  toast da ação, como no menu — a tela não soma uma terceira vibração.
- **Movimento:** o painel segue o dedo e assenta em mola (`Motion.spring.settle`). Com Reduce
  Motion o assentamento é curto, sem ultrapassagem. Arrastar até o fim executa AO SOLTAR, sem
  esperar a mola assentar.
- **Fonte grande:** o botão revelado cresce com a fonte até 1,6× (88dp na padrão), e o limiar de
  "até o fim" acompanha. A folga depois do painel encolhe até meio botão para o limiar caber em 85% do
  card (24/09/2026): a 384dp × fonte 1,3, Mais + Arquivar punham o ponto em 98% do card.

## Tabela aprovada

| Card (tela) | Direita | Esquerda | Até o fim executa |
|---|---|---|---|
| Lançamento (Lançamentos) | Paguei/Recebi se pendente; senão Editar | Apagar · Mais | — |
| Lançamento (Últimos lançamentos, Financeiro) | Editar | Apagar | — |
| Compra na fatura | Editar | Apagar | — |
| Previsto (Projeção) | Paguei/Recebi | Editar | — |
| Nota em lista (Notas e pasta) | Fixar/Desafixar | Arquivar · Mais | Fixar e Arquivar |
| Pasta na lista de pastas | Fixar/Desafixar | Arquivar · Mais | Fixar e Arquivar |
| Nota na lixeira | — | Apagar de vez | — |
| Lembrete | Pausar/Retomar | Apagar | Pausar/Retomar |
| Conversa do agente | Renomear | Apagar | — |
| Conta | Editar | Arquivar | — (conta arquivada não tem "Desfazer") |
| Cartão (Cartões) | Paguei se a fatura fechou (abre a fatura já no pagamento); senão Importar fatura | a outra das duas · Abrir na carteira | — |
| Dívida | Pagar parcela | Arquivar · Mais | Arquivar (já tem Desfazer) |
| Compra parcelada | Editar a compra | Apagar a compra · Mais | — |
| Recorrente | Pausar/Retomar | Apagar · Mais | Pausar/Retomar |
| Meta | Guardar | Arquivar · Mais | — (sem "Desfazer" hoje) |
| Aporte no extrato da meta | — | Desfazer | — |
| Orçamento | Editar limite | Mais | — |
| Regra de categoria | Editar | Apagar | — |
| Importação (histórico) | — | Apagar registro | — |

**Sem arrasto, e por quê:**
- **Pastas em grade:** o toque longo já arrasta o bloco para reordenar.
- **Linha da revisão de importação:** o toque marca e desmarca, e são até 500 linhas.
- **Faturas:** o menu só leva a outras telas.
- **A Hoje:** não tem menu de toque longo.

"Até o fim executa" vale só onde a ação tem **Desfazer** de verdade. Quando o aviso com
"Desfazer" não existe hoje (nota, pasta, lembrete, recorrente), ele entra junto com o arrasto.

## Arquitetura

- **Um primitivo: `Deslizavel`** (`src/components/ui/deslizavel.tsx`), sobre o
  `ReanimatedSwipeable` do `react-native-gesture-handler` (já instalado, 2.32; nenhuma lib
  nova).
- **As ações continuam declaradas UMA vez** (`ItemAction[]`, `lib/item-actions.ts`). O tipo
  ganha dois campos opcionais:
  - `arrasto?: 'direita' | 'esquerda'`: em que lado a ação aparece;
  - `desfaz?: boolean`: pode executar ao arrastar até o fim.
- **A divisão em lados é pura e testada** (`src/lib/arrasto.ts`, `ladosDoArrasto(acoes)`):
  - direita = as marcadas `direita`;
  - esquerda = as marcadas `esquerda`, com "Mais" ao lado quando sobra ação sem lado;
  - "Mais" chama `showItemActions(titulo, acoes)` com a lista inteira, a mesma do toque longo.
- **`ItemLink` já recebe as ações**: as 5 telas que o usam ganham o arrasto sem mudar a tela
  além de marcar os lados. O `Deslizavel` fica POR FORA do `Link` (o `Link.Trigger` engole o
  `style` do filho direto).
- **As outras telas** envolvem o card no `Deslizavel` com a mesma lista que já passam ao
  `showItemActions`.
- **Dentro de `Section`** o painel revelado fica recortado pelo grupo (`overflow: hidden`),
  inclusive nos cantos arredondados dos Lançamentos.
- **Listas com alça de reordenar** (notas): o arrasto vale no corpo do card. A alça continua
  sendo só a alça.

## Estados e bordas

- **Ação indisponível** (Paguei numa fatura aberta): o lado usa a alternativa da tabela. Sem
  alternativa, o lado fica vazio. Nunca aparece botão cinza que não faz nada.
- **Ação que falha:** o toast de erro e o rollback são os de sempre.
- **O card sai da lista** (arquivou, apagou): ele sai com a animação que a lista já tem. O
  painel não fica pendurado.
- **Tablet:** vale igual (listas).

## Validação

**Testes:**
- `node --test` de `ladosDoArrasto`: lados, o "Mais" só quando sobra, e "até o fim" só com
  `desfaz`.
- Um teste de tela por card da tabela: as ações de cada lado batem com esta spec.

**Aparelhos:** Android 384dp × 1,3 e iPhone, claro e escuro, em cada tela da tabela:
- abrir cada lado;
- tocar a ação;
- arrastar até o fim onde vale, e o Desfazer;
- abrir um, depois outro, e rolar;
- o voltar do iPhone na borda.

**Movimento:** gravado em vídeo no Android e no iPhone.
