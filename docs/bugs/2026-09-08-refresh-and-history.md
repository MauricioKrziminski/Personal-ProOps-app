# Atualização de telas e histórico de parcelas — 08/09/2026

Esta rodada sucede a v1.3.1. Correções registradas na main em `7fb41d4`; migration e backend promovidos a produção em 08/09/2026 após autorização explícita do usuário. A OTA Android também foi publicada com sucesso para o APK v1.3.1.

| Pedido | Causa e correção | Evidência |
| --- | --- | --- |
| Status imediato após ações | Invalidações incompletas, não aguardadas e detalhes guardados como objetos antigos. Chaves financeiras compartilhadas, espera das leituras, seleção por ID, atualização após agente/Realtime/retorno do app. | 11 regressões de cache com QueryClient/QueryObserver e doubles de transporte; auditoria de 22 mutations financeiras. |
| Puxar para atualizar | Telas sem callback, indicador que não acompanhava a Promise e conteúdo curto sem bounce. RefreshControl com estado durante leitura e callbacks completos. | Android emulador: gesto e indicador em Hoje, Finanças, Faturas e conteúdo de uma linha; contador das queries aumentou após cada gesto. |
| Oito anteriores viravam todas | Extração sem intervalo próprio, resolução promovia ao plano completo e execução reprogramava o calendário inteiro. Seleção limitada, resumo revisável e SQL atômico contra snapshot. | Frases exatas, checkpoint, Gemini real e SQL: 8/48, R$ 11.760, demais 40 preservadas. |
| Criação retroativa | Data passada e posição da parcela tratadas como pagamento, inclusive pelo cron. Pergunta explícita de histórico, zero permitido, nova RPC e cron sem quitar parcelas por calendário. | SQL local e staging real com rollback: 0/8/48 pagas, totais, RLS, conta estrangeira, contrato antigo e limites inválidos. |

## Diagnóstico detalhado

- [Consistência e ações auditadas](2026-09-08-refresh-consistency.md)
- [Interpretação e execução limitada](2026-09-08-bounded-installments.md)
- [Conversação, troca de cartão e roteamento](../../agent/docs/2026-09-08-conversation-understanding.md)
- [Histórico, pesquisa de produtos e contrato do banco](2026-09-08-retroactive-history.md)
- [Validação de dispositivo e limites da evidência](2026-09-08-refresh-device-validation.md)

## Validação integrada

- App: 290 testes passando; TypeScript e Expo lint sem erros; `git diff --check` limpo.
- Backend: 553 testes passando, incluindo confirmação/retomada e alterações concorrentes.
- Android: componentes reais com queries locais de teste; histórico de compra validado com zero e oito pagas, sem salvar. iOS e entrega pelo WhatsApp não validados nesta rodada.
- Gemini real: cinco frases de parcelas e avaliação ampliada de 22 cenários de conversação, todos aprovados em uma única rodada final com roteamento estrito. Leituras fictícias e escritas proibidas; não é entrega pelo WhatsApp.
- PGlite: histórico explícito e SQL de baixa limitada; catálogo de recursos com 137 comandos SQL.
- Staging: migration `20260908153143_explicit_installment_history` aplicada, types regenerados. Verificação autenticada com fixtures em transação revertida; nenhum registro de teste restante.

## Publicação e dados existentes

Produção recebeu a migration `20260908153143` e o backend `agente-00026-5mk`, com 100% do tráfego e `/health` saudável. Nenhum pagamento antigo foi reclassificado automaticamente. A migration preserva registros existentes; corrige novas criações e impede que o cron quite parcelas só pelo vencimento. O contrato antigo recusa criação retroativa sem histórico, evitando que versões antigas inventem pagamentos.

O usuário autorizou explicitamente a promoção completa. Staging `agente-staging-00072-vg8` passou no health e na verificação autenticada de histórico com rollback. Em produção (`kwriuifcwyvdrxtspjiz`), o dry-run indicou somente a migration prevista; após aplicar, não restaram migrations pendentes. As três definições de função foram comparadas por leitura com staging e são idênticas. Nenhum teste financeiro foi executado sobre registros reais de produção.

A exclusão explícita em `.gcloudignore` restringiu o envio aos 62 inputs do backend, sem ambientes, credenciais ou virtualenv. Os deploys preservaram a configuração existente dos serviços.

## Compatibilidade de entrega OTA

Cópia isolada do estado atual, sem diretórios nativos gerados: fingerprint, runtime 1.3.1, canal/ambiente e hash das variáveis públicas coincidem com o comprovante do APK v1.3.1 publicado. A verificação incluiu o diff até a árvore de trabalho e os arquivos novos, sem executar publicação. Evidência: `/tmp/proops-ota-audit-20260908/result.json`. O export Android de produção passou e gerou bundle Hermes de 7,5 MB em `/tmp/proops-ota-audit-20260908/dist`. Isso valida compatibilidade e geração, não entrega/aplicação OTA no aparelho. Migration e backend foram promovidos e validados antes da publicação OTA.

O SDK 57 já verifica atualizações nativamente na abertura (`updates.checkAutomatically=ON_LOAD` por padrão); importar a API JavaScript de expo-updates não é requisito para esse comportamento. O atual hook de APK continua separado. Fonte: https://docs.expo.dev/versions/v57.0.0/sdk/updates/ . OTA publicada em 08/09/2026 às 18:47:54 UTC: grupo `b3b9b1e6-d57c-4ff4-b326-5770199a26d9`, update Android `01a08259-1984-7ca9-96d9-20919229385d`, branch/canal production, runtime `1.3.1`, código `7fb41d45703c403d3f82d5aea4e8f8c8b0a25d30`. [Workflow 34264912370](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34264912370) concluído com sucesso em 2min40s desde o disparo (job 2min35s), incluindo testes e compatibilidade. [Entrega EAS](https://expo.dev/accounts/solutions.proops/projects/app-ProOps/updates/b3b9b1e6-d57c-4ff4-b326-5770199a26d9). A aplicação efetiva no celular físico continua dependendo da abertura do app e validação do usuário; não foi observada remotamente.
