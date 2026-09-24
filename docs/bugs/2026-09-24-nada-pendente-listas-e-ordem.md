# 24/09/2026 — nada pendente, listas do mais recente e aos poucos

O pedido: *"não quero nada pendente, teste tudo que faltou, corrija o que tiver que corrigir por
mais pequeno ou detalhe que seja… quando eu clico para ver o ciclo, parece que está ordenando do
mais antigo para o mais recente, em tudo tem que ser do mais recente para o mais antigo. Tome
cuidado com essa parte de mostrar tudo de uma vez, sempre preze pelo lazy loading, carregando de
pouco em pouco e clicando para ver mais, valide se isso acontece em mais algum outro lugar."*

Commits: `5a22acf`, `62c5aa4`, `96a8f80`, `af70440`, `aee7c56`, `92f72b3`.

## 1. O ciclo vinha do mais antigo e inteiro

`cycle.tsx` ordenava cada grupo por `a.day.localeCompare(b.day)` e desenhava 30 a 150 linhas de uma
vez. Agora cada grupo vem do mais recente para o mais antigo (no mesmo dia, o maior valor) e mostra
20 por vez com "Ver mais"; as compras da fatura aberta dentro do ciclo também.

## 2. A régua, aplicada ao app inteiro

Auditoria de toda lista (um agente de leitura listou 40 renderizações, com fonte, ordem e tamanho
possível). A régua ficou escrita em `frontend.md` ("Lista: do mais recente para o mais antigo, e aos
poucos"):

- **Histórico e período** do mais recente para o mais antigo: ciclo, "Está no app e não veio no
  arquivo" (vinha ascendente), contas (não tinha ordem nenhuma — `account_balances` sem ORDER BY),
  metas, membros.
- **Contrato com passado e futuro** em duas metades: a linha do tempo do financiamento e as parcelas
  de uma compra aberta viraram **"A seguir"** (a próxima primeiro) e **"Já pagas"/"Pagas"** (a mais
  recente primeiro). A próxima parcela, que ficava centenas de linhas abaixo do topo num contrato de
  360, abre a tela.
- **Agenda do que vem** (O que vence, Próximos dias, lembretes, recorrentes, meses da Projeção)
  continua com o mais próximo primeiro — ali "mais recente" poria o mais distante no topo.

Aos poucos, com um primitivo só (`VerMais`, `useAosPoucos`, `useJanelasPorGrupo`, `PASSO` = 20):

| lista | antes | agora |
|---|---|---|
| ciclo (grupos e compras da fatura) | tudo | 20 por grupo |
| linha do tempo da dívida (até 360) | tudo | 20 por metade |
| prévia da importação (até 500) | tudo | 20 por grupo; "Marcar todos" vale para o grupo inteiro |
| Projeção: meses (até 120), Atrasado, O que vence, O que entra | tudo | 20 por lista |
| recorrentes, metas, extrato da meta, parceladas, regras, categorias | tudo | 20 por vez; o total do mês da meta conta o mês inteiro |
| Hoje "Agora" (atrasado sem data mínima) | tudo | 20 |
| Orçamentos "sem limite" | `slice(0, 5)` calado | 5 + "Ver mais" |
| lembretes | `limit(100)` calado | páginas de 20 no servidor |
| alertas / importações | `limit(60)` / `limit(20)` calados | limite que cresce pelo "Ver mais" |
| faturas do cartão | `limit(60)` calado | todas; a lista desenha 20 por vez, o gráfico segue nas 60 |
| parceladas (e o "Comprometido") | `limit(200)` calado | todas, em lotes de 100 ids; a lista desenha 20 |
| notas arquivadas | parava em 30 sem pedir a próxima | "Ver mais" busca a página seguinte |
| busca | 30 por tipo calados, "Tudo" mostrava 5 sem caminho | 20 por tipo, o chip diz "20+", "Ver mais" abre o tipo e pede mais 20 |
| lixeira | "Carregar mais" | "Ver mais" (um rótulo por intenção) |

Ficaram como estavam, com motivo: Lançamentos e Notas (já paginavam no servidor, 50 e 30), a
conversa do Agente (paginada), a fatura (`FlatList` virtualizada por dia), Próximos dias (janela de
7 dias e no máximo 6 compras de cartão) e os lembretes da Hoje (prévia de 20 com "Todos ›").

## 3. Achados no caminho, já corrigidos

- **Valores minúsculos no iPhone.** O `adjustsFontSizeToFit` que o `Money` ganhou em 23/09 encolhe
  numa passada de layout estreita e não volta a crescer; no ciclo, "Comecei com" e a parcela do
  macbook ficavam com um terço do tamanho. Dinheiro deixou de encolher por padrão; quem tem geometria
  fixa (face do cartão, ladrilho, número do herói) liga `DinheiroEncolhe`.
- **"Próximas faturas" até 2029 em R$ 0,00.** 17 faturas futuras sem compra, sobras de parcelado
  encurtado ou apagado. Fatura futura sem compra não aparece na lista nem nas setas da fatura.
- **`[txId]` procurava a compra na lista de 200** — trocado pela consulta da compra pelo id.
- **`anon` executava 45 funções de public** (sem vazamento: todas `security invoker`, e `anon` não
  tem USAGE em `private`). Migration `20260924120000`, aplicada no staging, com
  `anon_sem_execute.sql`.
- **"Os 0 lançamentos que você confirmou continuam no financeiro"** ao apagar uma importação sem
  nada confirmado.
- Três `as Href` desnecessários; o comentário de "Últimos lançamentos" que dizia `created_at`.

## 4. Os adiados de 23/09, fechados

| adiado | o que foi feito |
|---|---|
| cartão da dívida sem press-in | `PressableScale` em dívidas, metas, orçamentos e recorrentes; guarda no `anti-slop` |
| linha do tempo de 360 linhas | duas metades, 20 por vez |
| diminuir as pagas punha a próxima no passado | `proximaNoCronograma` espelha o `greatest` do banco |
| "Desfazer" de dívida apagada dizia que ela voltou | o desarquivar devolve se voltou; senão "não existe mais" |
| formulário sem erro quando os pagamentos falham | faixa de erro com "Tentar de novo" |
| "Paguei" pelo WhatsApp sobrescrito pelo formulário aberto | trava por `updated_at`; provada na API do staging (versão velha → 0 linhas) |
| "estimada" num pagamento lançado | piso das pagas = maior parcela paga (app e agente) + linha do tempo defensiva |
| card do Próximo passo: raio, entrada dobrada, glifo, `as Href` | raio mantido (design.md 17/09 fez dos Primeiros passos um destaque, e o Próximo passo ocupa o lugar); entrada só na troca; glifo único; rota tipada |
| demonstração montando em sequência, hápticos | título → apoio → valor; o autoplay não vibra; o `Chip` não vibra em dobro |

## Como cada um foi validado

| # | teste | no aparelho |
|---|---|---|
| 1 | "Ciclo: dentro de cada grupo…" (falhava: 25 linhas) | Android 384dp × 1,3: faturas 10/10 → compras 02/10, 01/10… 04/09 → atrasadas; iPhone escuro e claro |
| 2 | um teste por lista (ciclo, dívida, importação, Projeção, recorrentes, metas, parceladas, regras, categorias, Hoje, lembretes, alertas/importações, arquivadas, busca, contas, orçamentos), cada um vermelho antes | Android: dívida "Ver mais (12)" → 32ª; Projeção 10 anos "Ver mais (100)"; parceladas "A seguir"/"Pagas"; busca "Lançamentos 20+"; faturas "Ver mais (8)"; importação real de 30 linhas → 20 + "Ver mais (10)" (lote apagado pelo id). iPhone: dívida, parceladas, toque longo do cartão |
| 3 | "Dinheiro não encolhe por padrão…"; "Faturas: fatura FUTURA sem compra…"; `anon_sem_execute.sql` | iPhone: ciclo escuro e claro com os valores no tamanho certo, Hoje e Financeiro; Android: face do cartão "R$ 1.423,00" numa linha a 1,3; anon recebe "permission denied for function" |
| 4 | `finance-form`, `debt-history`, `simple-finance-ui`, `pytest` (1112) | trava por versão e desarquivar provados na API do staging |

Portão: `tsc`, `lint`, `npm test` 822/822, `ruff`, `pytest` 1112. Agente do staging em
`agente-staging-00160-wrl`.

## O que não depende de código

- **A execução que aprova `evaluate_answer_forms.py` e os `probe_*`** não rodaram: o Gemini do
  staging (projeto sem faturamento) devolveu `503 UNAVAILABLE` das 13h53 às 14h33 em todas as
  tentativas, e a cota grátis do Flash (20/dia) é menor que a suíte. As frases novas de
  financiamento que passaram antes do 503 ("a próxima parcela do carro vence dia 10/11" →
  `next_due_date`; "apaga de vez…" → `trashed=true`) saíram certas. Rodar com uma chave com
  faturamento é decisão do Gabriel (`ai-gemini.md`).
- **Produção**: `20260923120000`, `20260923140000`, `20260923160000`, `20260923170000` e
  `20260924120000`, depois agente, depois app — só o Gabriel sobe (o hook bloqueia).

## Visto de 23/09, investigado

- **Aviso "state update on a component that hasn't mounted yet" no login do Android:** não
  reproduziu em saída + entrada, partida a frio nem entrada direto no onboarding (logcat limpo nos
  três). Os avisos amarelos do dia eram "Cannot connect to Expo CLI" — o websocket do Metro em
  desenvolvimento, que não existe no app instalado.
- **Barra de abas do Android sumindo:** reproduzido o gatilho — trocar a densidade da tela com o app
  aberto recria a Activity (a superfície React é desmontada e sobe de novo); a tela fica em branco
  enquanto a raiz nova monta e depois volta inteira, com a barra. Não reproduziu a barra ausente com
  o conteúdo presente em nenhuma das tentativas.
