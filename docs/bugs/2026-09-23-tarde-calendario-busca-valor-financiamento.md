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

## 3. O valor da fatura desce e quebra a linha

**Sintoma.** Na face do cartão (Financeiro), o valor da fatura parte em duas linhas.

**Prova.** A 520dpi e fonte 1,3: "R$ 1.423,0" / "0" (`3-antes-fatura-quebrada-375dp-1.3.png`).
A face é desenhada numa largura fixa (340dp, escalada), então a fonte maior tira espaço do número.

**Causa raiz.** `Money` (`src/components/ui/money.tsx`) confia em `flexShrink: 0` para "número
não quebra". Isso só vale numa LINHA em que o irmão cede. Na face, o `Money` é filho de uma
COLUNA (`fatura`, `flex: 1, minWidth: 0`), e o texto é medido na largura do pai: sem limite de
linhas, ele quebra no meio dos dígitos. Qualquer `Money` dentro de uma coluna estreita (tile,
card, célula) tem o mesmo modo de falha.

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

- **5. Onboarding**: pesquisa de referências e direções em aberto. Ver seção própria abaixo
  quando decidido.
- **6–10. Financiamento**: o cronograma (`private.debt_schedule_for`) ancora a próxima parcela
  em HOJE/`due_day`, sem âncora futura (6). `useDebts` filtra `archived` e não há caminho de
  volta (7). `transactions.debt_id` é `on delete set null`, e o `tg_transactions_debt_payment`
  recusa desvincular pagamento, então apagar uma dívida com pagamento registrado falha hoje (8).
  A edição não manda `installments_paid` (só no criar) e `tg_debts_calculation_mode` barra o
  contrato de parcela fixa com pagamento registrado (10).
- **11. Botão só texto**: `ghost` é o par do primário (Cancelar/Salvar, "Reenviar código"). O
  defeito é o `ghost` sozinho fazendo papel de "abrir mais", como o "Adicionar detalhes
  (opcional)" de `debts.tsx`.
- **12. Ver mais → Planejamento**: resposta com argumento na seção própria.

Visto e não perseguido (fora do lote): o LogBox "Can't perform a React state update on a
component that hasn't mounted yet" no login do Android.

---

## Como cada um foi validado

| # | teste automatizado | no aparelho |
|---|---|---|
| 4 | — (é o `hitTest` nativo; não há o que simular em `node --test`) | iOS: toque no Valor → teclado numérico, borda de foco, "45,99" digitado; também dentro do Sheet de Dívidas ("1.500,00"), e com partida a frio tocando pelo rótulo. Android: "1.234,56" sem o fantasma do input à direita (ele existia antes, com 0,01, e sumiu com o texto na cor da caixa). |
| 3 | | |
| 2 | | |
| 1 | | |
