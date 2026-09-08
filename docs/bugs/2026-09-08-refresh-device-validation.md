# Validação Android — refresh e histórico

## Resultado em 08/09/2026

**Gesto e indicador de atualização comprovados no Android com telas reais e queries substituídas por fixtures locais.** Os contadores abaixo comprovam a execução e o término dos callbacks de refetch; não comprovam integração remota, realtime ou atualização recebida pelo WhatsApp.

Ambiente: Personal-ProOps-app, branch `main`, AVD `s26` (`emulator-5554`), Android API 36, resolução física 1344×2992, pacote explícito `com.proops.personal.dev`. `.env.local` foi verificado em staging (`utkqoiigimqzeenxkxdl`, agente-staging). Nenhum pacote de produção foi aberto, nenhum botão Salvar/Criar/Paguei foi acionado e nenhum registro remoto foi alterado.

## Evidência observada

| Tela/caso | Gesto e resultado | Capturas locais ignoradas |
| --- | --- | --- |
| Hoje | Swipe para baixo, indicador visível abaixo do header sobreposto, desaparecimento ao terminar; contador **0 → 6** | `evidence/refresh-today-pulling.png`, `evidence/refresh-today-after.png` |
| Finanças | Swipe para baixo, indicador visível abaixo do header; contador **6 → 14** | `evidence/refresh-finance-pulling.png`, `evidence/refresh-finance-after.png` |
| Faturas, uma única fatura | Conteúdo menor que a tela; swipe funciona, indicador visível, contador **14 → 16** | `evidence/refresh-invoices-pulling.png`, `evidence/refresh-invoices-after.png` |
| Screen com apenas uma linha | Swipe funciona mesmo sem conteúdo suficiente para rolagem; contador **16 → 17** | `evidence/refresh-short-pulling.png`, `evidence/refresh-short-after.png` |
| Compra retroativa em 12x, primeira parcela 01/01/2026 | Pergunta de histórico visível; “Nenhuma” mostra **As 12 parcelas ficam pendentes.**; entrada 8 mostra **8 parcelas iniciais pagas; 4 pendentes.** | `evidence/history-purchase-none.png`, `evidence/history-purchase-eight.png` |
| Financiamento, quatro parcelas restantes | Ao informar as restantes, aparece **Quantas parcelas já foram pagas?**; “Nenhuma” produz **0 pagas + 4 restantes = 4 parcelas no total.** | `evidence/history-debt-none.png` |

Não foi identificado defeito de gesto, indicador ou ocultação das perguntas nos casos acima. As telas foram montadas na rota de desenvolvimento; o navegador de produção e sua barra nativa não fazem parte desta prova. A comparação visual do header de marca de Hoje/Finanças usa o componente real.

A captura da compra precede a correção posterior de texto explicativo sobre saída de caixa. A pergunta, seleção e resumo verificados não mudaram com essa correção.

## Método e dificuldades resolvidas

A fixture temporária de `design-preview.tsx` montou Hoje, Finanças, Faturas e formulários reais. Um QueryClient isolado devolveu dados locais com atraso de 2200 ms e incrementou `QA refetch` ao concluir cada query. A rota foi observada com esse marcador antes de considerar qualquer captura válida.

O app dev instalado inicialmente carregava um bundle antigo e depois falhou com `Unable to load script`. Metro `/status` respondeu normalmente e gerou bundle atual, mas o deep link do dev launcher não resolveu nesse pacote. Foi então gerado **somente um APK debug local**, com `expo export:embed --dev true`, assets temporários e Gradle `assembleDebug`; package id foi confirmado como `com.proops.personal.dev` antes da instalação.

Expo 57 bloqueou seu websocket de devtools em ambiente embedded. Apenas as duas guardas correspondentes no **bundle gerado e ignorado** receberam fallback para `http://127.0.0.1:8081/`. Nenhum arquivo de produto ou de `node_modules` recebeu essa adaptação. O APK local foi reconstruído e instalado exclusivamente no emulador dev. Build final passou.

## Restauração e limites

- `design-preview.tsx` foi restaurado exatamente após a geração do bundle, com `cmp` e diff vazio.
- O diretório nativo `res` e o cache JS original do app dev foram preservados e restaurados; o bundle temporário de `src/main/assets` foi removido.
- O APK original de `android/app/build/outputs/apk/debug/app-debug.apk` foi restaurado. O APK de fixture foi mantido somente em `/private/tmp/refresh-fixture-dev.apk`.
- O app dev foi encerrado ao concluir. **O pacote instalado no emulador permanece sendo o APK local de fixture**, sem desinstalação nem limpeza de dados. Ele não é uma release ou entrega de produto.
- iOS 26.5 possui simuladores desligados, mas somente apps `com.proops.personal` instalados; não foram abertos. **Nenhum gesto/layout iOS foi comprovado.**
- A lista de lançamentos foi aberta, mas seu gesto não foi testado. A entrada 8 no financiamento não foi validada; a tentativa não focou o campo após mudança de layout e o botão Voltar encerrou o rascunho. Não se atribui isso a defeito do produto.
- WhatsApp/realtime e o efeito de uma baixa real de fatura permanecem fora desta prova local. Nenhuma integração remota foi inferida dos contadores.
- A captura antiga `evidence/refresh-today-before.png` não é evidência das alterações atuais. A captura `history-debt-eight.png` mostra apenas a tela vazia após fechar o modal e não comprova oito pagas.

Todas as capturas ficam apenas em `docs/bugs/evidence/`, ignorado pelo Git. Não houve commit, push, deploy, EAS ou publicação.
