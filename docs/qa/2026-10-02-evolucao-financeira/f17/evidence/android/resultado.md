# F17 Android (emulator-5574, dev@proops.local, staging) - 05/10/2026

| Caso | Resultado | Evidência |
|---|---|---|
| 1 (i) Painel Finanças (Resultado do ciclo), Período 11/09 a 10/10/2026 = tela | PASSA | 02-painel.png |
| 1 "Ver o que fecha o ciclo" abre Detalhe do ciclo, mesmo período 11/09 a 10/10 | PASSA | 03-ciclo.png |
| 1 (i) Por que mudou? (períodos 11/09-10/10 contra 11/08-10/09) | PASSA | 05-porque-sheet.png |
| 1 (i) Orçamentos (11/09 a 10/10, igual ao chip da tela) | PASSA | 06-orc-sheet.png |
| 1 (i) Saúde financeira (05/07 a 05/10/2026; a tela não mostra datas para comparar) | PASSA | 08-saude.png |
| 1 (i) Reserva de emergência (com Qualidade "Estimado") | PASSA | 09-reserva.png |
| 1 (i) Projeção (05/10/2026 a 03/01/2027 = hoje + 90 dias da tela) | PASSA | 11-proj.png |
| 1 (i) Investimentos | NÃO TESTÁVEL | 10a.png: staging sem conta de investimento, a seção mostra estado vazio sem (i) (esperado pelo contrato) |
| 1 (i) Planejado × realizado | NÃO TESTÁVEL | 07-plan.png: só aparece com plano salvo; não há plano e salvar seria escrita |
| 2 Fatura inexistente via deep link: "Isto não existe mais" + "Ver faturas" (leva à lista) | PASSA (lento) | 12-fatura-ausente.png, 12b-faturas-lista.png |
| 2 Lançamento inexistente: "Isto não existe mais" + "Ver lançamentos" (leva à lista) | PASSA (lento) | 13-tx-ausente.png, 13b-tx-lista.png |
| 3 Deep link com id real | PULADO | logcat não expõe ids. Fatura real aberta pelo app: 15-fatura-real.png (abre normal) |
| 4 Perfil > Alertas: toque em "Fatura de cartão vencendo" e "Conta a vencer" | PASSA PARCIAL | 16-alertas.png, 17-alerta-fatura.png (abre Cartões), 18-alerta-conta.png (abre Hoje). Os alertas do staging são antigos (ref não uuid), então caem no alvo de lista de antes; o alvo item não foi exercitado. O toque marcou 2 alertas como lidos |
| 5 Escuro + font_scale 1.3 + valores ocultos: sheet do painel e da reserva sem dinheiro nem corte | PASSA | 20-dark-f13-oculto.png, 21-dark-f13-reserva.png |

## Defeitos / observações
- Latência: a tela de item ausente fica em skeleton 20 a 35 s antes de "Isto não existe mais" (provável retry da consulta + emulador lento). Em dispositivo real vale conferir; o contrato diz "nunca skeleton infinito" e aqui termina, mas é longo.
- Nenhum (i) ausente nos blocos que têm número. Os cartões Projeção/Orçamentos da home de Finanças são atalhos de navegação, sem (i) (o (i) está dentro das telas).

## Runner
- `uiautomator dump` e screenshots atrasam muito (emulador lento); alguns dumps vieram da tela anterior, usei o screenshot como verdade.
- Mudar font_scale reinicia o app (~60 s até hidratar).
- Restaurado: night no, font_scale 1.0, valores visíveis, stayon false.
