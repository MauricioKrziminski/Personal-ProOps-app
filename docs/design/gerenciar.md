# Gerenciar — `src/app/(tabs)/finance/manage.tsx`

Tela nova, criada em 28/08/2026. Nasceu de uma queixa direta do usuário sobre o Financeiro:

> "não é o padrão de aplicativos semelhantes deixar 'gerenciar' ali embaixo e sim colocar um tab
> em cima ou qualquer outra coisa."

O que existia era uma `Section title="Gerenciar"` com **12 `Row`s de navegação no rodapé** da aba
Financeiro. Para chegar em "Cartões e faturas" a pessoa rolava o painel inteiro — resumo do mês,
categorias, orçamentos, cartões, últimos lançamentos — e só então encontrava o menu. O fim de um
painel lia como tela de Ajustes.

A decisão (do usuário, entre quatro opções apresentadas) foi **faixa de atalhos no topo +
"Ver tudo"**: os quatro destinos mais abertos ficam logo abaixo do card de destaque, e o resto
mora aqui. É o padrão de Nubank, Inter e Itaú, e mantém a aba Financeiro sendo só resumo.

## Pergunta que responde

> "Onde fica aquela tela?"

## Persona

**Camila, 34.** Abre pouco e sempre com destino em mente — não é uma tela de exploração. Por isso
a lista é agrupada e não tem busca: com 12 itens em 4 grupos, o olho acha mais rápido que o dedo
digitaria.

## Entrada e saída

- **Entrada:** "Ver tudo" no cabeçalho da faixa de atalhos do Financeiro.
- **Saída:** os 12 destinos, todos com `push`.
- **Back:** pop para o Financeiro. Fica na pilha da aba, então a tab bar não some.

## Anatomia

1. **Header nativo** — large title "Gerenciar", back "Financeiro". Sem `headerRight`: não há ação
   nenhuma nesta tela, ela só encaminha.
2. **Quatro `Section` agrupadas por intenção**, nesta ordem:

| Grupo | Itens |
|---|---|
| **Dia a dia** | Todos os lançamentos · Contas e carteiras · Cartões e faturas · Faturas anteriores · Compras parceladas |
| **Planejamento** | Orçamentos · Metas · Dívidas · Recorrentes |
| **Panorama** | Patrimônio · Relatórios e IR |
| **Conta** | Plano e família |

Agrupar não é enfeite: 12 linhas seguidas se leem como parede, e quem veio ver a fatura não
deveria passar o olho por "Relatórios e IR" no caminho.

## Dados

Nenhum. A tela é estática — um array de `{ title, icon, href }`. Sem query, sem loading, sem
erro: **por isso ela não tem os estados obrigatórios da §7 do design**, e é a única do app nessa
condição. Contagem de itens por destino (ex.: "3 cartões") foi considerada e recusada: obrigaria
sete queries para decorar um menu.

## Ação primária

**Navegar.** Um toque, um destino.

## Ações secundárias

Nenhuma. Sem context menu, sem reordenar, sem favoritar — a ordem é opinião do produto, igual à
ordem dos blocos do Financeiro.

## Estados

- **Conteúdo longo** — "Todos os lançamentos" é o rótulo mais comprido e cabe em uma linha até
  Dynamic Type XL; acima disso a `Row` trunca (`numberOfLines={1}`), e o ícone identifica.
- Não há loading, empty nem error: não há dado.

## Movimento

Nenhum próprio. A transição é o `push` nativo da pilha, e o feedback de press é o highlight de
fundo da `Row`. Menu não é lugar de delight — é lugar de chegar rápido.

## Acessibilidade

- `Row` já anuncia título e papel de botão; o chevron comunica que navega.
- Título de `Section` em caixa alta é decoração visual: o `ThemedText` mantém o texto original
  para o leitor de tela.
- Alvos ≥ 44pt (`HitTarget` na `Row`).

## Fora de escopo

Atalhos configuráveis pelo usuário (quais quatro aparecem no Financeiro) · busca · contagem por
destino · reordenar.
