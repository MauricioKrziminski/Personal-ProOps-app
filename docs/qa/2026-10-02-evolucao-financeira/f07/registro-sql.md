# F07 — banco, idempotência e concorrência

Branch `gabriel/financas-22-melhorias`, staging `utkqoiigimqzeenxkxdl`, 03/10/2026.
Produção não consultada nem alterada. Credenciais, snapshots e capturas permanecem fora
do Git. O script de alvo precedeu as escritas e cada runner verificou o ref da conexão.

## Migrations aplicadas

- `20261003095440_emergency_reserve.sql`: três tabelas públicas, recibo selado privado,
  invariantes de workspace, leitura explicável, comando atômico/CAS e grants/Realtime.
- `20261003101544_emergency_reserve_indexes.sql`: seis índices de FKs após auditoria.
- `20261003114249_resolve_emergency_reserve_attempt.sql`: conferência e encerramento
  terminal de uma identidade pendente, reaproveitando o recibo privado existente.
- `20261003123201_emergency_reserve_business_conflict.sql`: conflito de revisão como
  `PT409`/HTTP 409, preservando integralmente o corpo do comando fora desse SQLSTATE.

Cada aplicação teve dry-run mostrando somente a migration prevista e push com exit 0.
A primeira migration aplicada permaneceu imutável. Types foram regenerados do staging;
o diff acrescenta somente as três tabelas e três RPCs públicas, preservando contratos antigos.

`supabase/tests/emergency_reserve.sql` passou contra o schema aplicado, exit 0. Os testes
de índices/permissões, funções sem execute de anon e regressão de resgate de metas também
passaram. Runners SQL abrem transação e fazem rollback em finally; sucesso não persiste fixtures.

## Invariantes exercitados

JSON fechado e tipos exatos, centavos seguros, alvo sem overflow, base positiva,
liquidez explícita, conta de cartão excluída, fonte arquivada/inválida, outro workspace,
duas metas disputando disponibilidade, ausência de origem no legado e teto de alocação.
Base observada distingue falta de revisão, classificação desconhecida e mês revisado
sem gasto; fingerprint muda com consumo/classificação e não com simples renomeação.
Alocação não modifica caixa, patrimônio, transações nem ledger de metas.

Recibos genéricos existentes são mutáveis pelo cliente e não autenticam execução F07.
Forja própria foi reproduzida antes do recibo selado; depois da correção, o comando
recusa forja e ignora adulteração genérica no replay legítimo. Triggers também recusam
FKs cruzadas entre workspaces, inclusive no caminho administrativo das fixtures.

Uma auditoria independente confirmou no banco aplicado o corpo exato da migration,
definer/search_path/fuso e ausência de SELECT/DML/TRUNCATE do recibo selado para anon,
authenticated e service_role. Replay de UUID da revisão 1 depois da revisão 2 devolveu
o recibo original antes do CAS. UUID stale novo repetido três vezes devolveu `40001`
e a mensagem contratual exata, sem recibos novos nem mudança de configuração/alocações/reviews.
Mismatch selado e recibo genérico forjado foram recusados antes desse marcador.
Essas provas iniciais usaram `40001`; no schema final, o marcador de negócio usa `PT409`.

## Duas conexões reais

Cinco cenários passaram, com PIDs distintos, `pg_stat_activity` e `pg_blocking_pids`
confirmando a espera real, não uma simulação de concorrência:

1. Mesmo UUID/payload: dois callers receberam o mesmo resultado; um recibo selado,
   um genérico e uma alocação, sem alteração de dinheiro.
2. UUIDs diferentes na mesma revisão: uma gravação ganhou; a outra recebeu `PT409`,
   sem recibo ou mutação da perdedora.
3. Aporte bloqueando a meta antes da reserva: aporte concluiu; confirmação do legado
   ficou obsoleta e a reserva recusou a gravação, sem deadlock. Nova conferência passou.
4. Reserva antes do aporte: aporte aguardou e concluiu; sua mudança ficou visível sem
   reescrever a reserva e sem deadlock.
5. Edição de aporte com contribuição bloqueada antes da meta: a reserva concluiu sem
   lock invertido da contribuição; edição aguardou a meta e concluiu, sem deadlock.

Os pequenos aportes/edições desses experimentos ocorreram apenas nas fixtures sintéticas.
O runner terminou exit 0 e sua limpeza verificou 76 colunas de fronteira: zero auth users,
profiles, workspaces e resíduos das fixtures. Processo morto sem finally ou perda da
conexão durante limpeza não foi simulado; não se infere garantia contra esses casos.

A recuperação terminal teve mais dois experimentos com conexões reais. No primeiro,
encerramento segurou o advisory e a gravação original aguardou; após commit, a original
recebeu `{workspace_id,cancelled:true}`. Zero configurações, alocações, reviews ou recibos
genéricos; um recibo terminal. No segundo, gravação segurou o advisory e conferência
aguardou; ambas devolveram o mesmo sucesso, revisão 1, uma configuração/alocação e um
recibo de cada tipo. Replay em ambas as ordens preservou os registros e o dinheiro.
`pg_stat_activity` e `pg_blocking_pids` confirmaram espera `Lock/advisory` nas duas ordens.
Runner exit 0; duas fixtures removidas com zero resíduos nas 76 colunas de fronteira,
incluindo usuários de auth, profiles e workspaces criados pelo trigger de cadastro.
Os cinco cenários originais foram repetidos após a quarta migration: todos passaram,
incluindo a recusa `PT409`, com zero resíduos nas mesmas 76 colunas.

## Conflito pelo HTTP real

O teste nativo Android de revisão obsoleta recebeu timeout, enquanto SQL direto recusava
imediatamente e a RPC de encerramento respondia na mesma rede. O SDK instalado não repete
esses POSTs. A documentação oficial descreve retry interno de `40001` no PostgREST 14;
a versão exata do serviço não foi confirmada (OpenAPI retornou 401). A causa é compatível
com a reprodução, não inferida apenas da conectividade VALIDATED do emulador.

A correção trata CAS como conflito de negócio `PT409`, sem declarar uma falha transitória
de serialização. Migration nova; nenhuma anterior foi reescrita. RED SQL exigindo PT409
falhou no schema anterior; a migration e a suíte inteira passaram em rollback e depois
no schema aplicado. HTTP autenticado recusou duas chamadas do mesmo UUID em 81 ms e 39 ms,
status 409/código PT409/mensagem contratual; estado completo antes/depois idêntico.
O cliente continua reconhecendo o marcador anterior por compatibilidade, mas não libera
um commit desconhecido por qualquer erro genérico da classe 40.

Referência: [Supabase — retries de 40001 em RPC](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
Não houve restart do projeto ou encerramento indiscriminado de backends.

A suite SQL aplicada passou novamente após a terceira migration. Além de original
atrasada e UUID corrigido, exercitou adulteração genérica após cancelamento, sucesso
selado após outra revisão, payload diferente, sessão ausente, outro workspace e membership
revogada. Encerramento não revalida saldo ou classificação obsoletos: sua única mutação
é selar a decisão da identidade autenticada. Falha na própria conferência não libera
uma tentativa no cliente sem comprovante.

## Advisors e limites

Inventário inicial 84 achados; após criação, 92; após índices e testes, 85; após a
recuperação terminal, 86. Nenhum novo WARN/ERROR. Os INFO novos são RLS sem policy no
recibo privado (deny-by-default intencional, sem grants ao cliente) e `table_bloat`
na tabela genérica preexistente `private.payment_write_requests`. Não houve limpeza
ou mudança dessa tabela fora do F07. Achados preexistentes não foram corrigidos.

A monotonicidade usada no protocolo pressupõe workspace preservado e escritores do
comando. Reset administrativo de revisões ou exclusão/recriação do mesmo UUID não são
operações certificadas por esse protocolo. Não houve deploy, release ou escrita em produção.

Logs privados: `/private/tmp/proops-f07-{sql-applied,concurrency,index-security,goal-regression}.log`,
`/private/tmp/proops-f07-sealed-cas-{sql,applied-audit}.log` e advisors privados before/after/final.
Recuperação: `/private/tmp/proops-f07-resolution-{dry-run,push,sql,concurrency}.log`.
