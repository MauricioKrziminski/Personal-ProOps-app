# F19 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

A meta ganha **ícone** e **cor** (a paleta das notas) e **marcos** editáveis em valor ou percentual
(sugestão de 25/50/75% ao criar). O card mostra o anel com o ícone e "Próximo marco: R$ X · faltam
R$ Y". Um aporte ou alocação confirmado que atravessa um marco celebra uma vez no anel (escala e
háptico; com Reduzir movimento, só o halo); abrir a tela, puxar para atualizar e o Realtime não
celebram, e uma retirada que desce abaixo do marco o devolve a "a seguir". Baixar o alvo guarda os
marcos acima dele como "Acima do alvo" (com Apagar), sem mexer no histórico.

## Banco

- `20261005170000_goal_milestones.sql` (escrita como `20261005130000`, renomeada na integração):
  `goals.icon`/`goals.color` (check contra as 8 cores), `goal_milestones` (unique por meta e
  valor, cascata, RLS por espaço, sem UPDATE para o app), gatilho que força o espaço da meta e
  recusa marco no alvo ou acima dele. Ajustes da revisão: o gatilho revoga de todos os papéis, e o
  teste prende que baixar o alvo não apaga nem recusa os marcos.
- `goal_milestones`, os seis outros testes de metas e `anon_sem_execute` passaram depois do push.

## Código

Correção do QA: a celebração tocava no sucesso do aporte, com a folha ainda descendo por cima do
anel — nos dois aparelhos ninguém a viu. Agora ela toca depois da descida da folha. Conferido em
vídeo no iPhone: o anel cresce e volta logo depois que a folha sai
(`evidence/ios/celebracao-depois-tira.png`). `npx tsc --noEmit`, `npx expo lint` e `npm test`
(2322) com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | Criar com ícone, cor e marcos (25/50/75% + um em valor), próximo marco no card, aporte e retirada movendo a etapa, sem celebrar de novo ao reabrir, alvo reduzido com "Acima do alvo" e recálculo dos %, marco repetido ou no alvo travando o Salvar, sem marcos sem linha, ocultar valores, escuro + fonte grande. Celebração conferida em vídeo depois da correção. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 6/6 nos mesmos casos; com animações em 0 o anel não se move. [Resultado e capturas](evidence/android/) |

Oráculo: as duas metas de QA apagadas por ID (aportes, movimentos, alocações e marcos foram em
cascata); as metas existentes, os aportes delas e o caixa iguais à linha de base.

## Limites

- Salvar a meta e sincronizar os marcos são duas escritas: se a segunda falhar, a meta fica sem
  os marcos e salvar de novo esbarra no nome único.
- O tempo até celebrar é fixo (a descida da folha); o háptico não é verificável no simulador; o
  halo de Reduzir movimento não foi visto em vídeo.
- No iPhone, com fonte grande e Reduzir movimento, a primeira entrada em Metas depois de relançar
  desenhou o primeiro card por cima do bloco de cima; reabrir a tela corrigiu (entrada da tela,
  anterior ao F19).
- `useGoalMilestones` lê os marcos de todas as metas numa consulta (sem teto por meta).
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push ou tag.
