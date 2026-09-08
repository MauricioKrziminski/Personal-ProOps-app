# Correções de 08/09/2026 — Personal ProOps app

Investigação, decisões e implementação dos dez pontos relatados com fotos. O código do workspace foi a fonte primária; a sessão Orca anterior foi referência somente de leitura. Branch: `main`, base da investigação `d521e36`. Após a investigação e validação, o usuário autorizou push e release. O estado da entrega consta ao final deste documento.

## Critério de conclusão

Separar quatro coisas: código implementado; regressão local reproduzida e corrigida; comportamento em emulador/staging; entrega no APK/backend de produção. Um teste com modelo ou banco substituído não comprova WhatsApp real. Um workflow validado localmente não comprova a duração de um build remoto.

## Os dez pontos

| # | Causa raiz | Correção implementada | Evidência / limite |
|---|---|---|---|
| 1 | Catálogo do agente não continha CRUD dos cadastros do app; criação excepcional de cartão presumiu ciclo. | Domínio de cadastros, catálogo fechado de 11 recursos, proposta congelada e confirmação final para mutações; campos ausentes permanecem inertes. Pagamento de financiamento usa a RPC de amortização. | Extração Gemini real de cartão, conta, pasta, financiamento, pagamento e continuação de cadastro; grafo com HITL e SQL real isolado. Backend publicado; criação de cartão com proposta e cancelamento exercitada no staging. WhatsApp externo não exercido. |
| 2 | Não havia etapa de preferências nem marcador de conclusão por usuário. | Onboarding com nome opcional, aparência e avisos independentes; conclusão gravada na metadata de apresentação do usuário. | Android com sessão staging: escolha de tema, conclusão, reinício e redirecionamento sem repetir onboarding. |
| 3 | Formulário já permitia edição, mas UPDATE sem linha era falso sucesso; trigger recalculava fatura sem realinhar vencimento; correção conversacional não distinguia conta nova. | UPDATE exige uma linha; trigger compartilhado realinha conta/data/fatura/vencimento; `new_account` congela destino e o mostra antes do SIM; histórico financeiro permite corrigir/excluir o último pagamento de dívida com alocação conhecida. | SQL isolado e staging real: troca de conta/ciclo, mesmo lançamento, amortização. Gemini e grafo validaram conta nova. Legado sem alocação e pagamentos com posteriores têm restrição econômica explícita. |
| 4 | `approved=True` do clique de seleção era interpretado como autorização antes de examinar `change_card`. | Seleção, troca e confirmação são etapas diferentes. Troca preserva compra e limpa cartão; aprovação de aviso não aprova outra ação não mostrada. | Regressão da foto: zero execução ao trocar; valor, 48 parcelas e posição da 9ª preservados. Seleções de alvo passam por confirmação final. |
| 5 | Compensação do teclado era padding interno ignorado no alinhamento inferior da FlashList; botão e composer não compartilhavam o mesmo viewport útil. | Redimensionar a área real da lista; botão ancorado acima do composer, incluindo altura variável. | Android a 384 dp/font 1,3: primeira mensagem com teclado visível, composer de várias linhas, botão e rolagem até o fim. Além das fixtures, nova conversa real staging respondeu ao oi; mensagem visível durante envio com teclado e após reabertura. Conversa de teste excluída pela UI. |
| 6 | Financiamento já existia como dívida, mas estava escondido em Gerenciar; tela omitia conta/prestação e confundia prazo total com restante. | Lançar > Financiamento; passivo separado de conta e cartão, conta pagadora e prestação; semântica total/pagas/restantes corrigida. Conversa oferece É financiamento e preserva 48 parcelas/8 pagas, pedindo principal/saldo/taxa sem presumir pelo total parcelado. | Formulário Android, regressões de conversão e SQL real staging de conta/pagamento. Projeção Price continua estimativa, sem simular taxas/seguros/SAC não informados. |
| 7 | Recorrências existiam, mas Lançar abria apenas formulário avulso. | Entrada Recorrente no FAB e no formulário, preservando tipo/valor/descrição/conta/data sem inserir avulso. | Android abriu Receita recorrente com valor e descrição preenchidos; testes de prazo/intervalo. |
| 8 | ActionSheet adicionava literalmente `…` aos rótulos de submenu. | Rótulos completos e indicador visual de navegação. | Android: menu e submenu navegáveis, sem reticências artificiais. |
| 9 | Curva era simulada com disco da cor do fundo; bolha selecionada também tinha preenchimento. | Recorte real do fill/stroke ao redor da bolha; círculo do ícone com cor sólida, conforme esclarecimento do usuário. | Conteúdo visível pelo espaço ao redor do círculo; círculo permanece sólido no emulador. |
| 10 | Release fazia build Android completo mesmo para alterações compatíveis de JS. O tempo principal estava no EAS. | Workflow OTA separado com comparação de runtime, fingerprint, ambiente, código nativo e comprovante vinculado ao APK/build. APK continua para mudanças nativas. | Testes locais do publicador e dos bloqueios; geração real do comprovante no ambiente EAS passou. Primeiro APK com comprovante publicado na v1.3.1; redução real com OTA ainda não foi medida. Tempo de APK nativo não resolvido: 37min29s de fila nesta release. |

## Capacidade e consentimento do assistente

Cadastros: contas, cartões, dívidas/financiamentos, metas, orçamentos, bens/investimentos, recorrências, regras de categoria, notas, lembretes e pastas. As operações financeiras já existentes continuam disponíveis: despesas, receitas, transferências, compras parceladas, faturas, baixas, aportes, avaliação patrimonial e consultas. Pagamento de dívida usa operação própria; não equivale a simplesmente diminuir seu saldo.

Criar cadastros estruturais, editar/excluir, assumir recorrência/parcelamento e pagamentos sensíveis exigem uma proposta antes da execução. Selecionar um alvo ou mudar o cartão nunca aprova outra operação. Lançamentos simples de pequeno valor e notas novas explicitamente solicitados preservam o fluxo rápido; valores altos e baixa confiança continuam exigindo confirmação.

O catálogo não concede SQL arbitrário nem permite substituir autenticação/OTP, consentimento do sistema operacional ou compra em loja. Alteração de identidade, telefone verificado e assinatura mantêm seus fluxos próprios. Exclusões que no app significam arquivar/pausar usam a mesma semântica, apresentada na confirmação.

## Documentos e provas por área

- [Agente e consentimento](2026-09-08-agent.md)
- [HTTP local assinado](2026-09-08-signed-inbound-validation.md)
- [Limite real do schema Gemini](2026-09-08-gemini-resource-schema.md)
- [Financeiro: edição, financiamento e recorrência](2026-09-08-finance-flows.md)
- [Validação financeira no staging e rollback](2026-09-08-finance-staging-validation.md)
- [Chat, menu e navbar](2026-09-08-chat-ui.md)
- [Onboarding e release/OTA](2026-09-08-onboarding-release.md)
- [Capturas Android](evidence/)

## Ambientes e entrega

A migração `0057_finance_edit_and_debt_accounts.sql` foi aplicada no **staging `utkqoiigimqzeenxkxdl`**, após `scripts/supabase-target.sh` e dry-run mostrando somente essa migração. Tipos TypeScript foram regenerados dos schemas `public,graphql_public`, preservando os schemas anteriores do arquivo.

**Produção `kwriuifcwyvdrxtspjiz` recebeu somente a migração 0057**, após autorização de release e dry-run. Agente publicado na revisão `agente-00025-lt7`, 100% do tráfego, health OK. Staging recebeu a mesma imagem na revisão `agente-staging-00071-ltm`, preservando seu banco e configuração. Crons permanecem pausados. O primeiro build nativo estabelece o comprovante de compatibilidade para as OTAs seguintes. Validação física de entrega OTA e WhatsApp externo é etapa de release, separada dos checks abaixo.

## Verificação final

Rodada final em 08/09/2026, após integração das áreas:

- Agente: **504 testes passaram**, 2 avisos de depreciação de dependências; Ruff `F,E9` passou.
- App e scripts de release: **265 testes passaram**, zero falhas; TypeScript e Expo lint passaram.
- `finance_invariants.mjs`: passou (fatura, conta, vencimento, amortização, correção/exclusão e restrições históricas).
- `resource_invariants.mjs`: **136 instruções SQL**, 11 recursos × CRUD/lista e pagamento de dívida passaram.
- Gemini real: catálogo com cinco pedidos, continuação de cadastro e schema financeiro final com nova conta aceitos. Nenhuma gravação dessas sondagens.
- HTTP local real: `fake_meta.py` enviou texto e clique assinados; 200 válidos, 401 para assinatura inválida/adulterada/ausente, sem efeito nos rejeitados. DB/CloudTasks em memória, sem envio externo.
- Staging real: cenários de edição, pagamento, correção/exclusão e armazenamento de recorrência passaram. **Rollback verificado: zero fixtures nas seis tabelas.** Scheduler global não executado.
- Android: chat/teclado, menus, navbar, financiamento, recorrência e onboarding inspecionados; capturas em `evidence/`. Onboarding e nova conversa real usaram sessão staging; demais provas visuais utilizaram fixtures locais. Na transição nova→salva o teclado fecha pelo remount existente; ao reabrir, mensagem e resposta permanecem visíveis. A conversa de teste foi excluída pela UI.
- `git diff --check` passou; preview temporário foi restaurado; configurações do emulador foram devolvidas ao padrão.

Não comprovado: WhatsApp externo com backend novo, RLS autenticada de todos os fluxos financeiros, iOS, materialização do scheduler nesta rodada, OTA publicada e instalação/atualização em celular físico. APK publicado e tempo real do workflow estão comprovados abaixo. Não há alegação de garantia universal de interpretação da linguagem natural. Os scripts remotos de banco recusam produção e desfazem suas fixtures por rollback; scripts Gemini substituem o banco e não enviam WhatsApp.

## Release autorizada e acompanhamento

Após revisão do usuário, a bolha selecionada voltou a ter cor sólida; apenas o recorte ao redor dela permanece transparente. Validado no Android. Onboarding já implementado e testado, não somente documentado. A migração 0057 foi aplicada em produção kwriuifcwyvdrxtspjiz após dry-run listar somente ela. Deploy concluído. O primeiro workflow, v1.3.0, falhou antes de criar APK: o EAS CLI exige `env:exec production`, não `env:exec --environment production`. A sintaxe foi corrigida nos dois workflows e validada com execução real do gerador no ambiente EAS; 37 testes específicos passaram. A tag falha foi preservada e a nova versão v1.3.1 concluiu com sucesso o run `34236948199`. O estágio de geração do comprovante passou; build EAS `ff6a2b8d-ba92-427e-9d68-4ba45b84e5b2`, código Android 7. As capturas em evidence/ são artefatos locais, deliberadamente não versionados porque o repositório é público e as sessões podem conter dados pessoais. Os relatórios e os testes reproduzíveis são versionados.

Teste adicional no backend staging publicado: criação do cartão de teste apresentou nome, fechamento, vencimento e limite antes da confirmação. Cancelar encerrou sem criação; consulta independente ao banco confirmou zero cartões com aquele nome. A conversa de teste foi excluída.

### Medição de desempenho durante a release

As métricas EAS da v1.2.0 mostram 23,303 s de fila e 1.006,533 s de compilação (16min46s). Na v1.3.1, a preparação no GitHub terminou em aproximadamente 1min36s; a geração nova do comprovante levou 5 s. O build foi criado às 14:15:52 UTC e ainda estava em `IN_QUEUE` mais de 30 minutos depois. Portanto, a demora adicional observada está na fila remota, e a redução do tempo de **APK nativo não está resolvida**. OTA evita esse caminho para alterações futuras compatíveis de JavaScript, mas seu ganho real ainda precisa ser medido em uma publicação. Este acompanhamento não implica mudança de plano pago ou aumento de capacidade.


### Entrega concluída da v1.3.1

- Push na main: implementação `c87163c`, correção do CLI/versionamento `913c6aa`. A tag v1.3.1 aponta para `913c6aafdfd794639c6a9188d56a225ad9bbad99`.
- [Workflow verde](https://github.com/MauricioKrziminski/Personal-ProOps-app/actions/runs/34236948199): **56min14s**. EAS: **37min29s de fila** e **16min19s de compilação**. O build nativo não ficou materialmente mais rápido; a fila tornou esta release mais lenta que a anterior. Item 10 permanece parcialmente resolvido: OTA implementada, ganho real pendente e redução do caminho nativo pendente.
- [Release publicada e marcada como latest](https://github.com/almeidagabriel01/Personal-ProOps-app-releases/releases/tag/v1.3.1): APK, update.json e native-compatibility.json.
- APK publicado baixado e conferido: `com.proops.personal`, versionName `1.3.1`, versionCode `7`, assinatura SHA-256 `b31d4d8d59ac82f558bd5b22fec89a1c376491cf1b5f17d8b9efc4098b6fbdda`, igual à esperada. SHA-256 do APK `d544406d7d7b82af7d50420547a2cd0152f80bfe56238a460534a4fd99d2ae6a` coincide com manifesto e comprovante. Tamanho 158.623.776 bytes, próximo ao APK anterior (158.619.860 bytes).
- Produção: migração 0057 aplicada; revisão `agente-00025-lt7` com 100% do tráfego, health OK e sem entradas severity ERROR na consulta após deploy. Staging: mesma imagem em `agente-staging-00071-ltm`. Nenhum cron foi reativado.
- Onboarding implementado e validado no Android staging. Círculo selecionado sólido e recorte ao redor transparente, conforme esclarecimento do usuário.
- A entrega do APK não substitui o teste físico solicitado pelo usuário nem comprova todos os canais externos. Não foi publicado OTA nesta rodada.
