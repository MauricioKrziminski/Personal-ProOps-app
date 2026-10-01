# Filtros compactos nas outras listas — 30/09/2026

Continuação na branch `gabriel/entrada-filtros`. O padrão de Lançamentos foi aplicado a Lembretes, Importações, Dívidas, Parceladas, Recorrentes e Notas (aba, pasta, Arquivadas e Lixeira). Uma barra compartilhada mostra um único botão `Filtros · N` e até dois critérios, com a quantidade dos demais. O rótulo acessível contém todos os critérios; nomes podem quebrar linha. As opções da barra e da folha vêm da mesma definição, com ordem estável independentemente da sequência dos toques.

A limpeza permanece dentro da folha, em rascunho até Aplicar. Estados vazios conservam o atalho contextual para recuperar a lista. A busca fixa de Notas permanece na tela; tags passam à folha, sem chips duplicados. A edição das tags da própria pasta e a navegação entre pastas continuam separadas dos filtros.

## Problemas adicionais e correções pela raiz

- **Busca recente de Notas:** o termo aplicado estava atrasado pelo debounce de 250ms. Abrir a folha e Aplicar nesse intervalo podia restaurar o termo anterior. A abertura captura o texto atual antes de montar o rascunho. Aplicar/Limpar sincronizam a busca fixa e cancelam o timer antigo pelo cleanup do efeito. O teste controla os timers reais do fluxo e verifica reabertura, cancelamento, tag combinada e limpeza.
- **Resumo cortado com fonte máxima:** depois do crossfade, `TrocaSuave` retirava seu estilo animado. O nativo conservava largura/altura anteriores; o resumo permanecia com altura de 19 pontos enquanto o botão crescia para 73,33. Agora o mesmo envelope continua anexado e publica `auto` ao assentar, mantendo a opacidade do conteúdo fora do estado de repouso. A documentação do [Reanimated 4](https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedStyle/#remarks) confirma que retirar um estilo animado não desfaz os valores aplicados. Dois testes de movimento observaram RED; movimento e integração financeira passaram 314/314 depois da correção.
- **Coluna estreita na fonte máxima:** a barra podia comprimir o resumo a 120,67 pontos, separando palavras em vários pedaços. Sua largura mínima agora é 180; o botão passa à próxima linha quando necessário. No iPhone, o resumo ganhou largura de 370 e altura de 271,67 pontos, sem limitar a fonte. Abrir/fechar continuou funcionando.
- **Resumo inconsistente:** contagem, texto e rótulo acessível derivam do mesmo `ListFiltersValue`. Datas e limites de valor contam como um critério cada; zero é válido. Opções indisponíveis recebem texto humano, sem expor UUIDs. Valores obedecem à ocultação e a camada anterior do crossfade é desmontada quando a pessoa os esconde.

## QA direta no iPhone

iPhone 17 Pro, iOS 26.5, app `com.proops.personal.dev`, bundle deste checkout via Metro8081. Capturas PNG e vídeo são nativos, sem edição. Antes de mudar cada lista, foi registrado seu estado. Depois: aplicar critérios, limpar e cancelar, reabrir para conferir valores, limpar e aplicar, voltar ao padrão. Testes financeiros adicionais existentes continuam cobrindo contas arquivadas, contratos terminados, recorrências pausadas/encerradas, paginação e agregados globais.

| Tela | Antes | Depois | Cenário nativo |
|---|---|---|---|
| Lembretes | [antes](iphone-reminders-before.png) | [ativo](iphone-reminders-active-after.png) / [padrão](iphone-reminders-default-after.png) | Pausados + WhatsApp, cancelamento e limpeza |
| Importações | [antes](iphone-imports-before.png) | [ativo](iphone-imports-active-after.png) / [padrão](iphone-imports-default-after.png) | CSV + Sem conta, cancelamento e limpeza |
| Dívidas | [antes](iphone-debts-before.png) | [ativo](iphone-debts-active-after.png) / [padrão](iphone-debts-default-after.png) | Ativa + Sem conta, resumo na ordem da folha |
| Parceladas | [antes](iphone-installments-before.png) | [ativo](iphone-installments-active-after.png) / [padrão](iphone-installments-default-after.png) | Quitada, cancelamento e limpeza |
| Recorrentes | [antes](iphone-recurring-before.png) | [ativo](iphone-recurring-active-after.png) / [padrão](iphone-recurring-default-after.png) | Pausada, cancelamento e limpeza |
| Arquivadas | [antes](iphone-archived-before.png) | [ativo](iphone-archived-active-after.png) / [padrão](iphone-archived-default-after.png) | Busca sem resultado e recuperação |
| Lixeira | [antes](iphone-trash-before.png) | [ativo](iphone-trash-active-after.png) / [padrão](iphone-trash-default-after.png) | Busca sem resultado e recuperação |
| Pasta | [antes](iphone-folder-before.png) | [ativo](iphone-folder-active-after.png) / [padrão](iphone-folder-default-after.png) | Busca no escopo da pasta temporária vazia |
| Notas | [antes](iphone-notes-before.png) | [ativo](iphone-notes-active-after.png) / [padrão](iphone-notes-default-after.png) | Tag + busca; datas + tag; cancelar/aplicar reset |

Tema: [Escuro](iphone-escuro.png), depois restaurado para Claro. Fonte máxima: [reprodução](iphone-fonte-maxima-antes.png) e [correção](iphone-fonte-maxima-depois.png); fonte `large` restaurada. Vídeo final [de 16,58 segundos](iphone-transicoes.mp4), 1206×2622: limpar no rascunho e cancelar conserva dois critérios; reabrir e aplicar a limpeza devolve a lista ao padrão. Não se reivindica medição de FPS de renderização a partir dessa gravação.

## Gates e limites

`npm test`: **1.348/1.348**, zero falhas, cancelados ou ignorados. TypeScript, Expo lint e `git diff --check`: saída0. [Testes](tests.txt), [TypeScript](tsc.txt), [lint](lint.txt), [React Doctor](doctor.txt). O diagnóstico usa a CLI já instalada0.9.14, sem score remoto: zero erros e 19 avisos (18 funções complexas e o falso positivo de lookup em string de Recorrentes). O aviso adicional passa a incluir `TrocaSuave`, agora alterada diretamente e já complexa no HEAD; a correção remove uma condicional, sem acrescentar ramificações à função. Sua complexidade final é 22/25 (ciclomática/cognitiva), custo de manutenção conhecido, sem falha funcional pendente demonstrada. Nenhuma regra foi suprimida. O novo lookup da barra foi corrigido com Maps, sem permanecer como aviso.

O harness cobre integração em telefone/tablet, material opaco/vidro, privacidade, rascunho e movimento reduzido. Não houve execução nativa em iPad. A aceitação nativa de Android e a limpeza da pasta temporária estão registradas abaixo. Nenhum dado financeiro foi criado ou alterado nesta continuação.

As tentativas de automação que amostraram a árvore anterior enquanto a folha ainda saía foram descartadas; a validação final espera os controles reais da tela publicada. Classificações Button/Link/GenericElement do iOS foram tratadas com rótulos únicos. O AVD Android inicial ficou bloqueado por snapshot antigo; boot sem snapshot, em modo read-only, recuperou o mesmo app. Esses problemas do harness/emulador não foram atribuídos ao aplicativo.


## QA direta no Android

AVD `s26`, Android16, `emulator-5554`, app `com.proops.personal.dev`, mesmo Metro8081 do checkout. Superfície exclusiva do revisor; o primário conferiu capturas e árvores finais, incluindo quatro critérios, fonte2× e tema escuro. [Relatório com cronologia e limites](android-relatorio.md), [checks](android-checks.txt), [vídeo nativo59,23s](android-transicoes.mp4), 720×1280. As gravações e as árvores AX/UIAutomator são evidência de interação; não substituem uma execução com VoiceOver/TalkBack ativado.

| Cenário | Evidência |
|---|---|
| Lembretes / Importações | [Pausados](android-reminders-ativo.png), [CSV](android-import-ativo.png); aplicar, cancelar limpeza e aplicar limpeza |
| Dívidas / Parceladas | [Busca em Dívidas](android-debts-ativo.png), [Parceladas](android-installments-ativo.png); mesmos três fluxos |
| Recorrentes / Lançamentos | [Recorrentes](android-recurring-ativo.png), [Lançamentos](android-transactions-ativo.png); mesmos três fluxos após cold launch final |
| Arquivadas / Lixeira / Pasta | [Arquivadas](android-archived-ativo.png), [Lixeira](android-trash-ativo.png), [Pasta](android-folder-ativo.png); escopo, cancelamento e recuperação |
| Busca fixa + tag | [Busca/tag](android-notes-busca-tag.png), [folha sem busca duplicada](android-notes-folha.png), [limpeza](android-notes-limpo.png) |
| Quatro critérios + resumo acessível | [Claro](android-multiplos-claro.png), [Escuro](android-multiplos-escuro.png), [XML com rótulo completo](android-multiplos-claro.xml) |
| Datas com redefinição única | [Ícone de redefinição](android-datas-icone.png) |
| Fonte2× | [Resumo inteiro](android-fonte2.png), [folha](android-fonte2-folha.png); abrir/fechar/aplicar limpeza confirmados |
| Preferências restauradas | [Captura](android-restaurado.png); `font_scale=1.0`, `Night mode: no` e filtro0 conferidos novamente pelo primário |

Lembretes, Importações, Dívidas e Parceladas tiveram seus fluxos normais verificados antes do último ajuste de geometria de `TrocaSuave`; seus consumidores permaneceram iguais. O smoke compartilhado final em Lembretes e os demais fluxos depois de relançar a frio validaram a geometria final. Alterar fonte no Android recriou a Activity porque `fontScale` não integra `configChanges`; os critérios foram reaplicados em2×. O crescimento dentro da mesma árvore já montada foi comprovado no iPhone. Fonte1.0 e Claro foram restaurados; o primário encerrou apenas o AVD5554 criado para este QA, em modo read-only e sem salvar snapshot.

## Privacidade e limpeza

No iPhone, mínimo=máximo zero em Parceladas contou como um único critério e apareceu como total parcelado sem entrada. [Valor zero](iphone-parceladas-zero.png) e [valores ocultos](iphone-parceladas-oculto.png) foram conferidos também na árvore acessível; depois, a preferência original de valores visíveis e filtros0 foi restaurada.

Foi criada uma única pasta temporária vazia `qaclean`, com a mesma tag, para testar navegação da pasta e combinação de tag/busca em Notas. Ambos os dispositivos concluíram esses fluxos antes da remoção. A exclusão confirmou nome exato e pasta vazia no diálogo. Depois: zero pasta/tag de QA, duas notas ativas e três arquivadas originais preservadas; nenhum lançamento, importação, lembrete ou contrato foi criado/alterado. [Inventário de limpeza](cleanup.json), [Notas depois da limpeza](iphone-apos-limpeza.png), [opções de tag sem fixture](iphone-tags-apos-limpeza.png). Tema Claro, fonte `large` e filtros0 ficaram restaurados no iPhone.

[Manifest de integridade](capturas.json) registra hashes, tamanhos, dimensões e a impressão dos arquivos fonte desta aceitação. As evidências anteriores de Entrada e Lançamentos continuam nas pastas próprias. Nenhum commit, push ou publicação integra esta continuação.

Uma [captura intermediária do Android](android-dev-aviso-intermediario.png) mostrou “Open debugger to view warnings”. A fonte instalada do React Native (`LogBoxData.js`) identifica esse texto como mensagem sintética do tooling quando chega um warning sem debugger ativo. O warning original não foi recuperado dos logs, e o banner não reapareceu nas capturas finais a frio; não se atribui causa nem se afirma que o warning original era benigno. Isso é uma limitação da evidência intermediária, sem defeito funcional reproduzido nos fluxos finais.
