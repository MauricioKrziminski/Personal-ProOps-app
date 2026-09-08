# Pagamento sem caixa, continuação do agente e financiamento simples

## Pedidos e causas

1. **Só marcar como paga:** a RPC `settle_invoice` já existia e não cria transferência, mas a ação estava escondida no menu de três pontos. A tela da fatura agora oferece duas ações visíveis: **Marcar como paga** (confirmação, sem conta ou valor digitado) e **Registrar pagamento** (transferência pela conta escolhida). O texto explica o efeito no saldo. A atualização das consultas continua aguardada pela mutation.
2. **Carro em 48x → 48x de 1470:** produção registrou `TypeError: save_draft() missing ... session_id` em 08/09/2026 às 20:07:14 UTC. O caminho que completava valor e ainda precisava de outro campo omitia a sessão. Os mocks permissivos não capturavam a quebra do contrato. Ambos os chamadores foram auditados; o chamador incorreto agora passa session_id. Os testes usam autospec e cobrem valor → cartão → histórico, total preservado e outra sessão intocada.
3. **Financiamento exigia muitos campos:** o formulário representava exclusivamente dívida por principal e taxa mensal. Esconder os campos e gravar taxa desconhecida como “sem juros” seria incorreto. A nova coluna `debts.calculation_mode` distingue `amortized` (padrão para todos os registros existentes) e `fixed_installments` (total contratual das parcelas, sem separar juros).

## Fluxo simples e detalhado

O novo cadastro começa em Simples. Só pede valor da parcela e quantidade total; nome, parcelas anteriores pagas (zero por padrão), vencimento e conta são opcionais em Adicionar detalhes. Nome vazio recebe Financiamento ou o próximo nome disponível. O resumo mostra o valor das parcelas que restam. Histórico informado é abatido uma única vez; cadastrar não cria despesas nem transferências.

Detalhado mantém principal, saldo devedor, taxa, conta e histórico. Cadastros anteriores continuam nesse modo. O modo de um contrato salvo não é convertido implicitamente. No simples, juros e principal separados ficam desconhecidos, inclusive nas RPCs de cronograma e prioridade; o zero interno serve apenas à aritmética do registro de pagamento. A UI e o agente não apresentam esse zero como ausência de juros.

O modo simples aceita parcelas integrais. Valores variáveis e amortização continuam no modelo detalhado. Após pagamentos registrados, o contrato e os saldos não podem ser reescritos por edição direta; o histórico de pagamentos continua sendo a fonte da evolução. Pagamentos reais continuam criando a despesa. A ação sem movimentar saldo descrita acima é para faturas, não reclassifica despesas existentes de contas comuns.

## Validação

- Backend: 563 testes passando; regressão do session_id reproduzida antes de corrigir; guardas de edição de dívida simples e apresentação da taxa desconhecida.
- App: 303 testes passando, TypeScript e lint sem erros. Interação das telas reais por JSX e estado com transportes simulados: dois campos suficientes; oito anteriores; história inválida; modo detalhado; edição legada; confirmação sem caixa da fatura; ações ausentes em fatura paga.
- PGlite: contrato fixo, juros desconhecidos, parcelas anteriores, pagamentos integrais, reversão, modo imutável e quitação; regressões anteriores de conta/fatura preservadas.
- Staging autenticado: 48×1470, oito pagas, quarenta restantes, parcelas e taxa desconhecida nas RPCs; pagamento reduz exatamente uma parcela; transação de teste revertida sem resíduos.
- Migration `20260908201355_fixed_installment_financing` aplicada em staging; tipos regenerados pelo CLI.

Esses testes não equivalem a uso no celular físico, nem a pagamento sobre dados reais de produção. O teste da continuação usa interpretação simulada e valida o contrato da sessão; não comprova toda interpretação de linguagem natural do modelo ou entrega real por WhatsApp.

## Publicação

- Código: `75339f4`, tag `v1.3.4`.
- Staging: backend `agente-staging-00073-6rh`, health ok.
- Produção: migration `20260908201355` aplicada em `kwriuifcwyvdrxtspjiz`, dry-run posterior sem pendências; backend `agente-00027-p85`, 100% do tráfego e health ok.
- APK: execução `34275053777` concluída com sucesso, 20:29:01–20:45:53 UTC: **16min52s** no total; etapa de build **13min03s**, Gradle **11min45s**. Cache nativo: 340/340 acertos, nenhuma perda. Acima dos 14min36s da 1.3.3 e abaixo dos 19min33s originais; não existe garantia de tempo fixo no runner compartilhado.
- Release `v1.3.4`, versionCode **16**, runtime `1.3.4`, source `75339f4`, ambiente production. APK baixado da release teve assinatura esperada verificada; hash igual ao manifesto e ao recibo nativo: `f18bcebeeee717879afcb93c9bc9cc324eab34ed8ab5b38ba904f2c0b130393e`.
- Emulador Android isolado: instalação `-r` sobre 1.3.3/code15 concluída, sem desinstalação; abertura da MainActivity com status ok e versão instalada 1.3.4/code16. Sem teste autenticado das novas telas no dispositivo físico.
