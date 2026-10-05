# F14 — QA nativo iOS (iPhone 17 Pro, `com.proops.personal`, staging, Metro 8081)

Prova de bundle novo: "Planejar por percentual" existe no menu do cabeçalho de Orçamentos (`02-menu.png`).

| # | Caso | Resultado | Screenshot |
|---|------|-----------|------------|
| 1 | Estado vazio: renda-base primeiro; sugestão "Entrou R$ 20.250,00 em setembro (lançado, inclui previsto). Toque para usar." | PASSA (só aparece quando o período tem renda; em outubro/ciclo não aparece) | 03-planner-empty, 19-income-suggestion |
| 2 | Base R$ 10.000; casa 30% = R$ 3.000, eletrônicos 15% = R$ 1.500 (servidor); 2º grupo; "Não distribuído"; soma 99,99 / 100 / 100,01 | PASSA (99,99 -> não distribuído 0,01% R$ 1,00; 100 -> 0%; 100,01 -> erro "A soma dos percentuais é 100,01%: passa de 100%", "Passa de 100% em 0,01%", Salvar plano desabilitado) | 05-plan-built, 06-sum-9999, 07-sum-100, 08-sum-10001 |
| 2b | Percentual 520 numa linha | PASSA ("Informe o percentual de contas (0 a 100%)") | (texto na árvore) |
| 3 | Mesma categoria em dois grupos | PASSA ("A categoria casa aparece em mais de uma linha.") | 04-duplicate |
| 4 | Salvar e reabrir persiste; comparação planejado × realizado com denominador | PASSA ("Plano salvo (versão 1)", reabre com 30/15/20/30; "Realizado: 12,4% da renda que entrou, R$ 20.250,00 (R$ 2.510,00 gastos)" = 2.510/20.250; sem renda: "sem renda lançada neste período") | 10-after-save, 11-compare, 12-reopen, 18-sept-comparison |
| 5 | Aplicar aos limites padrão: antes -> depois + conflito; aplicar | PASSA (casa 2.340 -> 3.000; eletrônicos 1.730 -> 1.500; contas sem limite -> 2.000; lista refletiu). Rollover: NÃO VERIFICADO (nenhum desses limites tinha rollover visível) | 13-apply-preview, 14-applied |
| 6 | Aplicar só no mês (outubro) | PASSA (outubro: casa 2.400, eletrônicos 1.200, contas 1.600; setembro continua 3.000/1.500/2.000, ou seja, override só em outubro) | 15-apply-month-preview, 16-applied-month, 20-after-base-change-sept |
| 7 | Mudar a renda-base depois (v3, R$ 20.250) não muda limites aplicados | PASSA (setembro e outubro idênticos após salvar v3) | 20-after-base-change-sept |
| 8 | Duplo toque em Aplicar aplica uma vez | PASSA (um toast "Limites aplicados em 3 categoria(s)", um limite por categoria) | 14-applied |
| 9 | Escuro + accessibility-large + valores ocultos + Reduzir movimento: editor e prévia | PASSA com ressalva (sem corte; título quebra em 2 linhas e "Salvar plano" desce uma linha; todo valor é "••••••" exceto o campo de edição da renda-base, ver defeito 1) | 22-dark-large-hidden-editor, 23-dark-large-hidden-bottom, 24-dark-large-hidden-apply, 21-dark-large-hidden-list |

## Defeitos do produto

1. **Valores ocultos: o campo Renda-base do editor mostra R$ 20.250,00 aberto** (`22-dark-large-hidden-editor.png`). Todo o resto do editor/prévia/comparação sai mascarado. Pode ser aceitável por ser campo de entrada, mas contradiz "nenhum dinheiro com valores ocultos".
2. **"Antes" da prévia no escopo "Só o mês" diz "sem limite"** quando existe limite padrão (que vale no mês). Conforme contrato (conflito só do limite do mês), mas o usuário vê "sem limite -> R$ 2.400" num mês que na prática tinha R$ 3.000 (`15-apply-month-preview.png`).
3. Barra de composição não sinaliza visualmente o estouro > 100% (só o texto vermelho) (`08-sum-10001.png`). Menor.
4. Sugestão de renda ("Entrou ...") não aparece quando o período da régua não tem renda: no ciclo de outubro o estado vazio não mostra sugestão (esperado pelo código `renda > 0`).

## Problemas do runner

- Editar `manifest.json` do AsyncStorage (tema/conceal) com o app terminado NÃO surtiu efeito; usei os controles do app (Perfil -> Tema; olho em Finanças).
- `idb ui swipe` sem `--duration` vira toque; swipes iniciados sobre o teclado digitaram no campo (alterou o nome do grupo no rascunho; o sheet foi fechado sem salvar).
- Dock/teclado e botão "Done" do teclado não aparecem na árvore do idb (toquei por coordenada).

## Estado restaurado

Aparência light, content size large, Reduzir Movimento 0, privacidade desligada (era desligada), tema do app "Claro" (era Claro quando abri o Perfil; antes da primeira edição o app já se apresentava claro).

## Alterações de dados feitas (staging, usuário dev@)

Planos salvos: versão 1 (base R$ 10.000, casa 30 / eletrônicos 15 / contas 20 / Futuro sem categoria 30), versão 2 (base R$ 8.000), versão 3 (base R$ 20.250,00).
Grupos: Essenciais (casa 30, eletrônicos 15), Estilo de vida (contas 20), Futuro (linha sem categoria 30).
Limites (antes -> depois):
- Padrão (todo mês): casa R$ 2.340 -> 3.000; eletrônicos R$ 1.730 -> 1.500; contas (sem limite) -> 2.000.
- Só outubro/2026 (override do mês criado): casa 2.400; eletrônicos 1.200; contas 1.600.
Obs.: lista inicial de outubro/ciclo antes de tudo: casa 2.340, eletrônicos 1.730, alimentação 2.000, lazer 400, transporte 600, moradia 2.580 (inalterados), contas sem limite.
