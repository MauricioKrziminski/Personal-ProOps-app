# EV06 — Contrato recorrente e ocorrência materializada no iOS

**Resultado:** contrato mensal (`a3a76ecc-a69f-4ddd-b040-f6068308c57a`) de R$ 32,10 com forma Boleto e conta bancária. Duplo toque em “Criar” persistiu um único contrato. A ocorrência materializada (`dcb36447-bc66-475c-b493-6cfbc2904e7c`) de 02/10 foi confirmada como Boleto pela UI e pelo snapshot SDK. A abertura/edição e a ocorrência de novembro também mostraram Boleto.

- Criação: `/private/tmp/proops-f01-ios-recurring-create-run.log` e `/private/tmp/proops-f01-recurring-ios-proof.json`.
- Materialização: `/private/tmp/proops-f01-ios-recurring-open-edit-run.log` e `/private/tmp/proops-f01-ios-one-anchor-proof.json`.
- Navegação da ocorrência de novembro: `/private/tmp/proops-f01-ios-nov-tap-run.log` passou na asserção visual Boleto.
- Após alteração para escopo único, “só esta ocorrência” foi verificado na UI e no snapshot `/private/tmp/proops-f01-native-post-one.json`: ocorrência de 02/10 Debit; ocorrência de 02/11 Boleto; padrão da série Boleto.
- Cobertura completa dos três escopos iOS está em [EV08](08-escopos-recorrencia-ios.md). A propagação de escopos no Android continua pendente.
