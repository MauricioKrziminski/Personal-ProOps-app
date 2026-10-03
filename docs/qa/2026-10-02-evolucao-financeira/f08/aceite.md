# F08 — aceite funcional no staging

03/10/2026. Branch `gabriel/financas-22-melhorias`, staging `utkqoiigimqzeenxkxdl`.
Planejamento conjunto de metas concluído nos cenários executados; F09 liberado.
O aceite permite continuar o desenvolvimento no staging. Produção e distribuição não foram alteradas.

Plano persistente por espaço, contribuição mensal/primeira data por meta, inclusão/exclusão,
sugestões explícitas, capacidade conjunta e comparação entre caixa e disponível integrados
às telas Metas/Projeção e aos componentes existentes. Simular/salvar plano não movimenta dinheiro.
Calendário civil/clamp, limite do último aporte, prazos/renda/origem desconhecida e reservas
com lastro acompanham o contrato financeiro vigente.

Escrita atômica com revisão/fingerprint, recibo privado selado, replay imutável e cancelamento
terminal; extração do protocolo compartilhado preserva o domínio F07. Três migrations no staging,
fixtures com rollback, quatro corridas reais em conexões distintas e controle negativo passaram.
Advisors mantiveram 23 warnings preexistentes e zero errors, sem novos achados.
Ver [contrato](contrato.md) e [registro SQL](registro-sql.md).

Gates finais: 1.936/1.936 testes, zero falhas/cancelamentos/skip; TypeScript/lint exit 0;
React Doctor zero erros e seis avisos de complexidade sem supressão. Score final indisponível
por conexão à API; não substituído pelo score de uma rodada anterior. RED→GREEN cobre também
recusa CAS, retry sem perder draft, geometria/expansão do resultado e loading somente durante fetch.
Ver [evidência de código](registro-codigo.md).

iOS e Android salvaram e leram reciprocamente os planos, inclusive após cold launch iOS.
Data 31, edição/exclusão/reinclusão, cancelamento, Mês/Ciclo, entrada pela Projeção, ocultação
visual/acessível e conflito com sessão aberta passaram. As nove fontes financeiras ficaram
iguais depois dos dois salvamentos. A limpeza foi limitada aos dois comandos criados por QA;
o snapshot final inteiro voltou ao baseline. Capturas selecionadas e resultados foram revisados
pelo agente principal. Ver [matriz nativa](registro-nativo.md).

Limites: perda de rede/resposta foi simulada nos testes de protocolo, sem injeção nativa F08;
rodada própria de tablet/fonte ampliada/temas/build sem Metro não executada neste incremento.
Android usou barra de escrita com stylus. Os limites não são certificados por passes antigos
do kit ou por testes de código. O incidente Android F07 continua aberto; nesta janela nativa
não houve novo marcador de ANR/crash. Nova ocorrência exige coleta contemporânea antes da
recuperação. Estabilidade completa e distribuição permanecem fora deste aceite funcional.
