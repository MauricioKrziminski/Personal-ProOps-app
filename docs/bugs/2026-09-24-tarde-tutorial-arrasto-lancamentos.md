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

**Causa (medida):** no iOS o gesto do arrasto (`dedo`, o `Gesture.Manual` que observa o card) e
o toque do botão disputavam o mesmo toque, e o do botão perdia. O botão do painel passou a ser um
`Gesture.Tap` declarado `simultaneousWithExternalGesture(dedo)` — o `anti-slop.test.ts` prende.

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

**Causa (medida):** o `UISearchController` com `hideNavigationBar` devolve a barra de navegação
da tela de BAIXO quando o voltar é interativo — e a tela de baixo é o grupo `(tabs)`, que no
stack raiz tem o nome do arquivo como título. Duas correções: `hideNavigationBar={false}` na busca
do iOS e o título do grupo sendo o nome da aba ativa (`lib/abas.ts`), que é também o que o "voltar"
passa a dizer.

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

- **Item 1:** "Dicas no lugar + Guia" (o padrão do TipKit e da ajuda contextual do NN/g), escrito
  em `specs/2026-09-24-dicas-e-guia-design.md` e aprovado antes de implementar.
- **Item 3:** o painel é "tudo junto" — o botão da ponta cresce e cobre os outros no até o fim —,
  e até o fim aciona SEMPRE a ponta (Apagar continua confirmando).
- **Ordem das listas:** agenda e o que vem continuam do mais próximo; histórico e período, do mais
  recente (confirmado pelo dono do produto).

## Validação

Portão em cada commit: `tsc`, `expo lint` e `npm test` verdes (853/853 no último).

| item | commit | conferido em |
|---|---|---|
| 1 — dicas e guia | `22c0610` e o seguinte | s26 (claro; escuro a 384dp × 1,3) e iPhone 17 Pro (claro e escuro): as seis dicas no lugar, uma por tela e por visita; some no "Entendi" e no uso (menu do herói, Carteira, curva, arrasto, extrato da conta, deslize da fatura); volta pelo "Mostrar"; sobrevive a fechar o app; "Conhecer o app" marca ao abrir o guia. Estado zerado no aparelho (só a chave `dicas:` do `dev@`, apagada pelo nome exato) para ver as seis do começo — inclusive dentro das pastas de Notas, onde a conta de demonstração guarda todas as notas |
| 2 — botões do arrasto no iOS | `ec08d7e` | simulador: "Mais" abre o menu, "Arquivar" arquiva |
| 3 — borda e até o fim | `5278f48` | s26 e simulador: canto casado com o card; até o fim aciona a ponta dos dois lados (6/6 medido no banco) |
| 4 — efeito do WhatsApp | `5278f48` | vídeo quadro a quadro no s26 |
| 5 — data da compra e "Concluído" | `a352e5b` | "wardogs" mostra "compra de 14/09" e aparece em Concluído |
| 6 — "(tabs)" | `85806a1` | simulador: voltar pela borda com a busca ativa |
| 7 — vazio com seção secundária | `62fd988` | Dívidas, Metas, Parceladas, Recorrentes, Lembretes, Notas e Orçamentos |
| 8 — "Últimos lançamentos" no iOS | `4891b38` | simulador: tocar abre o detalhe |
| 9 — placeholders | `981b4dd` | teste de anti-slop prende nome real e valor sem "Ex.:" |

**Achado junto, e corrigido:** o FAB ficava por cima do toast com "Desfazer" (`5278f48`, sobe
acima dele); os números do Perfil não diziam que eram do mês e do WhatsApp (`a7923f3`); a Hoje
não tinha porta para a busca em tudo (`0b86cb7`); o extrato de uma conta não dizia o saldo dela
(`c30f3ad`); a dica da lista sumia com o painel aberto e movia os botões sob o dedo (agora some
ao fechar); abrir o app direto num link perdia a mudança pedida antes de o aparelho responder, e
gravá-la apagaria o que já estava encerrado (fila aplicada por cima da leitura,
`use-dicas.test.ts`); o toque longo do iOS não encerrava a dica das listas (agora encerra ao
escolher uma ação — o `Link.Menu` não avisa quando abre); quem guarda todas as notas em pastas não
via a dica de Notas (ela também está dentro da pasta); três frases deixavam uma palavra sozinha na
linha no iPhone ou a 384dp × 1,3 e foram encurtadas.

**Consequência declarada para quem já usa:** "Conhecer o app" é o quarto passo dos Primeiros
passos, então quem tinha os três feitos volta a ver o card em 3/4 — e o Próximo passo espera,
como sempre, até ele acabar (abrir o guia) ou até o "Agora não". É o anúncio do guia para quem
já usa o app; guardado no aparelho, como o "Agora não".

**Efeito colateral no staging (conta `dev@`):** os testes de arrastar até o fim mexeram em notas
de demonstração; `b7e765de` foi restaurada pelo id, e `9772618e`/`adaaaf73` ficaram só com o
`updated_at` novo (conteúdo igual).
