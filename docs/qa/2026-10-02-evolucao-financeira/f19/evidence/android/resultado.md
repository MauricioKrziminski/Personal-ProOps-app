# F19 Android (emulator-5574, dev build, bundle novo provado: formulario com Icone, Cor, Marcos)

Meta de teste: "QA F19 Android meta" (unica criada/alterada). Aporte: aba "Ja esta na conta" (nao move dinheiro), conta Poupanca. Retirada: "Liberar", conta Poupanca.

| Caso | Resultado | Evidencia |
|---|---|---|
| 1. Criar meta R$ 1.000, icone Aviao, cor Oceano, marcos 25/50/75% (R$ 250/500/750 mostrados). Card: anel com icone e "Proximo marco: R$ 250,00 - faltam R$ 250,00" | PASSA | 01a-form-top, 01c-icon-color, 01d-card |
| 2. Aporte R$ 600: proximo marco R$ 750,00 / faltam R$ 150,00 | PASSA (valores). Celebracao (escala/haptico): NAO CONFIRMADA visualmente, screencap muito lento | 02a-sheet, 02-after |
| 3. Sair, voltar, pull-to-refresh: sem nova celebracao, proximo marco segue R$ 750 | PASSA (so inspecao de screenshot/dump apos o retorno) | 03-reopen |
| 4. Retirar R$ 400: guardado R$ 200, proximo marco volta a R$ 250 (faltam R$ 50) | PASSA | 04a-withdraw, 04b-after-withdraw |
| 5. Editar alvo para R$ 700: marco 750 "Acima do alvo: nao aparece na meta" com Apagar; percentuais recalculam (35,7% / 71,4%); marco repetido (250 e 250) mostra "Tem marco repetido." e Salvar desabilitado; corrigido e salvo (card R$ 200 de R$ 700, 29%) | PASSA | 05a-edit, 05b-duplicate, 05c-saved |
| 6. Escuro + font_scale 1.3 + animacoes 0: texto quebra sem corte; aporte de R$ 100 (200->300, cruza 250) sem movimento no anel/icone no video; com valores ocultos a linha de marco some ("Plano oculto") | PASSA (sem movimento visto; fade da celebracao nao distinguivel no video) | 06a-dark-font, 06-celebracao-anim0.mp4, 06b-hidden |

Estado final da meta: R$ 300 de R$ 700, marcos 250/500 (+750 acima do alvo), aviao/Oceano. Aportes criados: +600, -400, +100 (conta Poupanca, alocacao "Ja esta na conta"/"Liberar").

## Defeitos
- Nenhum defeito de produto encontrado.

## Problemas do runner / limitacoes
- Emulador muito lento: `input text` perde caracteres e screencap/dump chegam atrasados; varios toques precisam ser repetidos. Celebracao (casos 2 e 6) nao capturada com nitidez. Com animacoes 1 nao foi gravado video.
- Retirar com "Sem origem" e recusado pelo app (mensagem pedindo conta); usei Poupanca.
- Ao fechar o app, o dump mostrava a tela anterior ate ~10s depois.
- Ocultar valores foi alternado na tela Financas e revertido; o estado final (eye) nao foi reconfirmado por dump apos desligar o modo escuro.
- Configuracoes restauradas: night no, font_scale 1.0, animacoes 1, stayon false.
