# 24/09/2026 (tarde) — tutorial, arrasto no iOS, data do lançamento e seis detalhes

Lote de nove itens do dono do produto, depois de testar o onboarding no s26 e o app no iPhone.
Reproduzido antes de mexer: iOS no simulador (iPhone 17 Pro, escuro, `dev@` no staging) e
Android no s26 (o app atual pelo Metro, contra o staging).

## 1. O tutorial dentro do app

**Relato:** *"onde está o onboarding… ter um tutorial dentro do app, explicando o que tem… meu
pai não sabia que dava para importar fatura… como acessar saldo de uma conta específica… se clicar
no gráfico ele dá opções, e se o usuário não tiver essa malícia, ele não vai descobrir isso nunca.
Isso teve uma pesquisa e não foi implementado?"*

**O que existe:** a pesquisa foi feita em 23/09 (`specs/2026-09-23-onboarding-hibrido-design.md`)
e o desenho escolhido — "híbrido 2 + 1" — foi implementado: a demonstração "Primeira frase" no
passo ① do onboarding, o card "Próximo passo" na Hoje e os caminhos de importação a partir da
fatura e do cartão. Aquele desenho deixou FORA, por escrito, o tour e a tela "O que dá para
fazer", e ele não ensina gesto nenhum.

**Por que não resolve a queixa:**
- o "Próximo passo" só aparece depois dos Primeiros passos, então quem acabou de criar a conta
  não vê nada;
- ele cobre cinco recursos (importar, projeção, lembrete, parcelado, nota) e nenhuma das
  interações escondidas: tocar no gráfico, arrastar o card, o toque longo, abrir uma conta para ver
  o saldo dela, tocar na pilha de cartões.

**Precisa de desenho novo** (ver "Decisões" no fim).

## 2. Os botões do arrasto não respondem no iOS

**Reproduzido** no simulador: pasta "trabalho" → arrastar a nota para a esquerda → o painel abre
com "Mais" e "Arquivar" → tocar em "Mais" não faz nada e o painel continua aberto. No Android o
mesmo toque abre o menu.

**Causa:** a investigar no conserto, com experimento (o `Pressable` do gesture-handler dentro do
`ReanimatedSwipeable`, e o gesto observador `Gesture.Manual` que envolve o card).

## 3. A borda do painel e o "arrastar até o fim"

**Reproduzido** no s26 (pasta "compras"): o card tem canto arredondado e o painel encosta nele com
aresta reta.

**O "até o fim":** hoje só executa a ação da borda quando ela tem `desfaz` (Arquivar, Fixar).
Quando a borda é "Apagar" ou "Mais", arrastar até o fim não faz nada. O pedido: até o fim para a
esquerda aciona a opção mais à direita; para a direita, a mais à esquerda — qualquer que seja
(Apagar continua pedindo confirmação).

## 4. O efeito do arrasto

Hoje os botões aparecem parados atrás do card. Pedido: efeito fluido estilo WhatsApp ao arrastar
e ao arrastar até o fim.

## 5. A data do lançamento na lista

**Relato:** o wardogs aparece na data da fatura, e o filtro "Concluído" não o mostra.

**O que a lista faz:** o cabeçalho do dia usa `occurred_at` (certo), mas a LINHA da compra de
cartão em aberto só mostra "na fatura de 10/10" — o vencimento da fatura é a única data escrita
nela. E o filtro "Concluído"/"Em aberto" é por `status`: compra de cartão fica `pending` até a
fatura ser paga, então a compra de ontem nunca é "concluída" — a mesma régua que a pílula
"previsto" já abandonou em 20/09 (`estadoDaLinha`, por data).

**Dado real (leitura só, produção):** "wardogs (1/2)" está gravado em 14/09. O agente o criou em
21/09 sem data na frase (`occurred_at: null` no parse → hoje); a data virou 14/09 quando ele foi
parcelado pelo app, no campo "Data da primeira parcela" do formulário. O formulário não muda a data
sozinho — foi a data escolhida ali.

## 6. "(tabs)" em cima do Financeiro

**Reproduzido** no simulador: Financeiro → Lançamentos → digitar "tv" na busca → voltar pelo
gesto da borda → o Financeiro aparece com um header nativo escrito "(tabs)" por cima da faixa da
marca.

**Causa:** a investigar no conserto (a busca nativa `Stack.SearchBar` escreve opções de header, e
a rota `(tabs)` não tem título).

## 7. Tela vazia com seção secundária

**Reproduzido** no print (Dívidas): o estado vazio grande e centralizado, e "Arquivadas · 1"
solto embaixo. O mesmo padrão pode existir em Metas (Concluídas), Parceladas (Terminadas),
Recorrentes (Pausadas) e Lembretes (Pausados) — auditar todas.

## 8. "Últimos lançamentos" não abre o lançamento no iOS

**Reproduzido** no simulador: tocar em "Ferramentas" não faz nada (a árvore de acessibilidade nem
lista as linhas como botão). Em Lançamentos o toque abre o detalhe.

**Causa:** no iOS o `ItemLink` é `<Link asChild>`, que injeta `onPress` no filho. O `LedgerRow`
sem `onLongPress` (sempre, no iOS) desenha uma `View` e descarta o `onPress`. `Row` e `Pressable`,
os outros filhos de `ItemLink`, repassam — é o único.

## 9. Placeholder com nome real

**Encontrado:** "Gabriel" no cadastro e no Perfil (o nome do dono); "Ex.: Nuuvem Wardog" no
lançamento e na compra parcelada (uma compra real dele); e valores sem "Ex.:" que parecem campo
preenchido ("Nubank", "Viagem", "Tesouro Selic", "mercado", "Contas do mês").

## Decisões

(preenchido com a resposta do dono do produto)

## Validação

(preenchido item a item)
