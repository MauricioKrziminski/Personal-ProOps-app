# F21 Android (emulator-5574) — resultado do QA nativo

Bundle novo confirmado: Finanças sem movimento mostra "Começar as finanças" (04). Staging, usuário qa-f21-android@proops.local. Originais em /private/tmp/proops-f21-native/android/.

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 1 | Entradas + "Passo 1 de 4" | PASSA parcial: estado vazio de Finanças abre o passo 1 e mostra "Passo 1 de 4". Entrada pelo passo "Cadastrar conta ou cartão" da Hoje NÃO verificada (o checklist não foi aberto antes de existirem contas) | 04, 05 |
| 2 | "Agora não" | PASSA: fecha, Finanças segue com "0 contas" | — |
| 3 | Conta principal (QA F21 Conta, corrente, 0,00) | PASSA: vai ao passo 2. Defeito D1: o passo 1 volta a ficar interativo (Salvar ativo, nome preenchido) por cerca de 1 s antes do passo 2 | 08-seq3, 09-passo2 |
| 4 | Force-stop no passo 2 e reabrir | PASSA: volta no passo 2; Contas mostra só 2 registros (sem conta duplicada) | — |
| 5 | Cartão sem conta pagadora | PASSA: o seletor traz "Escolher na hora de pagar" (é a opção sem conta); com ela o cartão salvou e foi ao passo 3. Não exigiu conta. Fecha 3, vence 10 | 12-seletor |
| 6 | Passo 3 Pular, resumo, Lançar, Abrir Finanças | PASSA: resumo com conta (R$ 0,00) e cartão; "Lançar" abre o formulário com "QA F21 Conta" em Conta (nada salvo, fechado pelo ✕, volta ao resumo); "Abrir Finanças" vai a Finanças | 15, 17 |
| 7 | Duplo toque em Salvar / outra conta | NÃO VERIFICADO: com cartão criado o resumo não oferece caminho para outra conta ("Adicionar outra conta" só existe no passo 2) | — |
| 8 | Arquivar a conta e reabrir o link | PASSA com observação: o resumo não mostra a conta arquivada e nada foi recriado, mas o link cai no PASSO 1 (form vazio) mesmo com o cartão ativo e sem o cartão aparecer (D3). A conta foi desarquivada depois, o link voltou ao resumo | 22 |
| 9 | Escuro + font_scale 1,3 + densidade 560 (384dp) | PASSA no resumo (passo 4): sem corte, "vence dia 10" quebra e deixa o "10" sozinho na linha (estético). Passos 1 a 3 NÃO verificados nesse cenário | 24 |
| 10 | dev@ abre o link | PASSA: abre no resumo com as contas existentes, nada criado. D2 abaixo | 25 |

## Defeitos
- D1 (baixa): após Salvar no passo 1, o formulário reaparece pronto para uso (nome ainda preenchido, Salvar ativo) por cerca de 1 s antes do passo 2. Dá margem a toque duplo e passa a impressão de que não salvou.
- D2 (baixa): para quem já tem contas, o resumo se chama "Criado" e lista todas as contas e cartões, sem "Ver mais" (dev@ tem mais de 10 itens). O rótulo mente para contas pré-existentes e a lista cresce sem limite.
- D3 (baixa/média): com a única conta corrente arquivada e um cartão ativo, o fluxo volta ao passo 1 sem sinal do cartão existente.
- D4 (cosmético): "Salvar", "Agora não", "Pular", "Abrir Finanças" e "Lançar" são pílulas compactas alinhadas à esquerda, não largura total. Pode ser intencional; conferir com o design.

## Não verificado
Entrada pela Hoje; duplo toque em Salvar; passos 1 a 3 no cenário escuro/1,3/560; Reduzir movimento (não pedido nos casos); iOS; queda de rede após salvar; troca de workspace; saldo negativo.

## Ambiente restaurado
Modo noturno: não; font_scale: 1.0; densidade: 480; animações 1/1/1 (nunca alteradas). App logado como dev@proops.local. Nada apagado do banco; ficaram a conta "QA F21 Conta" (desarquivada) e o cartão "QA F21 Cartao" do usuário QA, para limpeza por ID.

## Reconferência (05/10/2026, emulator-5574, staging)

Bundle novo provado: dev@ abre o link no resumo "Suas contas" (antes "Criado"). PNGs `recheck-*.png` nesta pasta; originais e vídeos em /private/tmp/proops-f21-native/android/.

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | dev@ abre o resumo "Suas contas" | PASSA. Lista exatamente 20 itens, então "Ver mais" não aparece (limite de 20 não excedido); "Ver mais" em si NÃO exercitado | recheck-01, recheck-02-vermais |
| 2 | qa-f21-android@ sem contas: link abre no Passo 1 | PASSA ("Passo 1 de 4", form vazio) | recheck-03-passo1-qa |
| 3 | Salvar "QA F21 Conta" (corrente, 0,00): D1 | PASSA. Do toque até o fim da gravação (~6 s) o Passo 1 fica parado: campos esmaecidos e botão em carregamento, nunca volta interativo, nunca aparece "Passo 4 de 4"; ao terminar abre o Passo 2. Limite: o salvar levou mais de 6 s no staging, e a gravação acabou antes do quadro exato da troca para o Passo 2 (confirmado por captura logo depois) | recheck-05b-quadros-passo1, recheck-04-passo2 |
| 4 | Toque duplo rápido em Salvar do cartão "QA F21 Cartao" (fecha 3, vence 10) | PASSA. Botão em carregamento após o primeiro toque, foi ao Passo 3; consulta somente leitura no staging: 1 conta + 1 cartão do usuário, sem duplicata | recheck-06b-quadros-cartao, recheck-07-passo3 |
| 5 | Sair e entrar de novo como dev@ | PASSA (Hoje do dev@ carregando, selo 9+) | — |

Observações: o salvar demorou ~6 s (conta) e ~25 s (cartão, "Saldo ... · atualizando") no staging. `adb input text` perde caracteres em campos do app (nome saiu "QA F21 C"; senha precisou de digitação por tecla) — artefato da ferramenta, não do app. Ficaram no staging "QA F21 Conta" e "QA F21 Cartao" do usuário qa-f21-android@, para limpeza por ID. Ambiente: font/densidade/animações inalterados.
