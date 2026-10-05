# F20 Android (emulator-5574) - resultado

Bundle novo comprovado: o menu "..." do painel de Finanças tem "Quanto vou acumular". Conta dev@, tema claro/escuro, 1344x2992.

| # | Caso | Resultado | Screenshot |
|---|------|-----------|------------|
| 1a | Abrir pelo menu do painel de Finanças | PASSA | 03-menu.png, 03b-menu-rolado.png, 04-tela-menu.png |
| 1b | Abrir pelo link em Patrimônio | PASSA | 01b-patrimonio.png |
| 2a | R$100/mês, 12 meses, 1% a.m., fim do mês = R$ 1.268,25 (aportado 1.200,00 + rend. 68,25) | PASSA | 02-fim-1268.png |
| 2b | Mesmo, início do mês = rend. R$ 80,93 (total R$ 1.280,93) | PASSA (texto "Aportado 1.200,00 · rendimento 80,93") | 02b-inicio-1280.png |
| 3 | Taxa 0, R$500 + R$100 x 36 = R$ 4.100,00, rendimento 0,00 | PASSA | 03-taxa-zero.png |
| 4 | Renda R$5.000, retirada 4% = capital R$ 1.500.000,00 | PASSA | 04-renda-capital.png, 04b-atinge.png |
| 5 | "Usar meus investimentos (R$ 26.500,00)" preenche 26.500,00 = Investimentos de Patrimônio (R$ 26.500,00); botão some depois | PASSA | 05-usar-investimentos.png, 01b-patrimonio.png |
| 6 | Comparar até 3 cenários (botão some no 3o; tabela compara; verificado 26.500 + 100 x 60 a 1% início = R$ 56.391,10 conferido à mão) | PASSA | 06-comparar-3.png |
| 7 | Fora do domínio: 8% a.m. -> "A taxa vai de -50% a +100% ao ano."; "-," -> "Use um número na taxa, como 8,5." Sem NaN | PASSA | 07a-fora-dominio.png, 07b-taxa-lixo.png |
| 8 | Force-stop + relançar: 3 cenários, cenário 3 selecionado e premissas mantidos | PASSA | 08-persistiu.png |
| 9 | Escuro + font_scale 1.3 + Reduzir movimento + ocultar valores: sem corte além do item D1, valores viram bolinhas (resultado, "em dinheiro de hoje", aportado/rendimento, tabela Comparar), rodapé de aviso presente | PASSA com ressalvas D1 e D3 | 09-dark-1.3-topo.png, 09-dark-1.3-resultado.png, 09-dark-1.3-fim.png, 09-ocultar-resultado.png, 09-ocultar-comparar.png, 09-ocultar-topo.png |

Não executado: "retirada = 0" (o teclado desalinhou o toque e digitou no campo errado); o limite de retirada ficou sem verificação nativa. Taxa negativa, inflação > retorno, 100 anos, teto: só cobertos pelos testes de unidade, não nativos.

## Defeitos

- D1 (visual, baixo): dentro do card "Premissas" os rótulos/dicas encostam na borda esquerda sem padding e o primeiro glifo é cortado ("Patrimônio", "Renda", "0 ignora a inflação", "Ex.: 4." com o "0"/"E" parcialmente cobertos). Visível em claro e escuro, 1.0 e 1.3. Ver 04-renda-capital.png, 02-fim-1268.png.
- D2 (texto): "Com as premissas de Acumular, atinge não atinge em até 100 anos." e, na tabela, "atinge não atinge em até 100 anos" (quandoAtinge devolve frase com "não atinge"). Ver 04b-atinge.png, 06-comparar-3.png.
- D3 (privacidade, baixo/médio): com "ocultar valores" ligado os campos Patrimônio inicial / Aporte / Renda continuam mostrando o valor (ex.: 26.500,00 vindo de "Usar meus investimentos"), que vaza o patrimônio. Pode ser decisão (campo de edição), confirmar. Ver 09-ocultar-topo.png.
- D4 (UX, baixo): no menu "..." de Finanças (diálogo Android) "Quanto vou acumular" e "Categorias" ficam abaixo da dobra; só aparecem rolando a lista. Ver 03-menu.png.
- D5 (UX, baixo): na tabela Comparar, em modo Acumular a linha mostra "Capital necessário ... atinge ..." e o valor à direita é "valor no fim"; sem rótulo para o número à direita.

## Problemas do runner / ambiente

- animator_duration_scale=0 deixou o app preso numa renderização parcial (Hoje sem seções, sem tab bar) mesmo após 60 s; com apenas transition/window_animation_scale=0 e animator=1 renderiza, mas a tab bar do Android não aparece (pré-existente, fora do escopo F20; navegação feita por deeplink appproops:///finance/acumulacao).
- Cada toque demora vários segundos; vários toques foram "perdidos" e o Voltar (keyevent 4) sem teclado aberto sai da tela.
- Mudar font_scale/uimode recria a Activity e volta para Hoje.
- Restaurado: night no, font_scale 1.0, animações 1, stay_on_while_plugged_in 0, valores mostrados. Cenários do F20 ficaram gravados no aparelho (3 cenários).
