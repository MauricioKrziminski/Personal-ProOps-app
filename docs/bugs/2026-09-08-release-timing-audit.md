# Release Android: causa, correção e medição — 08/09/2026

Correção validada em builds reais: APK assinado no próprio GitHub runner, sem fila EAS remota, com memória Gradle ajustada e caches Gradle/C++. O teste entre versões levou **17min10s de execução do job**, incluindo preparação, verificações e gravação de cache. O primeiro build sem cache continua mais caro: **32min38s**. Não se promete esse tempo menor quando o cache estiver ausente ou as dependências nativas mudarem substancialmente.

## Causa da regressão publicada

| Métrica | v1.2.0 | v1.3.1 |
| --- | --- | --- |
| Criação do run até atualização final | 19min33s | 56min18s |
| Execução do job | 19min29s | 56min14s |
| Etapa EAS no GitHub | 17min25s | 54min09s |
| Fila EAS | 23,303s | 37min29,022s |
| Compilação EAS | 16min46,533s | 16min19,174s |

O aumento veio da fila: a compilação ficou cerca de 27s mais curta. As verificações de compatibilidade acrescentaram cerca de 5s, não 37min. A v1.3.0 falhou antes de construir. Não foi identificado release posterior à 1.3.1 na auditoria inicial; não se atribui a um run específico a percepção de mais de 1h sem evidência.

Fontes: GitHub [v1.2.0](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34182662571) e [v1.3.1](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34236948199); EAS CLI 23.2.0, builds `6cf7244f-6361-42a2-b56d-49be3e7205eb` e `ff6a2b8d-ba92-427e-9d68-4ba45b84e5b2`, prioridade NORMAL.

## Correção pela raiz

- EAS `--local` constrói no runner GitHub, eliminando a fila remota EAS. Retirar `--wait` ou ampliar timeout não reduziria o tempo da entrega.
- Java 17, SDK 36, NDK 27.1 e CMake 3.22 explícitos. Gradle com heap 4 GiB/metaspace 1 GiB, equivalentes ao orçamento JVM EAS medium. O primeiro teste local com 2 GiB/512 MiB esgotou Metaspace e falhou; isso foi corrigido e deixou de ocorrer.
- Cache Gradle com `org.gradle.caching=true`. O build nativo CMake não é automaticamente coberto pelo cache de tarefas Gradle; o hook oficial do React Native detecta `ccache` no PATH.
- Cache C++ exclusivo em diretório próprio, limite `2G` e verificação do compilador por conteúdo. Sem desativar verificações de headers, macros ou caminhos; sem cachear a árvore inteira de build ou credenciais. Nenhuma arquitetura Android foi removida.
- Restauração de cache entre versões/lockfiles: o prefixo mantém SO, arquitetura, NDK e CMake; o ccache verifica fontes, headers e compilador. Não exige repetir o mesmo commit para obter ganho.
- Verificação da identidade, versão e assinatura do APK mantida. Atestação lê runtime/channel/updateURL do APK real e vincula SHA256, commit e execução. Comprovantes EAS antigos e bloqueios de OTA permanecem compatíveis.
- Somente tags `v*` publicam release. Execução manual apenas valida o APK e prepara cache, com nome explícito no GitHub. Artefatos de inspeção ficam disponíveis sete dias.

Referências primárias: [EAS local](https://docs.expo.dev/build-reference/local-builds/), [infraestrutura EAS e memória JVM](https://docs.expo.dev/build-reference/infrastructure/), [cache Gradle](https://raw.githubusercontent.com/gradle/actions/v4/docs/setup-gradle.md), [ccache](https://ccache.dev/manual/latest.html). O hook instalado está em `node_modules/react-native/ReactAndroid/cmake-utils/ReactNative-application.cmake`.

## Benchmarks reais

| Run | Condição | Job completo | Compilação | Resultado |
| --- | --- | --- | --- | --- |
| [34252707634](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34252707634) | Sem cache, memória corrigida | 32min38s | 29min07s | APK, assinatura e atestação passaram |
| [34255339182](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34255339182) | Cache Gradle, preenchendo ccache | 18min51s | 15min32s | 340 misses; cache C++ salvo; APK verificado |
| [34256983349](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34256983349) | Nova versão e lockfile, ambos caches | 17min10s | 13min38s | 340/340 hits C++; APK verificado |

A nova versão do benchmark foi 1.3.2 somente na branch isolada `ci/release-local-build`; não houve tag nem publicação. A main preserva a versão do app. Os testes usam a base anterior do aplicativo, sem as correções financeiras e do agente ainda não publicadas.

Não esconder a fila dos próprios benchmarks: o segundo esperou 6min21s atrás do primeiro, totalizando 25min13s desde a criação; o terceiro esperou 8min57s, totalizando 26min08s. Foram enfileirados antecipadamente nesta investigação. A comparação homogênea de execução é 19min29s original, 56min14s última release e 17min10s no teste final. Filas do GitHub por concorrência continuam possíveis; a fila eliminada é a remota EAS.

Tentativas anteriores: run 34249360916 cancelado para habilitar cache; run 34249609766 interrompido após 25min55s na etapa nativa, com esgotamento de Metaspace e três tarefas falhando; run 34255176079 recusado antes de executar por contexto runner usado no nível incorreto do YAML. O YAML final passou actionlint 1.7.7; o script passou `bash -n`; 290 testes locais, TypeScript e Expo lint passaram.

## Cache da main e limites de entrega

O GitHub isola caches por branch/tag e permite fallback para a branch padrão. Tags distintas não compartilham automaticamente os caches umas das outras; a branch de benchmark também não aquece a main. É necessário executar manualmente este workflow na main, sem publicação, para criar o cache acessível às próximas tags. Esse primeiro aquecimento pode levar o tempo do build sem cache. [Regra de escopo do GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).

O workflow OTA já existe para alterações compatíveis de JS, mas não teve publicação real nesta investigação. Esses tempos são de APK completo, não de OTA. Nenhum plano pago foi alterado; produção não recebeu migration, backend ou atualização do app nesta rodada.

## Promoção concluída

O CI foi publicado na main em `fe4c4f26055d74ad1eaf9e860d91ce64d8a72910`. O [aquecimento da main](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34259929977) concluiu em 08/09/2026 às 18:28 UTC: job 33min27s, compilação 29min36s, total desde criação 33min33s. Era o primeiro build da main sem cache, não uma release. Identidade, assinatura e atestação passaram; publicação de assets foi explicitamente ignorada.

A API do GitHub confirmou nove entradas Gradle/C++ em `refs/heads/main`, incluindo o cache nativo vinculado ao commit acima. Portanto o cache da branch padrão está preparado para as próximas tags. Essa execução fria não substitui nem é apresentada como o benchmark quente de 17min10s. A duração depende da existência e utilidade dos caches e da disponibilidade do runner.

Verificação de escopo após o trabalho: produção permaneceu em `agente-00025-lt7` e staging em `agente-staging-00071-ltm`. As mudanças funcionais do app/agente e a migration nova não foram incluídas no push do CI nem publicadas em produção.

## Release nativa 1.3.2

Após a entrega OTA compatível com 1.3.1, o usuário solicitou um APK novo e a medição do build completo. A versão 1.3.2 inclui as correções funcionais publicadas em `7fb41d4`. O build usa o workflow nativo já validado, com fallback para os caches da main, assinatura existente e incremento remoto do versionCode. O tempo OTA de 2min40s não é uma medida de geração de APK. Resultado desta release será registrado após conclusão.

A execução nativa 34267445450 (v1.3.2) foi cancelada durante o build após o usuário detalhar o falso pagamento em Hoje. Não publicou assets. O problema foi reproduzido e corrigido antes da próxima tag, v1.3.3. Esse cancelamento não mede o tempo de um build completo.

## Release 1.3.3 publicada e medida

[Run 34268405306](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34268405306), commit `6ece162`, terminou com sucesso em 08/09/2026. Disparo 19:20:43 UTC, final 19:35:19 UTC: **14min36s totais** (job 14min32s). Etapa EAS local 19:23:31–19:34:10: **10min39s**; Gradle informou 9min35s. Comparado aos 19min33s totais da v1.2.0, foram 4min57s a menos (~25%). O total inclui preparação, verificações, publicação e gravação dos caches; não é tempo de OTA.

O ccache foi restaurado da main (`fe4c4f2`): **340/340 hits, zero misses**. O release mantém as arquiteturas, assinatura e validações. Cache ausente e mudanças nativas substanciais podem aumentar o tempo de próximas execuções.

[APK 1.3.3](https://github.com/almeidagabriel01/Personal-ProOps-app-releases/releases/tag/v1.3.3): `com.proops.personal`, versionCode **15** (anterior 7), runtime 1.3.3, SHA256 `6c0b123ea8f1e0eca10168bac5800f0fa79630fbfd9ec735b1ad183361d48883`. O APK baixado do release teve hash, assinatura, versão e sourceCommit comparados com o manifesto/comprovante. Instalação `adb install -r` sobre a v1.3.1 assinada passou no emulador isolado Android 36; abriu na tela de login, sem crash observado. Não houve login ou operações financeiras nesse dispositivo. Evidências em `/tmp/proops-v133-release/`.
