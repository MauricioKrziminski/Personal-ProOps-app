# F15 "Por que o gasto mudou" - QA nativo Android (emulator-5574, dev build, bundle novo confirmado)

Dados: staging, dev@. Ciclo (11/09-10/10, atual) vs (11/08-10/09, anterior), exceto caso 4.

| Caso | Resultado | Evidência |
|---|---|---|
| 1. Abrir "Por que mudou?" (atual x anterior, diferença, contribuições) | PASSA. Out R$ 11.214,46, Set R$ 8.560,97, Diferença +R$ 2.653,49 · +31%; igual ao Total da rosca. | s2-entry.png, c1-top.png, c1-bottom.png |
| 2. Dimensões: soma das contribuições = diferença | PASSA nas 4 + subleitura. Categoria (9 linhas + 1 sem mudança, eletrônicos 780,00): delta +265349 cent; Detalhe (Sem detalhe 8.560,97 -> 11.214,46); Pagamento (7 linhas, Não informado 6.005,46 + Pix 1.863,07 + Crédito 976,02 + Boleto 818,35 + Débito 549,12 + Transf. 533,32 + Dinheiro 469,12 = 11.214,46); Tipo (Não informado 11.210,20 + Variável 4,26). Todos +R$ 2.653,49 no centavo. "Essencial ou não" também fecha (11.209,83 + 2,59 + 2,04). | c2-Detalhe.png, c2-Pagamento.png, c2-Tipo.png, c2-Essencial.png |
| 3. Toque na linha abre Lançamentos filtrado, total = linha | PASSA. Sheet "Ver em setembro/outubro". Sem categoria (+, outubro): cabeçalhos de dia 5.217,16 + 93,34 + 900,00 = 6.210,50. moradia (-, setembro): 214,30 + 1.800,00 = 2.014,30. contas (+, outubro): 128,99 + 2x1.166,67 = 2.462,33. Pagamento Pix (outubro): 1.860,66 + 2,19 + 0,22 = 1.863,07. Período mostrado e chip "Gastos · X · Gastos lançados por data, sem fatura adiada" corretos. | c3-sem-sheet.png, c3-sem-out.png, c3-sem-bottom.png, c3-moradia-set.png, c3-contas-out.png, c3-pix.png |
| 4. Régua Mês <-> Ciclo | PASSA. Em Mês: Out R$ 8.438,12, Set R$ 10.125,64, Diferença -R$ 1.687,52 · -17%; contribuições (8 linhas + eletrônicos sem mudança) somam -1.687,52; link abre 01/10/2026 a 31/10/2026. A régua fica na raiz do Financeiro (não na tela Por que), e a tela segue a escolha. Restaurado em Ciclo. | c4-top.png, c4-mes.png, c4-mes-lancamentos.png |
| 5. Escuro + fonte 1,3 + valores ocultos + animações 0 | PASSA. Sem corte: títulos quebram em 2 linhas, linhas e rodapé legíveis. Todo R$ some (••••••, content-desc "Valor oculto"), inclusive no texto de acessibilidade das linhas; "+31%" permanece (percentual, não dinheiro). | c5-root-hidden.png, c5-top.png, c5-mid.png, c5-bottom.png |

## Defeitos
Nenhum bloqueante.
- Cosmético (baixo): em fonte 1,3 o rótulo "Pagamento" do Segmented encolhe (auto-fit) e fica menor que os outros três; sem corte. Ver c5-top.png.
- Observação: a diferença oculta mostra "Diferença •••••• · +31%" - o percentual revela o sentido/ordem de grandeza; se a política for ocultar tudo, decidir. Não é regressão do contrato.

## Problemas do runner
- Bundle: primeiro launch já veio novo (entrada "Por que mudou?" presente na raiz).
- Tela 1344x2992: coordenadas dos exemplos de memória não valem; usei bounds do uiautomator. Nbsp em R$ nos content-desc (regex precisa de \s).
- Nenhum registro financeiro criado/editado/apagado; só toques de leitura.

## Estado restaurado
Modo noturno: no; font_scale 1.0; window/transition/animator scale 1; valores visíveis; régua Ciclo; stay-on false (era 0). O app foi relançado ao fim (claro).
