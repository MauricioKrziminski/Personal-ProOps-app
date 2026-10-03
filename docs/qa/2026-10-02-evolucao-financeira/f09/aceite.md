# F09 — aceite e limites

Aceite funcional em 03/10/2026, branch `gabriel/financas-22-melhorias`, exclusivamente no
staging `utkqoiigimqzeenxkxdl`. F10 liberado após implementação, gates, revisão de capturas
e reconciliação de dados. Sem push, publicação ou alteração de produção.

- Código: 2.103 testes Node, 99 Python focados, TypeScript/lint; React Doctor zero erros e
  18 avisos registrados, sem supressão. O último prop de layout passou em 11 testes JSX,
  tipos/lint e leitura visual nos dois sistemas.
- Banco: seis migrations aplicadas; contratos, 13 regressões financeiras, quatro corridas
  estruturais e cinco provas do materializador real passaram. Advisors: 23 avisos, zero
  erros, conjunto idêntico ao anterior. Fixtures SQL revertidas/limpas por identidade.
- Nativo: criação em ambos os sistemas, leituras cruzadas, prévia, reabertura/cancelamento,
  troca de pai, rename/move/merge/delete, filtro obsoleto/null, soma e privacidade na matriz
  de [nativo.md](nativo.md). Operações estruturais efetivadas no iOS, crossreads Android;
  escopos/importação/scheduler não foram todos repetidos por interação nativa.
- Remover detalhe deixou os dois lançamentos pagos, categoria e valores intactos. Relatório
  por filho/Sem detalhe fechou o total anual autenticado em centavos, nos dois aparelhos.
- Limpeza: somente dois lançamentos e oito recibos próprios; leitura independente confirmou
  17 conjuntos públicos e caixa idênticos ao baseline. Histórico privado conferido a partir
  da captura pré-merge/delete. Preferências temporárias Android e privacidade iOS restauradas.

O aceite é de funcionalidade neste ambiente. `QA-ANDROID-20261003-ANR` do F07 continua aberto;
a sessão também observou repintura de tema que só se atualizou após relançar e warnings de
mount do Reanimated. Não houve correção causal desses problemas nem build de distribuição,
hardware, rodada tablet/Reduce Motion/VoiceOver/TalkBack F09 ou deployment do agente.
Escolha explícita de detalhe por linguagem natural financeira permanece fora do schema
Gemini medido; compatibilidade, campos de recursos e propagação determinística foram
testados em código/SQL. Esses limites acompanham a promoção futura; nenhum pass os elimina.

Evidências portáteis, tamanhos e SHA-256: [manifesto](evidence/manifest.json).
