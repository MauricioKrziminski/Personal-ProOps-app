# F03 — saldo e limite no seletor

Estado: implementado e aceito no escopo F03 após o F02 (`83f103b9`). Evidência e limites em [registro nativo](registro-nativo.md).
Branch `gabriel/financas-22-melhorias`; somente staging `utkqoiigimqzeenxkxdl`.

## Contrato

O seletor contextual conserva nome, tipo, agrupamento e fechamento. Uma terceira linha
mostra Saldo no ProOps (confirmado, sem receitas pendentes) ou Limite disponível
(resumo derivado de todas as faturas ainda comprometidas). O número não representa
consulta bancária em tempo real. Zero é um número válido, negativo mantém o sinal.
Saldo/limite insuficiente não desabilitam uma origem nem impedem um registro histórico.

Queries agregadas com chaves compartilhadas: no máximo uma consulta de saldo
e uma de cartão por ciclo de cache, sem consulta por opção. Tipos ausentes não consultam
a fonte correspondente. Metadados são opcionais: filtros continuam sem contexto monetário.
O seletor das operações, pagadora de cartão, pagamento de fatura/dívida e importação
reutilizam o mesmo componente e comportamento. Nenhuma tela nova ou dependência nativa.

Estado inicial mostra carregamento; erro, linha ausente ou centavos inválidos mostram
indisponibilidade e permitem atualizar sem perder a escolha. Pausa por conexão não inventa
um número. Refetch com dado válido indica atualização; erro posterior não deixa dado antigo
parecer atual. Não usar saldo inicial como fallback nem converter ausência em zero.

Cartão usa a nova RPC invoker `card_limit_context`, que preserva o cálculo canônico de
`card_summary` para registros completos, sem somar somente a fatura visível. Ela conserva
limite null, distingue zero e informa qualidade. Saldo inicial assinado no cartão,
débito sem fatura, receita/estorno ou transferência de entrada sem vínculo de pagamento
produzem `needs_review` e limite disponível null: a regra vigente de faturas não explica
completamente esses estados históricos. Não corrigir isso somando o saldo bruto, que
duplica principal adiado. O seletor mostra Limite precisa de conferência. Essa consulta
de leitura não reescreve dados, faturas nem a semântica das operações existentes.

SQL de rollback prova futuras parcelas, parcial, adiamento/encargos e desfazer,
quitação manual/desfazer, null/zero/negativo, estados incompletos e RLS por JWT.

Privacidade afeta texto visível e rótulo acessível, inclusive antes da preferência voltar
do disco. Máscara fixa existente; nada de magnitude, sinal ou saldo bruto no accessibilityLabel.
Campos de decisão digitados mantêm o comportamento atual. Nomes e textos quebram linha;
foco, voltar, cancelamento e animação de escolha continuam no SelectField/Presenca.
Texto monetário dentro das camadas de animação lê a privacidade atual, protegendo também
um snapshot anterior enquanto a lista ou o cabeçalho terminam sua transição.

## Verificação

RED/GREEN do saldo confirmado versus previsto, limite null/zero, valores inválidos/overflow,
carregamento/erro/pausa/refetch e ocultação. Harness do componente real: seleção continua
funcionando, recuperação não seleciona uma conta, identidade filtrada é preservada,
trocar privacidade remove o valor visual e acessível. Testar lista com muitas contas sem N+1.

TypeScript/lint/Node, SQL rollback de obrigações, React Doctor e execução real iOS/Android.
Conferir valores por leitura do staging, troca/método/criação F02, casos de saldo negativo e
cartão sem limite, claro/escuro, fonte ampliada/teclado. F04 depende do aceite deste ponto.
