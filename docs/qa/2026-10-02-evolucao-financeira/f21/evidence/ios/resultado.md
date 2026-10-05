# F21 "Começar as finanças" - QA nativo iOS

iPhone 17 Pro (simulador, iOS 26.5), `com.proops.personal.dev`, staging, Metro 8081 existente. Usuário `qa-f21@proops.local` (sem contas) e depois `dev@proops.local`. Originais em `/private/tmp/proops-f21-native/ios/` (inclui `caso3.mp4`).

Bundle novo provado: Finanças sem movimento mostra "Começar as finanças" (`01-financas-vazio.png`).

## Casos

| # | Caso | Resultado | Evidência / observação |
|---|---|---|---|
| 1 | Entradas + "Passo 1 de 4" | PASSA | Estado vazio de Finanças e passo "Cadastrar conta ou cartão" da Hoje abrem a mesma tela, "Passo 1 de 4" (`01`, `05`, `02`) |
| 2 | "Agora não" | PASSA | Fecha e volta a Finanças; nenhuma conta criada (confirmado depois: o resumo só lista o que foi criado nos casos 3, 5, 6) |
| 3 | Conta principal -150,00 | PASSA com defeito (D1) | Saldo negativo se faz pelo seletor "Positivo / No vermelho" (só em conta corrente); o campo mostra `150,00` sem sinal. Salvar leva ao passo 2; o passo 1 não reaparece, mas passa um quadro do passo 4 (D1). Vídeo `caso3.mp4`, quadros `caso3-flash-passo4.png`, `caso3-sequencia-quadros.png` |
| 4 | Fechar o app no passo 2 | PASSA | terminate + launch + link: volta no "Passo 2 de 4"; o resumo final mostra só as 3 contas (nenhuma duplicada) (`10`) |
| 5 | Outra conta "QA F21 Dinheiro" (Dinheiro, 0,00) | PASSA | Cria e volta ao passo 2. Dinheiro não mostra "No vermelho" (`12`). Nota D3 |
| 6 | Cartão | PASSA com desvio de nome | Fecha 3, vence 10, limite 1.000,00; "Conta que paga" já veio com "QA F21 Conta" (`14`). Salvar leva ao passo 3 (`15`). Nome ficou **"QA F21 Cartao"** (sem til, ver Limitações) |
| 7 | "Lançar agora" | PASSA | Abre "Novo lançamento" com Conta = QA F21 Conta; ✕ sem salvar volta ao Começar no "Passo 4 de 4" (`16`, `17`) |
| 8 | Resumo | PASSA | QA F21 Conta -R$ 150,00 / QA F21 Dinheiro R$ 0,00 / QA F21 Cartao "Cartão · fecha dia 3 · vence dia 10"; sem "Adicionar cartão"; "Abrir Finanças" vai a Finanças (`17`) |
| 9 | Arquivar Dinheiro e reabrir | PASSA | Arquivada em Contas (deslize + confirmar, "Arquivadas · 1"); o link mostra só Conta e Cartao, nada recriado (`19`) |
| 10 | Escuro + accessibility-large + Reduzir movimento | PASSA parcial | Resumo em escuro (tema do app em Escuro) e fonte grande: sem corte, título quebra em 2 linhas, botões inteiros e tocáveis (`20` claro+grande, `24` escuro+grande). Formulários do Começar (passos 1-3) NÃO verificados nessas condições, e Reduzir movimento ligado mas sem como observar a transição (ver Não verificado) |
| 11 | dev@ | PASSA | Link abre direto no "Passo 4 de 4" com as contas existentes do dev@ (Nubank, cartões, Poupança etc.), nada criado; a Hoje não tem mais o passo de contas, só "Próximo passo" (`29`) |

## Defeitos

- **D1 (média/baixa, visual)**: ao salvar a conta do passo 1, o conteúdo passa por ~2 quadros (~0,2 s) do "Passo 4 de 4 / Criado" (resumo) antes de cair no passo 2. O passo 1 não pisca, mas o passo errado aparece. Hipótese: contas refetchadas antes de o progresso gravado chegar, então "tem conta e nada salvo" é lido como `jaTinhaContas` e vira resumo. Ver `caso3-flash-passo4.png`.
- **D2 (baixa, texto)**: para o dev@, que já tinha contas, o resumo se chama "Criado" e lista TODAS as contas (dezenas de linhas, sem "Ver mais"). O título mente (nada foi criado agora) e a lista é longa.
- **D3 (baixa, texto)**: ao tocar "Adicionar outra conta" no passo 2 a tela diz "Passo 1 de 4"; o botão vira "Voltar".
- **D4 (informativo)**: o campo de saldo mostra `150,00` sem "−" mesmo em "No vermelho"; só o seletor abaixo diz o sinal. O valor gravado aparece correto (-R$ 150,00) no resumo e em Contas.

## Não verificado

- Reduzir movimento: ligado no simulador (`ReduceMotionEnabled`) mas a transição entre passos não foi gravada com ele ligado; não dá para afirmar "sem deslize".
- Passos 1-3 (formulários) em escuro/fonte grande: o QA user já tinha contas, e "Adicionar cartão" não existe no resumo; não havia caminho para o formulário nessas condições.
- Rede caindo depois do salvar, troca de workspace, aparelho pequeno, Android, conferência no banco (nenhuma consulta feita).
- Limitações de ferramenta: `idb ui text` não digita "ã"; o nome foi "QA F21 Cartao " (com espaço final, enviado pela sugestão literal; o autocorreto tinha virado "Cartagena" e foi apagado). Clipboard do simulador não funcionou.

## Registros para a limpeza (por nome; IDs não aparecem na UI)

Contas do QA user: "QA F21 Conta" (corrente, saldo inicial -150,00), "QA F21 Dinheiro" (dinheiro, 0,00, **arquivada**), "QA F21 Cartao" (cartão, fecha 3, vence 10, limite 1.000,00, conta que paga = QA F21 Conta). Nenhuma transação criada (o "Lançar agora" foi fechado sem salvar). O usuário também concluiu o onboarding tocando botões às cegas (nome possivelmente em branco) durante o login. Nada apagado do banco.

## Estado final do aparelho

Aparência light, content_size large, ReduceMotionEnabled 0 (valores originais); tema do app voltou a "Claro". App logado como dev@proops.local.

## Reconferência (05/10/2026, após a correção do D1/D2)

Mesmo simulador e Metro. Vídeos/originais em `/private/tmp/proops-f21-native/ios/` (`recheck.mp4`, `recheck2.mp4`). Quadros a 30 fps.

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | Bundle novo: resumo de quem já tinha contas | PASSA | dev@ abre em "Passo 4 de 4" com o título **"Suas contas"** (D2 corrigido). Tem exatamente 20 contas, então "Ver mais" não aparece (correto; o corte em 20 não foi exercitado com mais de 20) - `recheck-01.png` |
| 2 | Login qa-f21 sem contas | PASSA | Progresso salvo apontando para ids inexistentes: o link abre no "Passo 1 de 4" - `recheck-02-passo1.png` |
| 3 | Salvar "QA F21 Conta" (corrente, 10,00) | PASSA (D1 corrigido) | Quadros a 30 fps do Salvar: Passo 1 até o quadro em que o Passo 2 aparece, sem "Passo 4 de 4", sem "Criado" e sem volta ao Passo 1 - `recheck-03-passo1-preenchido.png`, `recheck-06-quadros-salvar1.png` (15 quadros consecutivos, cabeçalho) |
| 4 | Salvar "QA F21 Cartao" (fecha 3, vence 10) | PASSA | Passo 2 → Passo 3 direto; só há o cruzamento de opacidade entre as folhas dos passos 2 e 3, nenhum outro passo - `recheck-07-quadros-salvar2.png`, `recheck-05-passo3.png` |
| 5 | Escuro + accessibility-large + Reduzir movimento, Passo 3 "Pular" → Passo 4 | PASSA parcial | Passo 4 com título "Criado" (correto, as contas foram criadas agora), conta e cartão listados, título quebra em 2 linhas, sem corte. Em fonte grande com tema Claro do app: `recheck-09-passo4-escuro-grande.png`; com tema Escuro do app: `recheck-10-passo4-escuro.png`. Passo 3 em fonte grande: `recheck-08-passo3-escuro-grande.png` (ainda com o tema Claro do app; o escuro só foi ligado depois, no Passo 4). Reduzir movimento ligado, mas a transição não foi observada com ele (sem como medir pela gravação); o botões de baixo ficam parcialmente atrás do toast de dev "Open debugger" |
| 6 | Voltar ao dev@ | PASSA | Sair + "Entrar como teste (dev)" abre a Hoje do dev@ |

Observações: o formulário do Passo 2 com teclado deixa "Salvar" abaixo da dobra (precisa rolar); isso não é regressão. O primeiro login do qa-f21 pediu "Save Password?" do iOS (dispensado).

Restaurado: aparência light, content_size large, ReduceMotionEnabled 0, tema do app "Claro" (`recheck-11-tema-restaurado.png`), logado como dev@proops.local. Registros criados no staging pelo qa-f21: "QA F21 Conta" (corrente, 10,00) e "QA F21 Cartao" (fecha 3, vence 10, sem limite), nada apagado.
