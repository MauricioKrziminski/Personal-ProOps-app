# Cabeçalho compacto de filtros — Implementation Plan

> **For agentic workers:** executar este ajuste sequencialmente com `executing-plans`; preservar o trabalho de entrada e filtros já existente nesta branch.

**Goal:** reduzir a poluição do cabeçalho de Lançamentos sem perder critérios, navegação de período ou cancelamento dos rascunhos.

**Architecture:** uma única entrada para a folha existente de filtros. A tela mostra o período e um resumo textual dos critérios; a contagem é derivada do mesmo objeto enviado à folha. Apenas textos fazem crossfade com `MudancaSuave`, mantendo controles interativos e vidro nativo fora do envelope animado.

**Tech Stack:** Expo SDK 57, React Native, primitivas Suave existentes, Reanimated e testes Node.

## Global Constraints

- Branch `gabriel/entrada-filtros`; alterações locais preexistentes preservadas; sem commit ou publicação solicitados.
- Sem mudanças no contrato financeiro, no filtro de situação por data, na régua mês/ciclo ou em dados do usuário.
- Sem novas dependências ou APIs Expo; reutilizar `Button`, `PeriodBar`, `ListFilters` e movimento com redução de animações.
- Antes registrado no iPhone 17 Pro, iOS 26.5, app `com.proops.personal.dev`: `/private/tmp/proops-filters-clean-before.png`. Tipo e situação repetiam a folha; conta e origem repetiam ainda o menu. Cinco faixas disputavam atenção com a lista.

## Task 1: comportamento e composição

**Files:** `src/components/ui/button.tsx`, `src/lib/button-intrinsic-ui.test.ts`, `src/lib/list-filters.ts`, seus testes, `src/components/ui/list-filters.tsx`, `src/components/ui/app-header.tsx`, `src/components/ui/icon.tsx`, `src/lib/list-filters-ui.test.ts`, `src/app/finance/transactions.tsx`, `src/lib/simple-finance-ui.test.ts`.

- [x] Testar contagem de critérios: datas juntas = 1; limites juntos = 1; zero é válido; busca vazia e seleções vazias = 0.
- [x] Testar retorno ao mês na folha: remover ambas as datas preserva busca, seleções e valores; fechar cancela, aplicar confirma.
- [x] Centralizar o objeto `ListFiltersValue`, derivar a contagem, retirar abas/chips/pílulas e submenus redundantes.
- [x] Exibir até dois critérios no resumo, indicar quantos outros foram escolhidos e conservar o rótulo acessível completo. Nomes completos quebram linha, sem reticências. Data personalizada ao lado do único botão; mês/ciclo conserva sua navegação.
- [x] Crossfade somente no período/resumo; botão usa o movimento compartilhado de pressão e mudança de cor.
- [x] Testar que aplicar vários critérios continua chegando às consultas e que só a folha edita os critérios.

## Task 2: aceitação nativa e evidências

- [x] Reiniciar somente `com.proops.personal.dev` após a implementação.
- [x] Comparar o mesmo estado do antes: intervalo 01/09–30/09 e Nubank Cartão.
- [x] Validar mês sem filtros, múltiplos critérios, texto longo, resultado vazio, cancelamento, limpeza e retorno ao mês preservando os outros critérios.
- [x] Validar claro/escuro, transições repetidas e layout de tablet no harness existente; restaurar Claro.
- [x] Executar testes, TypeScript, lint, revisão focada e `git diff --check`.
- [x] Documentar o resultado e guardar capturas novas separadas das evidências anteriores.

Comandos: `node --test src/lib/list-filters.test.ts src/lib/list-filters-ui.test.ts src/lib/simple-finance-ui.test.ts`; `npm test`; `npx tsc --noEmit`; `npx expo lint`; `git diff --check`.

## Ajuste pedido durante a validação

- Substituir os três botões de datas por um único ícone de redefinição junto ao título. Reutilizar HeaderIconButton, com háptico/pressão suave e dica acessível que informa a remoção das duas datas. O efeito permanece em rascunho até Aplicar e vale também para as outras listas.
- Corrigir Button compartilhado: a fonte nativa de acessibilidade excedia a altura rígida da cápsula. Usar altura mínima e conteúdo natural; medir a altura real para a geometria de superfície e carregamento, sem limitar a fonte. Ownership delegado somente Button e seu teste; integração/QA no primário.

## Continuação: outras listas

O pedido de continuar estende o padrão compacto às listas que ainda duplicam a limpeza fora e dentro da folha. Antes de cada alteração, registrar o estado nativo; depois, validar aplicação, cancelamento e limpeza no mesmo simulador.

- [x] Criar uma barra compartilhada: um botão `Filtros · N`, resumo de até dois critérios e rótulo acessível completo. As opções da barra e da folha vêm da mesma definição. Valores obedecem à ocultação, inclusive durante a transição.
- [x] Lembretes: estado e canal, sem botão externo de limpeza repetido.
- [x] Importações: formato e conta, preservando reinício da paginação ao aplicar.
- [x] Dívidas: tipo, conta e estado, preservando arquivos e resumos financeiros.
- [x] Parceladas: conta, categoria, estado e valores, preservando terminadas.
- [x] Recorrentes: conta, categoria e estado, preservando pausadas/encerradas.
- [x] Notas na pasta, Arquivadas e Lixeira: busca e atualização, preservando navegação, arrasto e ações das notas.
- [x] Notas na aba: mover tags para a folha; conservar busca fixa e pastas. Capturar a digitação atual antes de abrir o rascunho, inclusive antes do debounce, e cancelar o timer anterior quando Aplicar/Limpar mudar a busca.
- [x] Verificar temas, fonte de acessibilidade, transições e composições de telefone/tablet; executar testes, tipos, lint e registrar evidências novas.

Não alterar consultas, dados financeiros ou navegação que não sejam necessários para esses ajustes. Ações de limpar em estados vazios continuam sendo atalhos contextuais.

### Problema adicional observado na fonte máxima

Depois de aplicar critérios, `TrocaSuave` retirava o estilo animado ao assentar. O Reanimated conservava a última geometria no nativo: o resumo continuava com altura de 19 pontos mesmo com a fonte máxima, enquanto o botão crescia para 73,33. O mesmo envelope agora permanece aplicado e libera largura/altura para `auto`; opacidade/transform do conteúdo continuam desanexadas ao assentar. Dois testes de regressão falharam antes da correção. A barra também impede que o resumo encolha abaixo de 180 pontos: quando o botão cresce, ele passa à próxima linha. QA iPhone confirmou resumo com largura de 370 pontos e conteúdo inteiro, sem limitar a fonte.
