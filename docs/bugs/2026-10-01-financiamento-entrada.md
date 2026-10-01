# Entrada: validação, expansão e preservação de histórico

## Pedido e ambiente

Ativar “Paguei uma entrada” no financiamento demorava a revelar os campos e já mostrava o valor vazio em vermelho. O pedido inclui criação, edição, remoção/reinclusão, datas, contas e conversões entre tipos, com validação nativa e financeira.

Checkout `main`; baseline `6d9e93fd`. QA financeiro somente em staging `utkqoiigimqzeenxkxdl`. Produção `kwriuifcwyvdrxtspjiz` não recebe fixtures nem esta migration durante QA.

## Reprodução e causas

1. iOS: interruptor ativado sem tocar no valor; surgiram “Informe o valor da entrada” e “Escolha a conta da entrada”. `DownPaymentFields` calculava erros no render e marcava o valor inválido incondicionalmente. O bloco montava os controles/animações no primeiro toque. Vídeo e captura anteriores em `docs/qa/2026-10-01-financiamento-entrada`.
2. Trocar cobrança de parcela fixa para juros, no modo total R$1.200 com entrada R$200, derivava principal R$1.200 em vez de R$1.000. O helper não descontava a entrada ao mudar o sentido do valor.
3. Financiamento com entrada paga e zero prestações pagas não era considerado histórico. A opção simples “Converter” mandava `todas` e apagava a entrada sem confirmação destrutiva.
4. Parcelamento com entrada, convertido “Desta em diante”, perdia a entrada ao desfazer o plano com zero/uma prestação histórica. O plano era apagado e o FK `ON DELETE CASCADE` levava a entrada. SQL RED observado no staging, com rollback: `RED CE 1: entrada histórica perdida/alterada`.
5. Revisão encontrou consulta da dívida ainda pendente/erro permitindo conversão com `passado=0`. A autorização destrutiva depende do histórico carregado, não da rota.
6. Ida e volta financiamento → recorrente → financiamento, mantendo o nome, falhou nativamente com `23505`. O contrato arquivado reservava o nome para sempre. O índice agora reserva nomes entre contratos ativos do mesmo workspace; o histórico conserva seu nome e ID. Colisões entre ativos continuam recusadas atomicamente, com mensagem legível.
7. A cobrança podia ser selecionada ao editar um financiamento, mas o salvamento recusava a troca e a RPC não aceitava `calculation_mode`. O patch e a RPC agora derivam os valores pelo modo de destino. Com pagamentos reais, a troca aplica-se às próximas parcelas e mantém os registros antigos; a tela não oferece o alcance `all` que exigiria reescrever sua economia. Declarações de parcelas pagas também conservam suas estimativas.
8. Na aceitação nativa, reduzir o plano com entrada de 5x para 1x falhou com “O vínculo da entrada não pode ser alterado”. A comparação incluía `updated_at`, que o `moddatetime` atualiza em outro salvamento. O teste anterior criava e desfazia dentro da mesma transação, mascarando a recusa. Um teste novo simula uma entrada salva antes, independentemente da primeira parcela ser passada, hoje ou futura. A guarda aceita somente o timestamp de auditoria automático; os campos financeiros continuam iguais e UPDATE direto/adulteração nested continuam recusados.

9. No retorno “ainda tá com delay”, a gravação reproduziu o problema mesmo depois de preparar os controles: altura e opacidade ainda dependiam do progresso da mola. O espaço inicial de 16dp ficava dentro do recorte e a caixa só aparecia parcialmente nos primeiros quadros. Não havia timer/delay configurado no interruptor. Preparar evitava a montagem inicial, mas não eliminava essa dependência visual. Agora a entrada ocupa seu espaço natural e recebe opacidade 1 diretamente no render do estado; um componente separado anima somente 4dp de deslocamento em 120ms, sem espera de medição, recorte ou callback para liberar o input. Ao fechar, altura/opacidade zeram imediatamente e touch/acessibilidade são desativados. O caminho de expansão padrão permanece igual.

## Regras preservadas

A entrada é uma despesa separada com valor/data/conta próprios, nunca prestação nº1. No total da compra, subtrai-se antes de dividir; no valor por parcela, soma-se ao custo total. Editar/remover/adicionar entrada em contrato existente não reescreve saldo nem número de prestações.

“Desta em diante” preserva histórico; “Manter” preserva a origem; “Todas” apaga deliberadamente, com confirmação. Plano que se desfaz conserva entrada como avulsa com o mesmo ID/data/conta/fatura. Remover um plano manualmente esvaziado também conserva esse fato pago; a exclusão completa do app/agente usa a RPC que apaga entrada e contrato atomicamente.

## Implementação e verificação

- Validação por interação de cada campo, sem erro/foco automático na ativação. Ao desativar e reativar, mantém valores e reinicia o estado de revisão.
- Controles da entrada preparados antes do toque e ocultos de toque/acessibilidade. Após o retorno sobre atraso residual, revelação inteira imediata com movimento apenas cosmético; a expansão por mola do restante do app não foi alterada.
- Troca de cobrança deriva somente o saldo financiado.
- Entrada paga participa da confirmação de conversão; consultas pendentes/falhas bloqueiam inferência do histórico.
- Migration nova `20261001155149_preserve_purchase_entry_on_conversion`: preservação estrutural de entrada no plano sem parcelas, sem reinserir o lançamento/recalcular fatura, sem GUC e sem alteração de RLS. Exclusão completa via `delete_installment_purchase`.

As migrations novas foram revisadas e verificadas com candidatos dentro de rollback antes de cada aplicação ao staging:

- `20261001155149_preserve_purchase_entry_on_conversion`
- `20261001171444_debt_name_unique_active`
- `20261001172533_preserve_debt_history_on_mode_switch`
- `20261001174439_allow_automatic_entry_detach_timestamp`

CLI dry-run e `scripts/supabase-target.sh` confirmaram cada aplicação ao staging `utkqoiigimqzeenxkxdl`. Produção não aplicada; não foi publicado novo build desta correção.

`converter_entrada.sql`: 153 combinações, mais faturas pagas/adiadas/parciais, arquivo, exclusão, idempotência, autorização e falhas atômicas. `debt_contract_mode_switch.sql`: 36 trocas future com origem fixa/juros, declaradas/reais 0/1/2 e ida/volta; edição/exclusão posteriores e invariantes de histórico. `down_payment_detach_audit_timestamp.sql`: 12 casos de idade/data/conta, mais adulteração/atomicidade. `debt_active_name_unique.sql`: nomes ativos, arquivados, conflitos, desarquivamento, retry e RLS. Regressões existentes de entrada, conversão e edições passaram com rollback.

Aceitação nativa: iPhone 17 Pro / iOS 26.5, app dev SDK 57 com JS deste checkout via Metro e staging. Primeiro toque sem erro nem foco na entrada, erro após revisar o valor vazio e desaparecimento após corrigir. Criação total e por parcela, remoção/reinclusão, conta/data, financiamento↔recorrente com nova entrada, troca de modo existente nos dois sentidos com prestação real e redução 5x→1x conservando entrada avulsa. Saldo, quantidade, IDs e JSON dos pagamentos foram comparados no banco após a interação.

Gates após a correção de atraso residual: 1.425 testes Node; TypeScript e lint saída 0; `git diff --check` saída 0. Os 26 testes Python do consumidor de exclusão passaram na etapa financeira anterior, sem alterações posteriores nesse consumidor. React Doctor: 0 erros e os mesmos 3 avisos de complexidade existentes; os JSON de diagnóstico anterior/final são integralmente idênticos. Score reportado 83/100 (antes 87/100), sem diagnóstico novo ou suprimido; a pontuação não prova comportamento nativo. Android não alcançou o formulário devido a ANR do ambiente, descrito no relatório.

A aceitação final da abertura foi refeita em sessão limpa no simulador iOS: quatro alternâncias confirmadas pelo switch nativo, sem foco/erro ao abrir, campo inteiro no início da ativação, digitação de R$123,45 logo após reabrir sem aguardar conclusão, fechamento com teclado ativo e reabertura preservando o rascunho. Os testes automatizados conferem também altura/opacidade em estilos comuns, sem executar qualquer worklet, reversões, cancelamento e reduced motion. A gravação anterior de expansão é uma etapa intermediária, não a evidência final desse retorno. Não foi capturado perfil de CPU válido: a conexão do inspector foi encerrada ao pedir `Profiler.enable`; não se afirma custo JS, latência zero ou benchmark de FPS.

Evidências e matriz por camada: [README de QA](../qa/2026-10-01-financiamento-entrada/README.md). Limpeza atômica por IDs próprios confirmada em conexão nova; fatura existente e seus quatro movimentos integralmente preservados. A evidência anterior de 30/09 cobria criação, alteração de valor, remoção e inclusão em financiamento existente no iOS; a matriz nativa ampliada não havia sido documentada antes deste pedido. Não se afirma que todas as combinações SQL foram repetidas manualmente, nem que houve aceitação Android ou iPhone físico nesta tarefa.

## Auditoria adicional solicitada: pendências e regressões

Novos defeitos reproduzidos e corrigidos nesta revisão:

10. A validação comparava o valor de **cada parcela** com a quantidade de parcelas: 12×R$0,01 com entrada R$1 eram bloqueados. A regra de pelo menos um centavo por prestação agora compara o restante somente no modo **total**. Teste RED/GREEN e mesmo rascunho nativo antes/depois; total insuficiente, valor zero e quantidade inválida continuam recusados.
11. Desligar/ligar a entrada com conta ou calendário aberto reabria a escolha expandida. Agora a saída conserva seu desenho, a reativação fecha só a interface e conserva valor/data/conta. Callbacks capturados de uma visita anterior, ocultos ou após desmontagem não alteram o rascunho.
12. O botão de fim de mês escapava da proteção de geração do calendário: um callback antigo de setembro podia escolher setembro numa visita nova a junho; chamar o mesmo handler duas vezes emitia duas datas. O handler confere a intenção atual (visita, valor, mês e limites) e emite uma vez por escolha. Uma seleção confirmada pode alternar normalmente entre dia fixo e último dia.
13. Depois de reativar uma entrada preenchida, diminuir o total podia bloquear Salvar sem mostrar a razão. O erro de limite agora aparece para valor positivo mesmo após reiniciar a revisão; campos vazios recém-abertos permanecem sem erro prematuro. Conta/data inválidas não pintam o valor.
14. Excluir financiamento ou converter **Todas** removia entrada de fatura paga, adiada ou parcialmente paga. A exclusão trava e verifica a fatura antes de remover qualquer pagamento/entrada/contrato; a recusa é atômica e informa como desfazer o pagamento. Faturas abertas/fechadas sem pagamento continuam permitindo a operação.
15. A conversão legada repetida depois de uma resposta perdida criava outro destino. A nova assinatura de quatro argumentos reserva uma chave antes de acessar a origem e guarda o resultado na mesma transação. Repetir a tentativa retorna os mesmos IDs, inclusive depois de Todas apagar a origem. Os dois caminhos do app que convertem com entrada conservam a chave por intenção durante retries; dados/alcance alterados recebem nova chave. A assinatura antiga permanece compatível.
16. Duas conexões reproduziram pagamento/adiamento do saldo antigo após outra apagar a entrada. Pagamento, adiamento e baixa histórica agora travam a fatura **antes** de ler estado/saldo. A baixa histórica também podia sobrescrever a transferência de um pagamento simultâneo ou marcar fatura adiada sem retirar seu saldo da próxima: preserva pagamento confirmado e exige desfazer adiamento antes.
17. No iOS, o campo monetário ficava atrás do teclado após o Nome. `caretHidden` faz o React Native devolver um retângulo zero; o controller rejeita a altura zero da seleção e pode conservar a geometria anterior. O cursor nativo agora mantém sua medida e é transparente no iOS, enquanto o cursor/odômetro próprios continuam visíveis. Android mantém seu comportamento. Não foi alterado o mecanismo de rolagem. Instrumentação temporária foi removida.

As três migrations adicionais foram revisadas, testadas como candidatas e aplicadas **somente em staging** após target/dry-run:

- `20261001191024_protect_debt_entry_invoice_on_delete`
- `20261001192212_idempotent_record_conversion`
- `20261001194502_lock_invoice_before_settlement_balance`

Após integração: **1.438 testes Node, zero falhas/ignorados/cancelados; TypeScript e lint saída 0**. React Doctor: 83/100, zero erros e os três avisos anteriores de complexidade, sem supressão. Banco aplicado: proteção de entrada e 14 cenários sequenciais de retry; 153 conversões e 36 trocas de modo novamente aprovadas com rollback. Runner concorrente: **14/14**, com duas sessões autenticadas, bloqueios observados, pagamento/adiamento/exclusão em ambas ordens, baixa histórica, RLS e retry concorrente de Todas. Fixtures isoladas limpas.

A validação no iOS incluiu conta/calendário fechados após reativação, preservação de valores, escolha de data, 12 prestações mínimas com entrada, limite do total e campo completo acima do teclado, incluindo mudança de foco entre campos com teclado aberto. A amostragem nativa e os testes SQL não constituem prova de todas as combinações em Android/iPhone físico. Produção e novo build permanecem separados da QA em staging.

A proteção de fatura foi confirmada pelo app iOS usando somente uma fixture própria: financiamento com entrada de R$200 no cartão e fatura paga pela RPC normal. **Apagar por completo** e **converter Todas para recorrente** exibiram a recusa esperada; a conversão de quatro argumentos foi resolvida pelo PostgREST e o formulário permaneceu disponível após o erro. Uma conexão nova comparou integralmente contrato/fatura/movimentos após as duas ações. A limpeza posterior removeu somente contas, contrato, entrada, fatura, pagamento e request próprios; outra conexão confirmou todas as linhas financeiras anteriores iguais ao baseline. O relatório publica somente o snapshot da fixture e hashes do baseline.

O runner de concorrência usa cópias de funções em `pg_temp`, duas sessões autenticadas e fixtures isoladas com commit, removidas no `finally`; não altera DDL compartilhado. Conferência adicional em leitura confirmou que os sete corpos de RPC aplicados em staging são exatamente os candidatos aprovados no runner e que todos continuam `security invoker`. As migrations novas desta tarefa totalizam sete; nenhuma foi promovida para produção.

## Verificação dos consumidores compartilhados antes da v1.6.3

Revisão independente e reproduções locais identificaram mais uma borda das guardas: header e botão de fim de mês capturados com o campo **já fechado** ainda podiam atuar depois de ocultar/reativar sem alterar valor. Não havia evidência de regressão introduzida frente ao baseline, mas a guarda anterior não cobria essa visita. Três testes RED/GREEN confirmaram e fecharam o caso. Seletores e calendário agora conferem também a geração da presença; não é necessário remontar controles nem atrasar a entrada.

O caminho imediato de presença continua opt-in somente na entrada; o caminho tradicional de Perfil/bloqueio/alertas/arquivados permanece preservado. A mudança do cursor iOS foi exercitada também em contas/saldo e orçamento/limite: digitação, apagamento em centavos, caixa acima do teclado e escolha/troca da opção atual. Recorrência passou por mensal→semanal→mensal, seleção de último dia e data fixa, sem salvar dados. A máscara, quantidade, limites e valores desses campos não foram alterados.

Gates finais: **1.441 testes Node, 1.218 Python, 57 de movimento; TypeScript/lint saída 0**. O Python revelou um teste antigo que procurava a constante de juros Pix no hook; o hook já a importava de `src/lib/escrita.ts` no baseline. O teste de paridade passou a ler a declaração vigente, sem alterar a regra de juros. Onze regressões SQL compartilhadas de entradas, conversões, parcelamentos, edições e faturas foram novamente aprovadas em staging com rollback. React Doctor permanece em três avisos existentes, sem novo diagnóstico.

Após a autorização de publicação, as sete migrations listadas foram promovidas à produção `kwriuifcwyvdrxtspjiz`. Dry-run confirmou exatamente esse conjunto, sem seeds/roles/vault; histórico conferido em conexão nova. Não houve fixture financeira de QA em produção. Estado da distribuição em [release v1.6.3](../releases/2026-10-01-v1.6.3.md).
