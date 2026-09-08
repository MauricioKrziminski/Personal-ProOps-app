# Baixa limitada de parcelas — diagnóstico antes da correção

Caso: carro em 48 parcelas de R$ 1.470; “Todas as 8 anteriores do carro, marque como pagas” e “As 8 parcelas anteriores criadas do carro, marque como paga”. Esperado: parcelas 1–8, R$ 11.760, demais 40 preservadas.

Causas comprovadas por leitura do código antes da alteração:

- `FinanceAction` não expressa quantidade/intervalo de uma mutação. `current_installment` significa posição atual na criação, mas o prompt manda usá-lo como limite inclusivo na baixa, e usa quantidade+1 na correção.
- `resolve._com_plano` promove referências a parcelas ao plano inteiro. Seu rótulo é sempre “Tudo (48x)” e o detalhe usa `total_cents`, sem representar subconjunto. Portanto a confirmação não garante a intenção quantitativa, mesmo quando um número sobrevive à extração. O detector de plano inteiro também precisa perder precedência para limites explícitos.
- `finance._baixa_em_parcelas` usa guarda que transforma valores inválidos/ausentes em 1 e chama `shift_installment_plan`. Esta função recalcula a data inicial, reescreve todas as datas e marca as demais parcelas pendentes. Baixa não deve reprogramar vencimentos nem desfazer pagamentos fora do escopo.
- O checkpoint congela somente o ID do plano, sem os IDs/valores/datas das parcelas revisadas. A execução pode alcançar registros não revisados.
- A criação chama a RPC histórica de seis argumentos que deriva status da data. Data passada e posição atual não comprovam pagamento. É necessário obter histórico pago explícito, preservar rascunho e enviar a quantidade à RPC.

Correção pretendida: seleção explícita tipada, limites antes da resolução genérica, confirmação de quantidade/intervalo/total real e snapshot das parcelas; baixa SQL atômica restrita ao snapshot, recusando alteração concorrente. Checkpoints antigos sem snapshot devem ser recusados. Exclusão integral continua separada de baixa. Nenhuma escrita financeira real faz parte desta investigação.

## Implementação e evidência

- As duas frases exatas reproduziram primeiro a confirmação incorreta `dar baixa em Tudo (48x) — carro (R$ 70.560,00 total · desde 08/01/2026)` nos testes vermelhos. A versão corrigida confirma `8 parcelas (1–8) — carro`, soma real R$ 11.760 e datas do subconjunto.
- `InstallmentScope` aceita primeira/última quantidade, intervalo inclusivo, período de datas e total explicitamente solicitado. Limites numéricos reconhecíveis no texto prevalecem sobre extração conflitante. Limite vazio, inválido, maior que os registros ou com lacunas pede esclarecimento; não muda para total.
- Resolução lê parcelas pelo plano/workspace, sem depender da janela das últimas 40 transações. Cada candidato carrega snapshot dos IDs, números, valores, vencimentos, estados e datas de baixa, conta e fatura. Escolher um plano ambíguo ainda exige confirmar seu resumo específico.
- Uma única instrução SQL bloqueia os registros revisados, compara todos os campos e só então atualiza os IDs congelados. Qualquer registro removido, movido de workspace ou com valor/data/status divergente impede o lote inteiro. Baixas já existentes preservam sua data. O código antigo de deslocar calendário foi removido.
- A criação exige histórico explícito quando há data passada ou parcela atual maior que 1. O slot `already_paid_count` preserva o rascunho e posição atual, aceita zero e usa a RPC `create_installment_plan_with_history`. Informar posição atual não comprova pagamento. Na conversão para financiamento, somente contagem explicitamente informada é preservada.
- Dívidas são registros agregados separados de planos de cartão. Uma baixa histórica de várias parcelas em `debts` não vira novos pagamentos: pergunta se o histórico já está refletido no saldo e pede saldo devedor atual junto da quantidade paga. A correção de contagem exige esse saldo explícito; não calcula amortização multiplicando prestações. Pagamento singular continua pelo fluxo próprio da dívida.
- Gemini real rejeitou expansão aninhada e `maxItems=10` no schema ampliado (`400 INVALID_ARGUMENT`). O formato de transporte compacto (`first:8`, `range:3:3`, etc.) é convertido pelo Pydantic em objeto tipado; limite de dez ações permanece validado localmente. A API aceitou o schema final com 17 propriedades × 14 ações. `NotesAction` permanece fora dessa ampliação.
- A sondagem real também mostrou omissão de `amount_cents` na criação. O padrão explícito `48x de 1470` agora repõe deterministicamente o total de R$ 70.560 em vez de tratar R$ 1.470 como total; oito já pagas sem outra data/posição ancora a nona no mês corrente.

Validação reproduzível (dados fictícios, sem escrita remota):

```
agent/.venv/bin/python -m pytest agent/tests -q
node supabase/tests/installment_scope.mjs /tmp/proops-finance-sql-20260908/node_modules/@electric-sql/pglite/dist/index.js
# No diretório agent; usa Gemini, sem acessar banco ou WhatsApp:
.venv/bin/python scripts/probe_bounded_installments.py
```

PGlite executa o SQL real exportado da ferramenta: exatamente 8 de 48, outras 40 e calendário intactos, recusa atômica de sete cenários de confirmação desatualizada/ownership, preservação de `paid_at` já existente. Grafo com checkpoint real em memória pausa no resumo e retoma sem refazer a resolução. A sondagem Gemini cobre as duas frases da foto, somente terceira parcela, criação na nona sem presumir pagamento e criação com oito explicitamente pagas. Isso não equivale a validação WhatsApp entregue/dispositivo real, nem aplica migrations ou corrige dados existentes automaticamente.

Revisão adicional: lotes com limites de parcelas para mais de uma compra pedem uma compra por mensagem, evitando aplicar um número do texto global ao item errado. As últimas N parcelas são verificadas contra o número original de parcelas do plano; excluir a parcela final não desloca a seleção para outras parcelas. Conta e fatura também são congeladas, exibindo a conta no resumo; mudança em qualquer vínculo recusa o lote. Correção de histórico inicial de dívida é permitida somente sem pagamentos registrados no ledger; a execução também verifica ausência de pagamentos, além do `xmin` congelado.
