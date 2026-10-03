# F07 — aceite funcional no staging

03/10/2026. Branch `gabriel/financas-22-melhorias`, staging `utkqoiigimqzeenxkxdl`.
Reserva de emergência identificada concluída nos cenários executados. F08 liberado.
O aceite cobre desenvolvimento e integração no staging; distribuição/produção exigem
sua própria validação. A ANR descrita abaixo continua aberta.

## Entrega e evidência

- Fontes existentes de contas/investimentos, alocação sem movimentar dinheiro, lastro
  proporcional e liquidez explícita. Base manual ou três meses civis completos revisados,
  insuficiência explicada e cobertura conservadora em décimos.
- Escrita atômica, revisão/CAS, recibo privado selado, intenção/UUID congelados no retry
  e encerramento terminal antes de uma requisição atrasada. Quatro migrations aplicadas
  somente no staging. RLS, payload forjado, replay e corridas em conexões reais conferidos
  no [registro SQL](registro-sql.md).
- iPhone/iPad e Android conferidos: persistência entre plataformas, conflito nativo,
  base/fontes, cancelamento, privacidade, temas, fonte ampliada, teto monetário, folha
  adaptativa e orientação. Android também confirmou offline/retry e recuperação terminal.
  Reduce Motion do iOS e escala de transição Android foram exercitados e restaurados;
  o timeout da rodada Android longa permanece registrado separadamente do passe curto.
- Suíte após Sheet: 1.839/1.839, zero falhas/skip. TypeScript/lint e quatro testes existentes
  de contraste passaram após o ajuste final do SwitchRow. React Doctor: zero erros/sete
  warnings. Código permaneceu inalterado durante a rodada final de movimento/APK embutido.
- Revisão de 38 capturas e quatro recapturas do SwitchRow concluída. Tokens, componentes,
  tipografia e comportamento compartilhados reconciliados em DESIGN/sidecar. O veredito
  visual tem o alcance descrito na [revisão](revisao-visual.md).
- APK diagnóstico local com JS embutido, `debuggable=false`, ID de desenvolvimento,
  configuração de staging e OTA desativada passou o fluxo completo sem Metro. Privacidade
  persistiu após cold launch; painel do Android preservou rascunho; cancelamento/reabertura
  retornou 1.200,00/9. Cinco PNGs foram vistos individualmente. Logs do intervalo têm zero
  marcadores novos de ANR/crash e `lastanr` idêntico. APK debug original e sua sessão foram
  restaurados; runner de restauração saiu 0.
- Os sete oráculos financeiros, a configuração/alocações de reserva e os dez recibos
  ficaram idênticos antes/depois desse fluxo. Estado final: revisão 8, base 120.000 centavos,
  horizonte 9, conta 300.000 e ativo 100.000 centavos alocados com liquidez confirmada.

## Disposição do incidente Android

`QA-ANDROID-20261003-ANR`: timeout de entrada no build debug ao ocultar valores, observado
às 09:42, com dumps tardios de ProOps/SystemUI. Esperar não recuperou; relançar sem limpar
dados recuperou. Causa indeterminada. Stack em JavaTimer/PriorityQueue e RSS elevado
não identificam o chamador ou o início do bloqueio.

Três reproduções delimitadas em debug e uma execução no APK embutido passaram. A inspeção
estática não encontrou fornecedor do intervalo inválido suspeitado. Nenhuma correção de
timer foi aplicada. Esses resultados demonstram os fluxos testados e limitam a evidência
disponível; não demonstram que o incidente era exclusivo do Metro ou que foi corrigido.

Decisão: encerrar o gate funcional deste incremento com o incidente registrado. Novas
reproduções exigem uma hipótese ou evidência adicional. Os contratos financeiros, persistência, regressões de
UI e o fluxo independente do Metro passaram. A investigação de estabilidade permanece
aberta e acompanha os próximos testes nativos. Se ocorrer novo timeout, interromper o
incremento em execução e coletar a janela contemporânea de input/stacks antes da
recuperação. Uma alegação de estabilidade completa ou distribuição exige disposição
própria desse incidente; este aceite não fornece essa alegação.

## Qualificações restantes

Offline iOS, VoiceOver/TalkBack falados, medição de frames/fluidez e aparelho físico não
executados. Capturas estáticas não comprovam fluidez. O APK local diagnóstico usa assinatura
de desenvolvimento e OTA desativada; sua execução não valida o artefato/canal de distribuição.
Nenhum push, upload, publicação ou execução em produção.

Detalhes, falhas originais e recuperação: [registro nativo](registro-nativo.md).
