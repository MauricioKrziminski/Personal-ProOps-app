# Entrada e filtros — plano de implementação

> Executar cada entrega com testes e validação nativa antes de avançar. Investigação e critérios em `docs/bugs/2026-09-30-entrada-e-filtros.md`.

**Objetivo:** registrar entrada sem duplicação financeira e oferecer recortes completos nas listas pertinentes.

**Arquitetura:** despesa com vínculo próprio ao contrato; criação atômica com chave por tentativa. Folha compartilhada para filtros com datas e aplicação explícita; consultas paginadas no servidor.

**Stack:** Expo SDK 57, React Native, TanStack Query, Supabase PostgreSQL, node:test, testes SQL com rollback.

## Restrições

Staging `utkqoiigimqzeenxkxdl`; produção fora do escopo. Centavos inteiros. Preservar histórico, cronograma, faturas e contrato do app em campo. Usar tokens e primitivos existentes. Não persistir filtros de visita. Testar limites inclusive data futura/entrada inválida, repetição e autorização por workspace.

## 1. Entrada em parcelamento/financiamento

- [x] Auditar modelos, gatilhos e salvar atuais; capturar ausência do campo no iPhone.
- [x] Escrever e observar falhar regressões SQL: entrada + 5 parcelas = preço, contagem invariável, retry sem duplicar, rejeição sem gravação parcial, workspace estrangeiro e exclusão.
- [x] Migration: referências próprias `transactions.down_payment_debt_id`/`down_payment_plan_id`, exclusão em cascata, unicidade e guarda de integridade. RPC `create_purchase` com JSON de contrato e entrada e request UUID; RPC para anexar entrada em contrato existente. Reutilizar núcleo atual de criação e incluir a entrada na simulação/conversão.
- [x] Helpers `src/lib/down-payment.ts`: cálculo de restante/custo total e validação; campos compartilhados com valor, data e conta.
- [x] Integrar no formulário único, criação/edição de compras e ficha de dívida; consulta do vínculo, edição/apagar pelo lançamento da entrada.
- [x] Aplicar migration em staging após testes rollback; regenerar types e revisar diff.
- [x] No iPhone, criar compra e financiamento, consultar entrada, corrigir/apagar e conferir saldo/contagem no SQL; documentar evidência.

## 2. Filtros completos

- [x] Capturar tela e reproduzir limite mensal; documentar listas pertinentes.
- [x] Testar datas inclusivas/viradas e validação de valor/intervalo com testes de comportamento.
- [x] `src/components/ui/list-filters.tsx`: folha de rascunho com Aplicar, Limpar, Cancelar; datas via calendário existente e seleção via primitivos.
- [x] Lançamentos: intervalo livre, critérios reunidos, mínimo/máximo; mesmos filtros para linhas gravadas e previstas. Previsões em blocos de até 62 dias. Paginação após filtro.
- [x] Reutilizar nos conjuntos pertinentes: notas, lembretes, importações e listas de contratos, com semântica da data explícita e consultas corretas.
- [x] Testar no iPhone combinando datas, valores, tipo, conta, busca e estado; cancelar/limpar, intervalos extensos e listas vazias; revisar temas e teclado.

## 3. Aceitação final

- [x] `npx tsc --noEmit`, `npx expo lint`, `npm test`, SQL afetados; se houver mudança no agente, ruff/pytest correspondentes.
- [x] Revisar diff integrado, critérios e eventuais problemas encontrados. Acrescentar resultados com comando/captura e limitações reais.
- [x] Corrigir regressões relacionadas comprovadas no QA: paginação/ordem da lixeira, texto corrigido pelo teclado, cartões AX, largura do botão e última semana do calendário.
- [x] Remover exclusivamente fixtures de staging pelo inventário de IDs, verificando preservação da fatura existente e seus movimentos.

Resultado: 1.324 testes passaram, TypeScript/lint limpos, SQL com rollback e aceitação nativa no iPhone. Evidência e limites em `docs/bugs/2026-09-30-entrada-e-filtros.md` e `docs/qa/2026-09-30-entrada-filtros/README.md`.
