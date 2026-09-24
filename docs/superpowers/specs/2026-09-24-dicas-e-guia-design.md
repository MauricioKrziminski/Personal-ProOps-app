# Dicas no lugar + "Como usar o ProOps"

Item 1 do lote de 24/09/2026 (tarde). Bug doc: `docs/bugs/2026-09-24-tarde-tutorial-arrasto-lancamentos.md`.

## O pedido

*"ajudar usuários que nunca mexeram, ter um tutorial dentro do app, explicando o que tem… meu pai
não sabia que dava para importar fatura… como acessar saldo de uma conta específica… se clicar no
gráfico ele dá opções, e se o usuário não tiver essa malícia, ele não vai descobrir isso nunca."*

**Sucesso:** quem nunca usou descobre sozinho o que o app faz e onde cada coisa mora — inclusive os
gestos que não se veem —, sem ninguém explicar.

## A decisão (dono do produto, 24/09/2026)

"Dicas no lugar + Guia", depois de conferido que é o padrão do mercado:

- **Apple TipKit** (iOS 17+, usado nos apps da própria Apple): dica contextual presa ao recurso,
  de preferência *inline* (não cobre o conteúdo), que some quando a pessoa usa o recurso.
- **NN/g**: ajuda contextual ("pull revelation") funciona melhor que tutorial de abertura, que
  interrompe, não melhora o acerto e é esquecido.
- **Chameleon** (pesquisa de 23/09): o que a pessoa abre por conta própria completa 67%; o que abre
  sozinho, 31%. Por isso o guia é aberto pela pessoa, e as dicas aparecem no lugar, uma por vez.

## 1. A dica no lugar (`Dica`)

**O que é:** um card pequeno, inline, logo abaixo (ou acima) do que ele explica, com um bico
apontando para ele: glifo, UMA frase e "Entendi". Não escurece a tela, não bloqueia toque, não
flutua. Some ao tocar em "Entendi" ou quando a pessoa USA o recurso (como o TipKit).

**Regras de exibição:**
- Só depois do onboarding concluído, e só com a tela já carregada (nunca em cima de esqueleto).
- **Uma dica por tela, uma de cada vez**, na ordem do catálogo; a próxima só na próxima visita.
- Vista uma vez e dispensada (ou usada), nunca volta sozinha — só pelo "Mostrar" do guia.
- Guardado por usuário, no aparelho (`dicas:<userId>`, AsyncStorage), como o "Agora não" do
  Próximo passo.

**Movimento:** entra em fade com a cascata da tela; sai em fade (sem animação de layout no Android
— `transicaoDeLayout`). Um háptico de seleção no "Entendi". Reduce Motion: só fade.

**O catálogo** (`lib/dicas.ts`, puro e testado) — só os gestos escondidos de maior valor, tirados
do inventário:

| id | tela | frase | some quando |
|---|---|---|---|
| `hoje-painel` | Hoje (herói) | "Toque no painel para ver o que fecha o ciclo, a projeção e as metas." | abre o menu do painel |
| `hoje-contas` | Hoje ("Nas contas") | "Toque numa conta para ver o saldo e o extrato dela." | abre o extrato de uma conta |
| `fin-pilha` | Financeiro (pilha de cartões) | "Toque na pilha para ver todos os cartões." | abre a Carteira |
| `fin-grafico` | Financeiro (gráfico do herói) | "Arraste no gráfico para ver o saldo de cada dia." | arrasta no gráfico |
| `lista-arrasto` | Lançamentos e Notas (1ª linha) | "Arraste para os lados para as ações rápidas. Segure para ver todas." | arrasta ou segura um card |
| `fatura-cartao` | Fatura (cartão ancorado) | "Deslize o cartão para trocar de fatura. Importar a fatura fica no ⋯." | desliza o cartão |

## 2. "Como usar o ProOps" (`/guia`)

Uma tela com tudo que dá para fazer, em grupos curtos, cada item com **"Mostrar"**, que leva à tela
certa e acende a dica dali (mesmo já dispensada):

- **Registrar:** pelo WhatsApp ou pelo Agente, em frase ("gastei 45 no mercado"); pelo "+ Lançar";
  importar a fatura ou o extrato.
- **Contas e cartões:** ver o saldo de uma conta; ver todos os cartões; trocar de fatura.
- **Planejar:** a projeção e o "E se…"; metas; orçamentos. (O que fecha o ciclo é o gesto "Tocar no painel": o link do ciclo carrega a régua do `cycle_now`, e só o painel a tem.)
- **Notas e lembretes:** anotar rápido; lembrete que repete; nota em pasta.
- **Gestos:** arrastar para os lados, segurar para ver tudo, tocar no painel, arrastar no gráfico.

**Portas (todas abertas pela pessoa):**
- Perfil → "Como usar o ProOps".
- Primeiros passos da Hoje ganham "Conhecer o app" (marcado quando o guia é aberto) — é o que
  quem acabou de criar a conta vê; o Próximo passo só aparece depois deles.

## Fora do escopo

- Tour com a tela escurecida e passos numerados (recusado pela pesquisa e pela escolha).
- Dica sobre a dock/barra de abas: no iOS a `NativeTabs` é do sistema.
- Reapresentar o onboarding.

## Validação

- `node --test`: o catálogo e a regra de exibição (qual dica aparece, uma por tela, a usada e a
  dispensada não voltam, o "Mostrar" reacende) — `lib/dicas.test.ts`.
- UI: a Hoje mostra `hoje-painel` numa conta nova e não mostra depois de dispensada; o guia leva à
  tela com a dica acesa.
- Aparelhos: iOS e Android, claro e escuro, 384dp × 1,3; conta nova criada no staging.
