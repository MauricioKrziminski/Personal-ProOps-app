# F09 — evidência de banco

Target conferido antes de cada escrita: staging `utkqoiigimqzeenxkxdl`, branch
`gabriel/financas-22-melhorias`. Produção não participou dos testes.

## Schema e integração

Em 03/10/2026, o CLI oficial fez dry-run e aplicou apenas as cinco migrations F09:
`20261003192000`, `20261003192500`, `20261003193000`, `20261003194000`, `20261003201159`.
Tipos TypeScript foram regenerados do schema real, sem overlay temporário dos RPCs novos.

Os cinco arquivos `supabase/tests/subcategories_catalog.sql`, `subcategory_writes.sql`,
`subcategory_financial_metadata.sql`, `subcategory_import.sql` e `subcategory_reads.sql`
passaram no schema aplicado. Cada fixture usa savepoint, rollback e conferência final;
esses testes não deixam registros financeiros persistidos.

Antes da aplicação, 13 regressões financeiras também passaram na integração transacional:
classificação e suas escritas; edição recorrente uma/todas/futuras; pagamento e contrato de
financiamento com escopo; edição atômica parcelada; idempotência e quatro conversões.

Advisors antes/depois: 23 avisos existentes, zero erros, zero itens acrescentados/removidos.

## Concorrência real

Runner `/private/tmp/proops-f09-races.py`, executado pelo principal com `--execute`.
Duas conexões distintas, `READ COMMITTED`, `statement_timeout=30s`, `lock_timeout=10s`.
O sobreposto foi comprovado por `pg_stat_activity` e `pg_blocking_pids`, sem sleeps simulando
concorrência. Usuários sintéticos sem senha, identidade ou sessão; UUIDs registrados antes
dos commits em manifesto próprio.

| Caso | Resultado observado | Oráculo |
| --- | --- | --- |
| Mesmo request UUID e intenção | Ambos receberam o mesmo resultado selado; um filho | Replay não altera revisão, registros ou caixa |
| Requests diferentes, nomes equivalentes sem acento/caixa | Um vencedor; perdedor `PT409` | Um namespace, sem recibo residual do perdedor |
| Resolver cancela antes do writer tardio | Writer recebeu o cancelamento terminal | Zero filhos, mesmo resultado nas duas APIs |
| Move seguido de insert com pai antigo | Insert esperou lock real e foi recusado no commit, `23503` | Filho/registro anterior coerentes, sem órfão, caixa igual |

Os quatro cenários passaram. A limpeza verificou zero resíduos em 86 fronteiras UUID de
workspace/usuário por fixture, além de auth/perfil/recibos. Essa evidência é do protocolo SQL;
ela não simula perda de resposta HTTP ou execução nativa.

## Artefatos locais

- `/private/tmp/proops-f09-db-dry-run.log` e `proops-f09-db-applied.log`.
- `/private/tmp/proops-f09-sql-applied-proof.log`: cinco contratos no schema aplicado.
- `/private/tmp/proops-f09-regression.log`: 13 regressões.
- `/private/tmp/proops-f09-advisors-delta.json`: comparação exata antes/depois.
- `/private/tmp/proops-f09-races-results.jsonl`: locks, timestamps, SQLSTATE e limpeza.
- `/private/tmp/proops-f09-races-fixtures.json`: manifesto com `cleaned=true`.

Não confundir estes gates com aceite nativo, ainda em execução.

## Correção encontrada na execução nativa: prévia

A escolha do detalhe no iOS reproduziu `Campos de prévia inválidos`: o contrato F04/F06 da
prévia ainda recusava `subcategory_id`. A fixture nova falhou no schema anterior (RED).
A migration adicional `20261003205241_subcategory_financial_preview.sql` contém uma definição
estática da função aplicada, com apenas o campo opcional, `payment_category` do financiamento
e seis constraints F09 acrescentados. Nenhum replace dinâmico é executado pela migration.

O GREEN passou tanto `subcategory_financial_preview.sql` quanto toda `finance_write_preview.sql`
em REPEATABLE READ/rollback. A comparação dos atributos de pg_proc confirmou assinatura,
owner, ACL, configurações e SECURITY INVOKER idênticos. A nova fixture cobre paridade com
escrita canônica, null/omissão, entrada herdada, tarifa Pix excluída, referência inválida,
payload fechado e alteração de catálogo após insert seguida de recusa FK `23503`.

Dry-run listou apenas essa sexta migration; aplicada no staging e fixture novamente aprovada
no schema aplicado. iOS e Android depois exibiram prévia pronta com o detalhe selecionado.
Logs RED/GREEN/aplicação preservados em `evidence/sql/preview-*`.

## Tupla histórica do scheduler

A investigação confirmou que o agendador podia combinar kind/valor/conta atuais com pai/filho
históricos ao processar uma série atrasada após edição de futuras. SQL estático único agora
estabiliza R com FOR SHARE e CAS, seleciona toda a tupla de V pela data e adota ou cria a linha
atomicamente. Null histórico permanece null. Cursor e last_error também exigem a revisão lida;
uma intenção obsoleta aguarda nova rodada sem publicar cursor antigo ou erro enganoso.

O runner capturou o SQL e os seis parâmetros da implementação Python real. Cinco cenários
passaram no staging: tupla antiga/futura completa com replay único; null histórico diante de
novos defaults; adoção preservando null e pai/filho manuais; FUTURE após fetch e antes do SQL;
e FUTURE segurando lock enquanto a materialização espera. Neste último, pg_blocking_pids
comprovou o bloqueio real; após commit, PostgreSQL reavaliou a revisão e retornou
`intent_current=false, created=false`, sem gravação financeira.

Fixtures ordinárias foram revertidas. A fixture concorrente usou manifesto separado e a
limpeza confirmou zero resíduos nas 86 fronteiras, auth/perfil/recibos. Nenhum deploy do
serviço do agente foi realizado; a evidência é da implementação local executando o SQL real.
