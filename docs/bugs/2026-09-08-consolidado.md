# Correções de 08/09/2026 — Personal ProOps app

Investigação, decisões e implementação dos dez pontos relatados com fotos. O código do workspace foi a fonte primária; a sessão Orca anterior foi referência somente de leitura. Branch local: `main`, base `d521e36`. Nenhum commit, push, APK, OTA ou deploy do agente em produção foi feito nesta intervenção.

## Critério de conclusão

Separar quatro coisas: código implementado; regressão local reproduzida e corrigida; comportamento em emulador/staging; entrega no APK/backend de produção. Um teste com modelo ou banco substituído não comprova WhatsApp real. Um workflow validado localmente não comprova a duração de um build remoto.

## Os dez pontos

| # | Causa raiz | Correção implementada | Evidência / limite |
|---|---|---|---|
| 1 | Catálogo do agente não continha CRUD dos cadastros do app; criação excepcional de cartão presumiu ciclo. | Domínio de cadastros, catálogo fechado de 11 recursos, proposta congelada e confirmação final para mutações; campos ausentes permanecem inertes. Pagamento de financiamento usa a RPC de amortização. | Extração Gemini real de cartão, conta, pasta, financiamento, pagamento e continuação de cadastro; grafo com HITL e SQL real isolado. WhatsApp externo/backend publicado não exercidos. |
| 2 | Não havia etapa de preferências nem marcador de conclusão por usuário. | Onboarding com nome opcional, aparência e avisos independentes; conclusão gravada na metadata de apresentação do usuário. | Android com sessão staging: escolha de tema, conclusão, reinício e redirecionamento sem repetir onboarding. |
| 3 | Formulário já permitia edição, mas UPDATE sem linha era falso sucesso; trigger recalculava fatura sem realinhar vencimento; correção conversacional não distinguia conta nova. | UPDATE exige uma linha; trigger compartilhado realinha conta/data/fatura/vencimento; `new_account` congela destino e o mostra antes do SIM; histórico financeiro permite corrigir/excluir o último pagamento de dívida com alocação conhecida. | SQL isolado e staging real: troca de conta/ciclo, mesmo lançamento, amortização. Gemini e grafo validaram conta nova. Legado sem alocação e pagamentos com posteriores têm restrição econômica explícita. |
| 4 | `approved=True` do clique de seleção era interpretado como autorização antes de examinar `change_card`. | Seleção, troca e confirmação são etapas diferentes. Troca preserva compra e limpa cartão; aprovação de aviso não aprova outra ação não mostrada. | Regressão da foto: zero execução ao trocar; valor, 48 parcelas e posição da 9ª preservados. Seleções de alvo passam por confirmação final. |
| 5 | Compensação do teclado era padding interno ignorado no alinhamento inferior da FlashList; botão e composer não compartilhavam o mesmo viewport útil. | Redimensionar a área real da lista; botão ancorado acima do composer, incluindo altura variável. | Android a 384 dp/font 1,3: primeira mensagem com teclado visível, composer de várias linhas, botão e rolagem até o fim. Além das fixtures, nova conversa real staging respondeu ao oi; mensagem visível durante envio com teclado e após reabertura. Conversa de teste excluída pela UI. |
| 6 | Financiamento já existia como dívida, mas estava escondido em Gerenciar; tela omitia conta/prestação e confundia prazo total com restante. | Lançar > Financiamento; passivo separado de conta e cartão, conta pagadora e prestação; semântica total/pagas/restantes corrigida. Conversa oferece É financiamento e preserva 48 parcelas/8 pagas, pedindo principal/saldo/taxa sem presumir pelo total parcelado. | Formulário Android, regressões de conversão e SQL real staging de conta/pagamento. Projeção Price continua estimativa, sem simular taxas/seguros/SAC não informados. |
| 7 | Recorrências existiam, mas Lançar abria apenas formulário avulso. | Entrada Recorrente no FAB e no formulário, preservando tipo/valor/descrição/conta/data sem inserir avulso. | Android abriu Receita recorrente com valor e descrição preenchidos; testes de prazo/intervalo. |
| 8 | ActionSheet adicionava literalmente `…` aos rótulos de submenu. | Rótulos completos e indicador visual de navegação. | Android: menu e submenu navegáveis, sem reticências artificiais. |
| 9 | Curva era simulada com disco da cor do fundo; bolha selecionada também tinha preenchimento. | Recorte real do fill/stroke ao redor da bolha; círculo do ícone com cor sólida, conforme esclarecimento do usuário. | Conteúdo visível pelo espaço ao redor do círculo; círculo permanece sólido no emulador. |
| 10 | Release fazia build Android completo mesmo para alterações compatíveis de JS. O tempo principal estava no EAS. | Workflow OTA separado com comparação de runtime, fingerprint, ambiente, código nativo e comprovante vinculado ao APK/build. APK continua para mudanças nativas. | Testes locais do publicador e dos bloqueios; nenhuma publicação foi feita. Primeiro APK com comprovante é necessário; redução real de tempo ainda não foi medida. |

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

**Produção `kwriuifcwyvdrxtspjiz` não foi migrada nesta intervenção.** Mudanças do agente ainda precisam de deploy; mudanças mobile precisam ser distribuídas. O primeiro build nativo estabelece o comprovante de compatibilidade para as OTAs seguintes. Validação física de entrega OTA e WhatsApp externo é etapa de release, separada dos checks abaixo.

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

Não comprovado: WhatsApp externo com backend novo, RLS autenticada de todos os fluxos financeiros, iOS, materialização do scheduler nesta rodada, APK/OTA publicado e tempo de entrega real. Não há alegação de garantia universal de interpretação da linguagem natural. Os scripts remotos de banco recusam produção e desfazem suas fixtures por rollback; scripts Gemini substituem o banco e não enviam WhatsApp.

## Release 1.3.0 autorizada

Após revisão do usuário, a bolha selecionada voltou a ter cor sólida; apenas o recorte ao redor dela permanece transparente. Validado no Android. Onboarding já implementado e testado, não somente documentado. A migração 0057 foi aplicada em produção kwriuifcwyvdrxtspjiz após dry-run listar somente ela. Deploy e publicação da release estão sendo acompanhados. As capturas em evidence/ são artefatos locais, deliberadamente não versionados porque o repositório é público e as sessões podem conter dados pessoais. Os relatórios e os testes reproduzíveis são versionados.
