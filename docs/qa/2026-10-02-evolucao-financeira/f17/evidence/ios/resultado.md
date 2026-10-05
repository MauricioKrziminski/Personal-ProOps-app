# F17 nativo iOS (iPhone 17 Pro, iOS 26.5, `com.proops.personal.dev`, dev@, staging)

Bundle novo provado: o (i) "Como é calculado: <indicador>" aparece ao lado dos títulos.

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 1a | (i) Saúde financeira: Período 05/07/2026 a 05/10/2026 (janela da RPC), regra em uma frase | PASSA | 02-saude-sheet.png |
| 1b | (i) Reserva de emergência: saldos de 05/10/2026, qualidade "Estimado" | PASSA | 03-reserva-sheet.png |
| 1c | (i) Investimentos | NÃO EXERCITADO: staging sem conta de investimento ("Nenhuma conta de investimento"), sem (i) | 04-networth-scrolled.png |
| 1d | (i) Orçamentos: 11/09/2026 a 10/10/2026 = linha "De 11/09/2026 a 10/10/2026" da tela | PASSA | 05-budgets.png, 06-budgets-sheet.png |
| 1e | (i) Projeção: De 05/10/2026 a 03/01/2027 | PASSA com ressalva (D1) | 07-forecast-sheet.png |
| 1f | (i) Resultado do ciclo + "Ver o que fecha o ciclo" abre Detalhe do ciclo 11/09 a 10/10, mesmo +R$ 26.035,13 | PASSA | 08-financas.png, 09-ciclo-sheet.png, 10-ciclo-lista.png |
| 1g | (i) Planejado × realizado (planejador) | NÃO EXERCITADO: só aparece com plano salvo, e criar plano é escrita; sem plano não há (i) | 14-planner.png |
| 1h | (i) Por que mudou: períodos 11/09 a 10/10 contra 11/08 a 10/09 | PASSA | 11-why.png, 12-why-sheet.png |
| 2 | (i) ausente sem número (investimentos vazio; planejador sem plano) | PASSA | 04-networth-scrolled.png, 14-planner.png |
| 3a | Histórico de alertas: toque abre lista de Faturas (refs seed são "demo-N", não uuid) | PASSA (cai na lista) | 15-alertas.png, 16-alerta-fatura.png |
| 3b | Push real: banner/toque | NÃO EXERCITADO: simulador não registra push (`useRegisterPush` recusa fora de aparelho; nenhum banner com `simctl push`, app em 1o e 2o plano) | 17-push-banner.png, 17b-banner.png, 17c-bg.png |
| 3c | Deep link ao item (substituto): fatura uuid real e lançamento uuid real, quente e frio | PASSA | 18-invoice-warm.png, 19-tx-warm.png, 24-invoice-cold.png |
| 4 | uuid inexistente: "Isto não existe mais" + botão (Ver faturas / Ver lançamentos), quente e frio; botões levam às listas | PASSA | 20-invoice-missing.png, 21-tx-missing.png, 22-ver-lancamentos.png, 23-ver-faturas.png, 25-tx-missing-cold.png |
| 5 | ref não uuid: na tela do app só via histórico (refs "demo-N" caem na lista de Faturas, ver 3a); `routeFor` com ref inválido não exercitado via push | PASSA parcial | 16-alerta-fatura.png |
| 6 | Escuro + accessibility-large + valores ocultos: Resultado do ciclo, Reserva, Projeção, Orçamentos: título quebra em 2 linhas, texto rola, sem corte, sem valor em R$ nas sheets, fundo ilegível não | PASSA | 26-dark-large-hidden-ciclo.png (tema do app era Claro, ainda claro), 29/30/31/32 |

## Defeitos
- D1 (baixo): Projeção. O (i) diz "até 03/01/2027" e a tela diz "A projeção vai até 02/01/2027" (forecast.tsx usa `dias - 1`). Um dia de diferença entre explicação e tela.
- D2 (cosmético, a confirmar): o botão do ciclo na sheet se chama "Ver o que fecha o ciclo", o contrato prevê "Ver os itens". Funcional.

## Problemas do runner
- Push não testável no simulador; deep link `com.proops.personal.dev://` usado no lugar (testa só as telas de destino, não `routeFor` nem o listener).
- Tema do app era "Claro" fixo, então `simctl ui appearance dark` não escurece; foi preciso ligar "Escuro" no Perfil.
- Tocar alerta no histórico pode marcar como lido (estado de alerta, não financeiro).
- Nenhum registro financeiro criado; ids de fatura/lançamento lidos via REST com o login dev.

## Restaurado
appearance light, content_size large, tema do app Claro, valores visíveis.
