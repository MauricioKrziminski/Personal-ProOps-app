# Fatura paga em parte, pagar num botão, de onde vem o ciclo, pago × previsto e hipóteses por período

Data: 07/10/2026. Pedido do dono do produto (9 pontos), respostas às dúvidas no mesmo dia.
Produção não é tocada: migrations vão para o STAGING e sobem para produção só com pedido explícito.

## Decisões do dono do produto (07/10/2026)

| dúvida | resposta |
|---|---|
| Onde fica o botão único "Pagar" da fatura | No topo, sob o total; sem barra fixa |
| De onde parte o detalhe do "fecho o ciclo em X" | Saldo de HOJE por conta (ciclo atual); ciclo futuro parte do anterior |
| Onde o detalhe aparece | Tocar no número abre uma folha |
| Pago × previsto vale até onde | Tudo: o banco passa a guardar o previsto quando a baixa troca o valor |

---

## 1. Fatura paga em parte aparece na tela Finanças (ponto 1)

**Problema.** A face do cartão (`BaseDaPilha`, `card-face.tsx`), a lista de Cartões (`cards.tsx`) e a
Carteira (`wallet.tsx`) escrevem `invoice_total_cents` (bruto). Com pagamento parcial nada muda na
tela, e a barra de limite (que lê `unpaid_total_cents`, líquido) discorda do número grande.
`cartaoDaPilha` (`card-status.ts`) descarta `invoice_open_cents`.

**Desenho.** O número grande continua "Fatura atual · R$ total" (é a fatura). Com pagamento e fatura
ainda não paga, a linha de baixo da face ganha **"pago R$ X · falta R$ Y"** (o que falta em
destaque). Mesma linha em Cartões e na Carteira. `pago = total − open` sai do próprio `card_summary`,
sem consulta nova. `cartaoDaPilha` passa a levar `invoice_open_cents`.

**Aceite.** Fatura com pagamento parcial mostra total + pago + falta nos três lugares; fatura sem
pagamento fica idêntica a hoje; o rótulo de acessibilidade diz o mesmo.

## 2. Pagar é UM botão, no topo, e a folha decide se desconta de uma conta (pontos 2 e 8)

**Problema.** Na fatura, "Registrar pagamento", "Marcar como paga" e "Jogar para a próxima" ficam no
rodapé da `FlatList`, depois de todas as compras. E existem dois caminhos com efeitos diferentes
(transferência × quitar sem caixa) em dois botões vizinhos — foi assim que o dono do produto marcou
como paga a fatura que queria pagar descontando da conta.

**Desenho.**
- O cartão-resumo do topo da fatura (`InvoiceDock`) ganha o botão **Pagar** (primário) e, só em fatura
  vencida, **Jogar para a próxima** (secundário). O rodapé de botões sai.
- A folha **Pagar fatura** tem no topo a chave **"Descontar de uma conta"** (ligada por padrão):
  - ligada: Valor (nasce no que falta), Pagar com, Data → `pay_invoice` (transferência, como hoje);
    botão "Paguei R$ X com <conta>";
  - desligada: só a Data → `settle_invoice` (quita sem mover caixa); a folha diz o efeito em uma linha
    ("Fica paga sem mexer no saldo") e o botão é "Marcar como paga".
- A folha vira componente (`PagarFaturaSheet`) usado pela fatura e pelo "Paguei" de Cartões: um
  caminho só. O "Marcar como paga" do menu "…" vira "Pagar…" (abre a mesma folha); desfazer
  (Desmarcar como paga, Desfazer adiamento) continua no menu.
- Varredura das outras telas com ação depois de lista longa (a investigação não achou nenhuma;
  conferir no aparelho: importação, ficha da dívida, parcelas, metas, recorrentes).

**Aceite.** Fatura com 60 compras: Pagar visível sem rolar. Chave ligada cria a transferência e
reduz o saldo da conta; desligada quita sem transferência. Valor parcial continua possível. Cartões
abre a mesma folha. Duplo toque não paga duas vezes.

## 3. De onde vem o "fecho o ciclo em X" (ponto 3)

**Problema.** O painel diz "Vou fechar em X" (`cycle_series.resultado`) e não há como ver de onde
o número sai. "Detalhe do ciclo" tem a conta global (comecei com, entrou, saiu), sem as contas.

**Desenho.**
- RPC nova `cycle_breakdown(p_month, p_view)` (par interna/wrapper, `invoker`, fuso no cabeçalho,
  `revoke` de `public, anon`), lendo as fontes que já existem — nenhuma aritmética nova:
  - **ciclo atual**: contas de `private.caixa_das_contas(ws, hoje)` (nome, tipo, saldo; "sem conta"
    quando houver) + **ainda entra** + **ainda sai** de `private.cash_events` não realizado de hoje
    até o fim, a saída separada por natureza (faturas, contas e boletos, parcelas de dívida,
    recorrentes) = **fecho em**. É a identidade que `spendable` já prova
    (`caixa + a_receber − comprometido = resultado`).
  - **ciclo futuro**: veio do ciclo anterior + entra − sai = fecho.
  - **ciclo fechado**: comecei com + entrou − saiu = sobrou (+ faltou pagar, fora da soma).
- Teste SQL: para o ciclo atual, um futuro e um fechado, o total da RPC é igual ao
  `cycle_series.resultado` (ou `caixa_no_fim`) do mesmo ciclo, nas duas réguas.
- Folha **"Como chego nesse valor"**: tocar no número do painel de Finanças, no número de
  "Detalhe do ciclo" e no "em conta hoje" do primeiro mês da Projeção. A soma da folha é o número que
  foi tocado; "Ver o que fecha o ciclo" no fim leva à lista.

**Aceite.** Soma da folha = número tocado no centavo, nos três tipos de ciclo e nas duas réguas;
privacidade (valores ocultos) vale na folha.

## 4. Valor pago × previsto (ponto 4)

**Problema.** Financiamento: o pagamento guarda `debt_principal_cents` (a parcela do contrato) e a
diferença em `debt_interest_cents`, mas a linha do tempo (`useDebtPayments` não lê o campo) mostra
um valor só. Recorrente e parcela: "Paguei" com outro valor reescreve `amount_cents`
(`confirm_payment_scoped`) e o previsto se PERDE — por isso não há o que mostrar.

**Desenho.**
- Migration: `transactions.expected_amount_cents bigint null` (positivo). `confirm_payment_scoped`
  grava o valor ANTERIOR ali quando a baixa troca o valor (só se ainda estiver nulo: corrigir de novo
  não apaga o previsto original). Backfill das ocorrências de recorrente já pagas pela versão da regra
  vigente na data (`recurring_history_versions`), só quando diferente; parcela antiga fica sem (o
  previsto dela já se perdeu).
- Dívida: o previsto é `debt_principal_cents` em parcela fixa (no modo com juros a linha diz
  "amortização X · juros Y", não "previsto").
- Exibição, uma régua para o app: o valor da linha é o PAGO; o previsto entra na linha de apoio,
  curto ("previsto R$ 120,00"), só quando diferente. Lugares: linha do tempo da dívida, parcelas da
  compra, ocorrências da recorrente, detalhe do lançamento (`[txId]`) e ciclo/lançamentos onde a
  linha já mostra apoio. Um helper puro (`previstoDaLinha`) decide, com teste.

**Aceite.** Parcela de financiamento paga R$ 10 a menos mostra o pago e "parcela R$ X"; ocorrência
de recorrente paga diferente mostra os dois; pagar de novo com o mesmo valor não muda nada
(idempotente); valor igual ao previsto não mostra nada.

## 5. Hipóteses por período, com o saldo do período (pontos 5 e 7)

**Problema.** O rascunho lista na ordem de criação (adiantamentos sempre no fim), sem mês, e a folha
não diz como o mês fica antes de "Ver resultado".

**Desenho.**
- A lista do rascunho agrupa por período na régua da Projeção (Mês | Ciclo): o período em que a
  hipótese começa (a data dela; no adiantamento, o mês do pagamento). Grupos em ordem cronológica,
  hipóteses do grupo por data. Cabeçalho: **"Dezembro · fecha em −R$ 300"** (vermelho se negativo),
  lido de `useSimulacao` no modo mês (já existe; passa a ser pedido sempre que há rascunho).
- Folha da hipótese: com valor e data preenchidos, uma linha de prévia acima dos botões —
  "Dezembro fecha em −R$ 300 (era R$ 120)" — simulando o rascunho + a hipótese em edição (espera
  350 ms, cancela a anterior, sem `placeholderData`, como a prévia "Ao salvar").

**Aceite.** Hipótese em dezembro mostra o saldo de dezembro na folha e no cabeçalho do grupo; trocar
a régua reagrupa; a prévia some ao mudar o rascunho e volta com o número novo.

## 6. Adiantar desconta o que o rascunho já adiantou (ponto 6)

**Problema (confirmado no código).** `anticipation_candidates` lê só o banco; o cliente não desconta
os `cancel` do rascunho. O segundo adiantamento da mesma fonte recebe as mesmas parcelas: "N a
vencer" bruto, teto do campo bruto, e a mesma parcela cancelada duas vezes (saldo otimista).

**Desenho.**
- O `cancel` passa a carregar a parcela (`ref_id` + `n`); rascunho antigo sem isso herda do draft de
  pagamento do mesmo `grupo`.
- `parcelasRestantes(item, adiantamentos, grupoEmEdicao)` (puro, com teste) tira do candidato as
  parcelas já canceladas por OUTROS grupos; contagem, teto, "faltam N", escolha das parcelas e valor
  sugerido leem dele.
- Defesa no envio: drafts de cancelamento repetidos (mesma fonte e parcela) são deduplicados antes de
  simular — um rascunho já gravado no aparelho com o defeito também fica certo.
- A linha do adiantamento na lista: "adianta 3 parcelas · faltam 6".

**Aceite.** Adiantar 3 em novembro e depois em dezembro: dezembro oferece só as restantes, "faltam"
desconta, o saldo final é igual ao de um adiantamento único equivalente.

## 7. "Ver mais" com respiro (ponto 9)

**Problema.** `VerMais` tem só `paddingTop`; no ciclo ele mora dentro do bloco da fatura aberta, sem
separação da linha seguinte ("Pagamento da fatura Nubank" colado).

**Desenho.** O primitivo ganha respiro simétrico; no ciclo o "Ver mais" das compras fica dentro do
bloco da fatura aberta com um separador antes da linha seguinte. Conferir todos os ~30 usos no
aparelho (lista na investigação) e corrigir os que ficarem colados.

**Aceite.** Nenhum "Ver mais" encosta em linha, separador ou card vizinho, nas telas listadas.

---

## Verificação (todos os pontos)

`tsc`, `lint`, `npm test`, suíte SQL inteira contra o Postgres local (mexe em funções
compartilhadas), migrations no staging + types. Cada ponto conferido no emulador Android com o `dev@`
(staging) antes do próximo: caminho feliz, vazio, erro, fonte grande, valores ocultos, tema escuro.
Commit por ponto. Nada em produção sem pedido.
