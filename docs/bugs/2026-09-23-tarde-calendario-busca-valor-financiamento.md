# 23/09/2026 (tarde): calendário, busca, dinheiro, campo Valor, onboarding e financiamento

Doze queixas do dono do produto num lote só. Os quatro bugs (1–4) foram reproduzidos e tiveram a
causa raiz achada ANTES de qualquer correção. Os prints do "antes" estão em
`docs/bugs/evidence/2026-09-23-tarde/`.

Cenário do Poco X6 Pro (itens 2 e 3), reproduzido no emulador: `wm size 1220x2712`,
`wm density 520` (≈375dp). O defeito aparece com a fonte do sistema em 1,0 e piora em 1,3.

## 1. "Meu mês" só vai até o dia 28, e no iPhone a grade aparece dentro de um contêiner

**Sintoma.** No Perfil, a grade do dia de fechamento vai de 1 a 28 (Android e iOS). No iPhone,
os 28 números aparecem sobre um retângulo claro "nada a ver" que envolve a grade inteira.

**Causa raiz (contêiner).** `src/components/finance/cycle-day-picker.tsx:48`: um
`GlassBackdrop` absoluto atrás da GRADE inteira, e as células com fundo `transparent` quando há
vidro. O vidro vira uma placa atrás dos 28 botões. O padrão certo já existe em
`month-picker.tsx`: cada célula leva o próprio vidro, e a grade não leva nenhum.

**Causa raiz (28).** Não é defeito de tela, é regra do banco. A `20260911020000` pôs
`check (cycle_close_day between 1 and 28)` "para o dia existir em fevereiro". A aritmética do
ciclo mora em duas funções (`private.cycle_bounds` e `private.cycle_month_of`, conferido nas 18
funções que leem o ciclo), e só a primeira soma o dia sem limite: com 31, `cycle_bounds` de março
daria `ini = 01/02 + 31 = 04/03`. O cartão já resolve isso com `private.day_in_month` (dia 31 em
fevereiro cai no último dia). O agente repete o teto de 28 em `agent/app/tools/resources.py` e
no prompt.

**Decisão (dono do produto):** a grade vai de 1 a 31, e o 31 É o "último dia do mês" — o botão
separado saiu, porque os dois diriam a mesma coisa.

**Correção.**
- Migration `20260923140000`: `check` 1..30 (o 31 grava `null`) e `private.cycle_bounds` com
  `private.day_in_month` nos dois extremos. `cycle_month_of` não muda (o rótulo já sai certo com o
  clamp). Revisada pelo agente `migration-reviewer` (aprovada) e aplicada no STAGING.
- Grade: 1 a 31 em linhas de 7 (a última completada com espaços, senão 29–31 esticavam). As
  células são opacas, e o vidro fica só no dia escolhido. Vidro em cada uma das 31 foi medido no
  simulador e deu células pretas e claras ao acaso.
- Agente: aceita 1 a 31, e o 31 vira "último dia" (`None` + a marca que o `_preparar_mes` já
  consumia). Mensagens e prompt dizem "1 a 31".

**Auditoria das outras grades de dia.** `Calendar` (1–31, sem contêiner), a grade de meses do
`MonthSheet` (vidro por célula, certo) e os chips 1–31 + "Último dia" do lembrete: nenhuma
repete o defeito. Fechamento e vencimento de cartão e vencimento de dívida são campo de texto
1–31, não grade.

## 2. A busca corta o placeholder (Poco X6 Pro, sem fonte aumentada)

**Sintoma.** Na pílula de busca do Android, o texto aparece cortado.

**Prova.** A 520dpi e fonte 1,0, "Buscar por descrição, lugar ou categoria" ocupa DUAS linhas
dentro da pílula. A 1,3 a segunda linha ("ou categoria") sai cortada pela borda
(`2-antes-busca-cortada-375dp-1.3.png`).

**Causa raiz.** O `TextInput` de uma linha do Android não liga `singleLine` (o RN só chama
`setLines`), então o HINT quebra como texto comum, e o Yoga mede a altura com a quebra. A pílula
(`SearchField`, `minHeight: 48`) comporta duas linhas de 21dp, mas não duas de 30dp. Os dois
placeholders mais longos do app (42 caracteres) estão justamente numa busca. HIG e Material usam
placeholder de busca curto ("Buscar…").

**Hipótese testada antes da correção.** Só o placeholder de Lançamentos trocado por "Buscar
lançamentos", app recarregado a frio: a pílula volta a uma linha, centrada, sem corte.

**Correção.** Placeholder de busca cabe numa linha: "Buscar lançamentos", "Buscar recorrentes" e
"Buscar ou criar" (categoria). A régua (até 20 caracteres) virou teste no `anti-slop.test.ts`,
conferido voltando o texto antigo (o teste falha com "42 ch"), e está escrita no `SearchField`. O
"o quê" da busca já está no título da tela, e o `accessibilityLabel` continua descritivo.

## 3. O valor da fatura desce e quebra a linha

**Sintoma.** Na face do cartão (Financeiro), o valor da fatura parte em duas linhas.

**Prova.** A 520dpi e fonte 1,3: "R$ 1.423,0" / "0" (`3-antes-fatura-quebrada-375dp-1.3.png`).
A face é desenhada numa largura fixa (340dp, escalada), então a fonte maior tira espaço do número.

**Causa raiz.** `Money` (`src/components/ui/money.tsx`) confia em `flexShrink: 0` para "número
não quebra". Isso só vale numa LINHA em que o irmão cede. Na face, o `Money` é filho de uma
COLUNA (`fatura`, `flex: 1, minWidth: 0`), e o texto é medido na largura do pai: sem limite de
linhas, ele quebra no meio dos dígitos. Qualquer `Money` dentro de uma coluna estreita (tile,
card, célula) tem o mesmo modo de falha.

**Correção.** No primitivo, e só nele: `numberOfLines={1}` + `adjustsFontSizeToFit`
(`minimumFontScale 0.5`), o mesmo par que o `Segmented` já usa. Dinheiro fica numa linha e, se não
couber, ENCOLHE; nunca parte e nunca mostra reticência. `money.tsx` entrou na allowlist de
`numberOfLines` do `anti-slop.test.ts` com esse motivo. Os ~96 `<Money>` do app herdam.

## 4. No iPhone o campo Valor não aceita toque, em nenhuma tela

**Sintoma.** Tocar no Valor não abre o teclado nem deixa editar, em todos os formulários.

**Prova.** No simulador (iOS 26), `Novo lançamento`: toque em (300, 402), no centro do Valor,
e depois digitar "4500". O valor continuou "0,00" e os dígitos entraram no Título, que seguia
focado (`AXValue` do Título = "4500teste"). O `TextInput` do valor nem aparece na árvore de
acessibilidade.

**Causa raiz.** O `MoneyField` desenha os dígitos (odômetro) e põe um `TextInput` invisível por
cima para receber o toque (`styles.captura`, `field.tsx`). A invisibilidade era
`opacity: Platform.OS === 'android' ? 0.01 : 0`, desde o commit `4d752ea`. No iOS,
`RCTViewComponentView.mm:746` recusa o `hitTest` de qualquer view com `alpha < 0.01`: o input
com opacidade 0 simplesmente não existe para o toque. O comentário do código dizia o contrário
("opacidade 0 lá [Android] faz o input perder o toque"). O `OtpInput` usa o mesmo truque e só
funciona porque tem um `Pressable` em volta que chama `.focus()`.

**Correção.** `opacity: 0.02` nas duas plataformas, e o texto do input na cor da caixa
(`theme.surface`): o Android trata `color: 'transparent'` como "sem cor" e desenhava o valor
digitado como um fantasma à direita dos dígitos, mesmo antes desta correção.

**Outros campos à mão, auditados:** `QuantityField`, `DatePickerField`, `PhoneField`,
`SearchField` e `DateField` usam `TextInput`/`TextField` visíveis ou `Pressable`. Só o
`MoneyField` usa o truque do input invisível. Como ele é o caminho ÚNICO de dinheiro, corrigir
o primitivo corrige todas as telas.

## 5–12. Produto (não são bugs de código)

- **5. Onboarding**: ver a seção própria abaixo.
- **6–10. Financiamento**: ver a seção própria abaixo.
- **11. Botão só texto**: ver a seção própria abaixo.
- **12. Ver mais → Planejamento**: ver a seção própria abaixo.

## 5. Onboarding: "ninguém sabia o que existia no app"

**A queixa:** o pai do dono do produto usou o app e não sabia o que havia nele, nem como
importar a fatura. O pedido era algo "criativo e moderno".

**A causa concreta, além do onboarding:**
- Não havia caminho para importar a partir da fatura nem dos Cartões.
- A importação é do Pro, e o Free só descobria isso no fim, com o 402, depois de escolher a
  conta e o arquivo.

**A pesquisa decidiu a forma** (spec `docs/superpowers/specs/2026-09-23-onboarding-hibrido-design.md`):
- Tutorial em cartões na abertura não ensina (NN/g).
- Tour longo não é concluído (Chameleon).
- YNAB, Monarch e Revolut apresentam o recurso no lugar, um por vez.

**Decisão do dono do produto: híbrido "2 + 1".**
1. **"Primeira frase" no passo ① do onboarding.** Três exemplos tocáveis. A frase sobe num
   balão e o resultado se monta embaixo, marcado "exemplo". Nada é gravado.
2. **"Próximo passo" na Hoje.** Depois dos Primeiros passos aparece um recurso por vez, escolhido
   pelo dado real. Cada um pode ser dispensado com "Agora não".
3. **"Importar fatura" onde a fatura mora.** Está no menu da fatura e no toque longo de cada
   cartão, com a conta já escolhida. No Free, o aviso do Pro vem ANTES e ocupa a etapa, com
   "Ver planos".

**O ui-polisher achou seis coisas, todas corrigidas:**
- O "Importar fatura" dos Cartões só existia para o leitor de tela: o `PressCard` não tinha
  `onLongPress`.
- Três hápticos por toque na demonstração.
- O autoplay vibrava sem ninguém tocar.
- Um passo dispensado piscava antes de a leitura do aparelho chegar, e o card entrava depois do
  portão da Hoje, empurrando a tela.
- O aviso do Pro não tinha estado de carregamento e ficava sobre um botão que nunca liga.
- Texto dentro de `entering` sem `flexShrink: 0`.

## 6–10. Financiamento maleável

Spec `docs/superpowers/specs/2026-09-23-financiamento-maleavel-design.md`, plano
`docs/superpowers/plans/2026-09-23-financiamento-maleavel.md`.

**Causa raiz.**
- **6.** O cronograma (`private.debt_schedule_for`) ancorava a próxima parcela em HOJE/`due_day`,
  e não existia âncora no futuro.
- **7.** `useDebts` filtra `archived`, e não havia caminho de volta.
- **8.** Apagar a dívida com pagamento FALHAVA. A FK `on delete set null` dispara o
  `tg_transactions_debt_payment`, que recusa "desvincular".
- **9.** O detalhe era uma tabela de seis colunas em `footnote`, rolando na horizontal.
- **10.** A edição não mandava `installments_paid`, não existia "total a pagar", e o
  `tg_debts_calculation_mode` barrava o contrato fixo depois do primeiro "Paguei".

**Decisões do dono do produto.**
- "Total" é o total a pagar (a soma das parcelas).
- O detalhe vira uma linha do tempo.
- Com "Paguei" lançado, o contrato é liberado e recalculado.

**Correção.**
- **Migration `20260923160000`:**
  - `debts.first_due_date` ancora o contrato dentro de `debt_schedule_for`, a fonte única da
    projeção, do mês, da Hoje, do ciclo e do "E se…";
  - as travas do contrato fixo caem;
  - `delete_debt` trava a dívida e apaga pagamentos e dívida numa transação, com um desvio local
    no trigger.
  - Revisada pelo `migration-reviewer` e aplicada no STAGING.
- **Formulário:**
  - "Cada parcela | Total a pagar";
  - pagas editáveis no criar e no editar;
  - "Primeira/Próxima parcela (a Nª)" com calendário no lugar do "Vence dia";
  - "Nome e conta" numa linha que abre no lugar.
- **Lista:**
  - "Arquivadas · N" no fim, com Desarquivar e Excluir por completo;
  - arquivar mostra toast com Desfazer;
  - excluir pede confirmação e conta os pagamentos e o valor que voltam ao saldo.
- **Detalhe:** herói com anel, "Falta pagar" e "N de M pagas"; linha do tempo por ano (paga,
  estimada, próxima e futura pela forma do nó); "…" no alto com Editar, Arquivar e Excluir.
- **Agente:** `first_due_date`, contrato fixo rederivado, `resource_delete` com `trashed=true` →
  `delete_debt` (paridade em `docs/AGENTE-PARIDADE-COM-O-APP.md`).

## 11. Botão só texto, "sem nada atrás"

**Causa raiz, em duas partes.**
1. **`ghost` sozinho.** A variante `ghost` é texto puro, pensada como o PAR do primário
   (Cancelar/Salvar). Havia sete usos em que ela aparecia sozinha, sem primário ao lado:
   - "Adicionar detalhes (opcional)" (dívidas, o print);
   - "Apagar lançamento";
   - "Apagar" (lembrete);
   - "Tirar hipótese" (E se…);
   - "Pessoas" (Perfil);
   - "Mais ações" (Recorrentes);
   - "Dívidas" (lançamento de pagamento);
   - as saídas das perguntas do Agente.
2. **No iPhone, o `secondary` também virava texto.** No iOS 26 todo botão usa vidro. O
   `secondary` ia sem tinta, e o vidro regular sobre um card branco é quase branco. O "Fechar" do
   "Meu mês" e o "Gerenciar plano" liam como texto solto (visto no simulador).

**Correção.**
- **Ghosts sozinhos:** viraram `secondary` (pílula cinza). As ações destrutivas usam
  `secondary` com `tone="danger"`, uma prop nova do `Button`: rótulo vermelho, sem o vermelho
  cheio do `destructive`.
- **"Adicionar detalhes":** virou uma linha "Nome e conta" que abre no lugar e já mostra os
  valores.
- **Vidro do `secondary`:** ganhou a tinta `glassElementTint` (par claro/escuro em `theme.ts`).
- **Teste:** `anti-slop.test.ts` prende o `ghost` numa allowlist de arquivos em que ele é o par
  do primário (as telas de conta, o onboarding e o "Cancelar" das pastas), cada um com o motivo.
  Conferido: o teste falha quando o `ghost` volta ao lembrete.

## 12. "Ver mais" do Financeiro: Dívidas e Recorrentes em Planejamento?

**Resposta: não estavam no lugar certo, e Parceladas também não.** Parceladas, Recorrentes e
Dívidas são a mesma coisa para quem usa: o que já está CONTRATADO e sai sozinho todo mês, e que
a projeção já conta sem ninguém decidir nada. Planejamento é outra natureza: orçamento e meta são
ESCOLHAS para o futuro. Juntar as três em Dia a dia faria um grupo de sete linhas (a parede que
o agrupamento existe para evitar). Os apps consolidados separam as duas naturezas: YNAB põe
agendados junto do registro e "targets" no plano; Monarch e Copilot dão às recorrências uma área
própria, longe de orçamento e metas.

**Decisão do dono do produto:** grupo novo **Compromissos** (Parceladas, Recorrentes, Dívidas).
Planejamento fica com Orçamentos e Metas, e Dia a dia com Lançamentos, Contas, Cartões e
Faturas. Recorrentes ganhou subtítulo ("Salário, aluguel e assinaturas"), como os vizinhos.

Visto e não perseguido (fora do lote) — **investigado em 24/09/2026**, ver
`docs/bugs/2026-09-24-nada-pendente-listas-e-ordem.md`: o aviso do login não reproduziu em nenhum
caminho (os avisos amarelos eram o "Cannot connect to Expo CLI" do Metro em desenvolvimento), e a
barra do Android some só enquanto a Activity é recriada por troca de densidade, voltando com a tela.

---

## Como cada um foi validado

| # | teste automatizado | no aparelho |
|---|---|---|
| 4 | — (é o `hitTest` nativo; não há o que simular em `node --test`) | iOS: toque no Valor → teclado numérico, borda de foco, "45,99" digitado; também dentro do Sheet de Dívidas ("1.500,00"), e com partida a frio tocando pelo rótulo. Android: "1.234,56" sem o fantasma do input à direita (ele existia antes, com 0,01, e sumiu com o texto na cor da caixa). |
| 3 | `anti-slop.test.ts` (allowlist com o motivo) | Android 375dp × 1,3: face do cartão "R$ 1.423,00" numa linha (`3-depois-…png`), Hoje, Financeiro (tiles Entra/Sai), Cartões e Lançamentos sem quebra no meio de valor. iOS: Financeiro e face inalterados no tamanho padrão. |
| 2 | `anti-slop.test.ts` — placeholder de busca até 20 caracteres (falha com o texto antigo) | Android 375dp × 1,3: Lançamentos e Recorrentes numa linha (`2-antes/depois-…png`); digitado "gasolinapq" sem corte nas descendentes. |
| 11 | `anti-slop.test.ts` (ghost só como par do primário; falha com o `ghost` de volta no lembrete) | iOS claro: "Fechar" do Meu mês virou pílula; iOS escuro: "Gerenciar plano" + "Pessoas" pílulas; Android 384dp × 1,3: "Apagar lançamento" em pílula cinza com rótulo vermelho. |
| 12 | — | Android 384dp × 1,3: Dia a dia (4), Compromissos (3), Planejamento (2), sem quebra de título. |
| 6–10 | `supabase/tests/financiamento_maleavel.sql` (âncora a 3 meses, paga adiantada, pagas 1→10, contrato fixo editado com pagamento e o pagamento novo coerente, `delete_debt` idempotente, RLS de outro workspace, privilégio); `finance-form.test.ts` e `debt-history.test.ts` (âncora ida e volta no dia 31, total → parcela, linha do tempo); `simple-finance-ui.test.ts` (criar com data, "Total a pagar" grava parcela × N, pagas movem a âncora, editar dívida antiga sem cronograma não inventa âncora, arquivadas com Desarquivar, excluir só depois do SIM, "…" do detalhe); `pytest` do agente (1111). Revisão final (4 importantes, todos com teste que falhou antes): caso 8 do SQL — âncora + pagamento atrasado no ciclo pulava uma parcela no cronograma ("primeira linha 4ª em 2026-10-31") e `debt_paid_in_month` a escondia de `month_lines_for`/`cash_events` ("a 4ª sumiu de month_lines_for"), corrigidos na `20260923170000` (staging); dívida antiga não ganha âncora inventada ao editar as pagas; vencimento 31 não vira 28 num mês curto; agente com próxima × primeira parcela, piso das pagas nos pagamentos lançados e purge com `workspace_id` + `xmin`. Gemini real (Lite, staging): as frases novas ("a próxima parcela do carro vence dia 10/11", "já tem 10 parcelas pagas", "apaga de vez…", "desarquiva…", "a primeira vence 10/12/2026") extraídas certas; a execução que aprova `evaluate_answer_forms.py` ficou PENDENTE — o Lite do staging respondeu 503 a tarde inteira (`--secao cadastro`: 15/28, as 13 falhas são 503/erro vazio, nenhuma resposta errada). | Android 384dp × 1,3: criar "Total a pagar" R$ 70.000 / 48× com 1ª em 05/12/2026 → gravou 145833 × 48 e o cronograma começa em 05/12 (out/nov sem linha em "O mês inteiro"); editar a data → 05/01/2027 e o cronograma andou; pagas 0→2 → 3ª em 05/03/2027; com um "Paguei" lançado, pagas 3→4 gravou (saldo 44×); arquivar → toast Desfazer; Arquivadas · N → Desarquivar; excluir por completo → 0 dívidas e 0 pagamentos no banco. Detalhe em linha do tempo no Android (claro/escuro) e iOS (claro/escuro), com o "…". Dados de teste apagados pelo ID. |
| 5 | `proximo-passo.test.ts` (ordem, sem cartão, dispensado, `null`); `simple-finance-ui.test.ts`: o card só depois dos Primeiros passos, "Importar fatura" alcançável pelo toque longo do cartão (falhava sem o `onLongPress`), aviso do Pro como etapa e esqueleto enquanto o plano carrega (os dois falhavam no código anterior), `?conta=` válido pré-escolhe e inválido é ignorado. | Android 384dp × 1,3: "Primeira frase" em claro e escuro (troca de cena sem salto, "Vamos lá" alcançável rolando), card "Traga a fatura do cartão" na Hoje, toque longo no cartão → "Importar fatura" → tela "Importar" com o Nubank Cartão escolhido, e menu da fatura → idem. O Free foi conferido de verdade: o `dev@` foi passado a `free` por alguns minutos (aviso + "Ver planos" → paywall, claro e escuro) e voltou a `pro`. iOS: toque longo → action sheet com "Importar fatura" → tela com o cartão escolhido. Dados do `dev@` conferidos no fim: plano `pro`, onboarding `true`, nome e ciclo intactos. |
| 1 | `supabase/tests/mes_fecha_ate_o_31.sql` (falhava na definição antiga: "fecha 30 em 2027-02-01: deu … a 2027-03-02"; verde no staging depois da migration), mais as bordas do dia 10 inalteradas; `agent/tests/test_mes_e_rotativo.py` (29/30 passam, 31 = último dia, 0/32 recusados). Regressão no staging: `regua_e_dia_do_fechamento`, `parcela_paga_no_ciclo` e `fluxo_do_financeiro` verdes. `linha_do_tempo` já falhava por dado do staging (ciclo 11/08–10/09, que tem as mesmas bordas antes e depois). | Android 384dp × 1,3, claro e escuro: grade 1–31 em 7 colunas; escolher o 30 gravou `30` e o ciclo corrente virou 31/08–30/09; o 31 gravou `null` ("Último dia do mês", 01/09–30/09) e acende o 31 ao reabrir; workspace devolvido ao dia 10. iOS claro e escuro: sem a placa atrás da grade. Pendente: `probe_mes_vs_cartao.py` (Gemini do staging em 503). |
