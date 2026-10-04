# F10 — aceite e limites

Estado: **aceito no staging** em 04/10/2026. Branch `gabriel/financas-22-melhorias`,
staging `utkqoiigimqzeenxkxdl`. F11 liberado.

O editor existente oferece Por prazo e Por mês, conserva os rascunhos ao
alternar e calcula conclusão/calendário em centavos exatos. Aporte inicial é
intenção do plano, com data própria. A previsão conjunta conserva os saldos
reais; planos legados mantêm sua regra até uma escolha explícita de modo.
A legenda do card usa a previsão calculada e respeita a privacidade.

- Código: 2.195 testes Node passaram no estado final, TypeScript e lint com
  exit 0. React Doctor: zero erros, quatro avisos herdados de complexidade,
  cujas métricas são iguais às do HEAD anterior; score final 93, sem supressões.
  [Código e triagem](registro-codigo.md).
- Banco: duas migrations somente no staging; quatro fixtures F10/F08 com
  rollback, 320 vetores TS/SQL idênticos e três corridas reais em conexões
  distintas. Advisors: 23 avisos, zero erros, sem mudança do conjunto.
  [Contratos e concorrência](banco.md).
- Persistência nativa: iOS gravou revisão 1 Por mês e Android leu; Android
  gravou revisão 2 Por prazo e iOS leu. Cada save possui um recibo selado;
  fonte, calendário e último centavo conferidos no banco e pelo decoder real.
  Dezessete conjuntos financeiros e o caixa permaneceram iguais em ambos.
  [iOS](evidence/native/persistence/ios-persistence-proof.json),
  [Android](evidence/native/persistence/android-persistence-proof.json).
- Interface: modos, zero/resto, inicial, calendário dia 31, fechamento sem
  save, fontes grandes, temas e privacidade exercitados nos simuladores.
  A prova nativa distingue falhas do runner de comportamento confirmado.
  [Matriz e capturas](nativo.md).

- Fechamento (04/10/2026): Reduzir movimento no iOS passou, preferências dos dois
  simuladores restauradas e fixtures do QA apagadas por `request_id`, com 17
  conjuntos financeiros e caixa iguais. [Limpeza](nativo.md#limpeza).

Não houve
push, publicação, alteração de produção ou deployment do agente.
`QA-ANDROID-20261003-ANR` do F07 permanece aberto; a validação F10 não demonstra
cura causal. Não há prova F10 em hardware, build de distribuição, tablet,
leitura falada VoiceOver/TalkBack ou medição de FPS/latência física. Tempo do
runner e capturas transitórias não são medidas de desempenho do app.
