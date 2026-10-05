# F19 iOS (iPhone 17 Pro, staging, dev@) - marcos e identidade visual das metas

Bundle novo comprovado: o formulario da meta tem Marcos, Icone e Cor (02/03/07). Meta criada por mim: "QA F19 iOS meta".

| Caso | Resultado | Evidencia |
|---|---|---|
| 1. Criar com icone (Casa) e cor (Oceano); sugestao 25/50/75% ao criar; adicionar marco em valor R$ 900; card com anel+icone e "Proximo marco: R$ 250,00 - faltam R$ 250,00" | PASSA | 03-marcos, 05-marco900, 07-icon-color, 08-card-created |
| 2. Guardar R$ 600 (cruza 25% e 50%): estado e "Proximo marco: R$ 750,00 - faltam R$ 150,00" | PASSA (estado). Momento de celebracao (escala + haptico) NAO observado: acontece em onSuccess junto do fechamento da folha, que cobre o anel; haptico nao verificavel no simulador | 16-retirar-sheet (mostra R$ 600 antes de retirar) |
| 3. Reabrir (terminate + relancar + deep link): sem celebracao nova | PASSA (video de 5 s, anel parado, mesma escala; frames conferidos) | 14-reopen |
| 4. Retirar R$ 400 (-> R$ 200): proximo marco volta a R$ 250,00 (faltam R$ 50,00); depois +R$ 100 (cruza 25% de novo) | PASSA (estado: 200 -> "Proximo marco R$ 250,00 faltam R$ 50,00", depois 300 -> "Proximo R$ 500,00"). Nova celebracao nao capturada pelo mesmo motivo do caso 2 | 20-after-withdraw, v4-strip (video) |
| 5. Alvo para R$ 800: marco 900 "Acima do alvo: nao aparece na meta" com Apagar; % recalculam (31,3 / 62,5 / 93,8); marco repetido bloqueia Salvar ("Tem marco repetido."); marco no alvo bloqueia ("O marco precisa ficar abaixo do alvo."); alvo baixado salvo | PASSA | 24-edit-800, 25-acima, 26-duplicado, 27-no-alvo, 29-saved-800 |
| 6. Meta sem marcos: sem linha "Proximo marco" (a minha, apos apagar os 3; e "Troca do notebook" sem marcos) | PASSA | 36-sem-marcos |
| 7a. Ocultar valores: linha do proximo marco some | PASSA | 31-oculto |
| 7b. Escuro + accessibility-large: sem corte, texto quebra, anel centrado | PASSA | 33-large-cards, 34-dark-large |
| 7c. Reduzir movimento: celebracao so fade+haptico | NAO VERIFICADO: defaults ReduceMotionEnabled=1 gravado no simulador, mas nao ha prova de que o app leu; a celebracao ficou coberta pela folha. Cruzamento 300->500 feito com o video. | v5-strip |

## Criado
- Meta "QA F19 iOS meta" (alvo final R$ 800,00, icone Casa, cor Oceano). Marcos: criados 250/500/750 (25/50/75%) + 900; no fim todos apagados (0 marcos).
- Aportes (todos na conta Poupanca, via "Ja esta na conta" / "Liberar", ou seja, SEM transferencia, sem transacao em transactions): +600 (Guardar), -400 (Retirar > Liberar), +100, +200. Saldo final da meta: R$ 500,00.
- A tentativa de Retirar com conta "Sem origem" nao fez nada (nenhum registro).
- Nenhuma outra meta tocada. Existe "QA F19 Android meta" criada pelo outro agente (nao mexi).

## Defeitos / observacoes
1. (Visual, possivelmente anterior a F19) Com accessibility-large + Reduzir movimento na primeira entrada em /finance/goals apos relancar, o primeiro card de meta ficou desenhado POR CIMA do card "Menor disponibilidade/Simular juntas" (frames: plano 457-879, card em 495); nao sumiu em 5 s. Ao reabrir a tela, o layout veio correto. Pode ser entering/layout animation com Reduce Motion. (32-dark-large e 34-dark-large mostram o overlap)
2. Retirar > Liberar com "Sem origem" deixa o botao Retirar ativo e o toque nao faz nada, sem mensagem (verificar se e intencional).
3. Preview da folha ("Separado para esta meta: R$ 300 -> R$ 400") reavalia sobre o valor ja gravado durante o fechamento (transitorio, sem efeito no dado).
4. Salvar aporte demorou ~3,5 s (botao em loading) no staging.

## Runner
- Segmented (Guardar/Retirar, Cada um/%) nao aparece na arvore do idb: toquei por coordenada.
- Celebracao e haptico nao capturaveis por screenshot/video de 10 fps: a folha fecha no mesmo instante.
- Tema do app era "light" (AsyncStorage theme-mode); para o escuro editei o manifest.json do AsyncStorage do simulador e restaurei "light".

## Restaurado
appearance=light, content_size=large, ReduceMotionEnabled=0 (era 0), conceal=0 (visivel), theme-mode=light.
