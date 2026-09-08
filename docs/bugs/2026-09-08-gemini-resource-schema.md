# Gemini: schema de cadastros rejeitado

Data: 2026-09-08. Investigação isolada solicitada após `ResourcePlan` falhar no Gemini real, embora router e testes offline passassem.

Foram executadas **6 chamadas**, `gemini-3.7-flash`, `temperature=0.1`, `max_retries=0`, timeout 30 s, mesma biblioteca LangChain do serviço e chave configurada em `agent/.env`. Nenhum acesso ao banco, confirmação, execução de ação ou envio WhatsApp. Os scripts temporários importaram apenas configuração/schema/cliente Gemini e não imprimiram credenciais.

Entrada comum: criar cartão Nubank, fechamento dia 5, vencimento dia 12, limite 20 mil reais. Prompt de extração definiu nomes dos três campos e centavos inteiros.

| Schema testado | Resultado |
| --- | --- |
| `actions → fields → {name,value}`, sem `maxItems` | Aceito |
| Mesmo schema, apenas `actions.maxItems=10` | Aceito |
| Mesmo schema, apenas `fields.maxItems=20` | Aceito |
| Mesmo schema, `actions.maxItems=10` e `fields.maxItems=20` | 400 `INVALID_ARGUMENT` |
| Nomes/valores em arrays paralelos | Aceito |
| `fields_json` como string JSON | Aceito |

Todos os resultados aceitos extraíram `closing_day=5`, `due_day=12`, `credit_limit_cents=2000000`. Enum de ação com quatro valores, `target_month`/`name`/`value` anuláveis e objetos aninhados permaneceram nos testes estruturais.

**Causa demonstrada:** a combinação dos dois limites de arrays neste schema dispara a rejeição do provedor. Não é correto atribuir o defeito genericamente a campos anuláveis ou a qualquer objeto aninhado. O comportamento sugere expansão de complexidade por limites multiplicativos, mas não estabelece um teto universal documentado.

**Correção mínima recomendada:** preservar `list[ResourceField]`; retirar `max_length=20` da declaração enviada ao Gemini e impor esse limite com `@field_validator('fields')` na validação Pydantic local. Pode manter o limite exterior de 10 ações, aceito isoladamente. Manter também validação determinística de nomes/tipos do catálogo e confirmação antes de qualquer escrita. Strings JSON e arrays paralelos funcionaram, mas não são necessários para corrigir esta causa e perderiam clareza estrutural.

A implementação não foi alterada nesta investigação; o coordenador é responsável por `schemas.py`. Depois da correção, repetir o script de extração de recursos reais com mocks de banco para verificar o prompt completo e os demais cadastros.

## Implementação e revalidação final

O coordenador aplicou `field_validator`, preservando o limite de 20 campos no servidor e retirando apenas `maxItems` interno da representação enviada. A versão final também inclui `resource_pay`. O script reproduzível `agent/scripts/verify_resource_extraction.py` passou com router e extrator reais: cartão Nubank (fechamento 5, vencimento 12, limite 2000000 centavos), poupança Reserva (30000 centavos), pasta Trabalho, financiamento Carro (principal 6000000, saldo 5000000, taxa 0,01, 48 parcelas/8 pagas), pagamento de prestação (147000 centavos) e cadastro Inter incompleto seguido dos dias 8/15. Banco substituído; nenhuma ação executada.

Separadamente, o schema financeiro final com `new_account`, 15 propriedades e enum com 14 valores, foi aceito no Gemini real com o prompt final (`agent/scripts/probe_transaction_account_schema.py`). O limite medido de produto 210 é específico desse formato; não foi ampliado indiscriminadamente para os outros schemas.

Fonte oficial consultada: [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output), que descreve suporte parcial a JSON Schema e possível rejeição por complexidade. Os resultados da tabela vêm das sondagens reais desta sessão, não de uma garantia genérica da documentação.
