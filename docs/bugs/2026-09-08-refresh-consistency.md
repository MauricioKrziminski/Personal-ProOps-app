# Consistência de atualização — investigação 08/09/2026

Base inspecionada: `main`, `bc757af`. Sem escrita financeira, migration ou deploy. Expo SDK 57 consultado antes de implementação: https://docs.expo.dev/versions/v57.0.0/.

## Causas confirmadas por leitura do fluxo

1. `useSettleInvoice` e `usePayInvoice` chamam `useInvalidateFinance`, cuja lista omite `card-invoices` (histórico) e `installments` (parcelas). Assim a mutation atualiza o detalhe mas o histórico depende de evento Realtime. O mesmo conjunto omite relatórios, simulação e séries derivadas.
2. `useInvalidateFinance` descarta as promises; `mutateAsync`/sucesso da UI podem terminar antes de atualizar as leituras ativas. Alguns callbacks adicionais repetem esse problema.
3. `useAplicarTurno` só invalida conversas e cota. Escritas financeiras/notas/lembretes da IA dependem exclusivamente de Realtime. Turnos recuperados por polling também não notificam as outras leituras.
4. `refetchOnWindowFocus: false` e ausência de ponte AppState/TanStack deixam retorno ao app sem atualização. Retorno à rota montada não é remontagem nem foco de janela. O comentário de alertas promete foco sem implementá-lo.
5. Hoje (ScrollView) e Notas (FlashList) não têm refresh. Detalhe de fatura/lançamento, pastas, lixeira, alertas e busca também não oferecem recuperação por gesto. Screen usa RefreshControl mas não posiciona o indicador abaixo do header sobreposto.
6. Refreshs compostos descartam promises, usam apenas um `isRefetching` e esquecem consultas secundárias (ex.: Financeiro omite cashflow). O indicador pode encerrar com parte da página desatualizada.

## Matriz de auditoria antes da correção

| Escrita/origem | Leituras afetadas | Situação observada |
|---|---|---|
| pagar/baixar fatura | detalhe, histórico, parcelas, cartões, contas, transações, projeção, relatórios | histórico/parcelas e derivados fora da invalidação |
| criar/apagar parcelas; salvar/apagar/pagar lançamento | listas/detalhes, resumos, cartões/faturas, orçamento, patrimônio, simulação/relatórios | mesmo conjunto incompleto |
| salvar/arquivar conta | contas, saldos, cartões, projeção/patrimônio | derivados incompletos |
| dívidas, pagamento de parcela | dívida, cronograma, estratégia, projeção/patrimônio | cronograma só invalidado no pagamento; callback sem espera |
| metas, aporte | meta, aportes, saldo/projeção | aportes só no depósito; callback sem espera |
| bens, orçamentos, recorrências | listas e cálculos financeiros | séries/relatórios ausentes; criar recorrência usa callback local |
| importar/aprovar/descartar/editar/apagar lote | itens, histórico de lotes, cota; financeiro ao aprovar | criar importação sem invalidação; aprovar/descartar omitem histórico |
| notas/pin/lixeira/restaurar/excluir/pastas | prefixo notes inclui lista, item, tags, contagens | prefixo correto; busca global usa prefixo separado |
| lembrete salvar/pausar/excluir | lista, item, Hoje, busca | prefixo correto para lembretes; busca separada |
| perfil/push/preferências/convites/plano | respectivas consultas | prefixos locais adequados; recuperação ao foco ausente |
| IA concluída ou recuperada | financeiro, notes, reminders, busca, cota | somente conversas/cota atualizadas |
| Realtime de tabelas | detalhes e cálculos dependentes da tabela | cobertura parcial por hook, dependente das telas montadas |
| foco/retorno do app | consultas ativas vencidas | sem recuperação automática |

## Estratégia de validação

Regressões com QueryClient/QueryObserver reais, hooks carregados com transporte financeiro falso: liquidar fatura histórica deve atualizar histórico ativo e marcar caches inativos dependentes como stale; conclusão da mutation deve aguardar leituras ativas. Falhas do transporte não devem causar sucesso falso. Nenhuma chamada ao Supabase real.

Implementação/validação serão registradas abaixo após o ciclo vermelho/verde. Gesto, posição do indicador, retorno de background e integração Realtime real em Android/iOS precisam de validação nativa; teste Node não prova esses resultados.

## Implementado e verificado localmente

- Conjunto financeiro compartilhado inclui histórico de faturas, parcelas, relatórios/séries/simulação, cronograma/aportes e busca. Todas as 22 mutations financeiras auditadas aguardam a invalidação/refetch ativo. Caches inativos ficam stale para a próxima abertura.
- Importar/aprovar/descartar/editar atualiza histórico do lote diretamente; criação também atualiza cota. Notas e lembretes invalidam sua busca global após escrita direta.
- Resposta concluída da IA invalida os domínios graváveis. A leitura de histórico também detecta respostas concluídas recuperadas pelo polling já existente. Respostas ainda `processing` não invalidam os dados financeiros.
- Realtime compartilha um canal por tabela/QueryClient entre consumidores, com sufixo único para cada criação (remoção assíncrona não colide com remontagem). Eventos financeiros são agrupados numa janela fixa de 50 ms; evento durante uma leitura agenda uma última leitura, sem polling. Detalhe de fatura escuta `card_invoices` no hook, não depende da tela específica.
- AppState informa foco ao TanStack e a transição nativa background/inactive → active força releitura de consultas ativas habilitadas, mesmo dentro dos 30 segundos de staleTime. Eventos active iniciais/duplicados não iniciam releitura. A recuperação substitui requisição anterior à suspensão; troca de rota continua relendo apenas consultas ativas stale. Sem intervalo novo de polling. Observação: consulta ativa significa que tem observador montado, inclusive abas que o navegador mantém montadas.
- Gesto adicionado a Hoje, Notas, detalhe de fatura/lançamento, Pastas, Lixeira, Alertas e Busca. Refresh existente composto aguarda todas as consultas da página; inclui derivados antes esquecidos e não força consulta opcional sem ID. Screen mantém indicador enquanto a promise do gesto está pendente, habilita bounce vertical e desloca indicador abaixo do header sobreposto.
- Metas resolve o item selecionado contra dados atuais, evitando objeto velho no extrato/aporte. Vínculo de telefone reseta consultas após aceitar convites (telefone/workspace podem mudar). Troca de identidade limpa o cache global.

### Evidência automatizada

`node --test src/lib/refresh-consistency.test.ts`: **11/11 passaram**. Usa QueryClient e QueryObserver reais com transporte financeiro falso. Vermelho observado antes da correção central: histórico permaneceu `open`, callback retornou `undefined`; conclusão de IA deixou domínios válidos erroneamente. Realtime também foi confirmado vermelho contra `use-items.ts` da base (`account-balances` não invalidado), depois verde com correção recolocada. Cobertura de callbacks de 22 mutations financeiras, quatro mutations de importação, estado processing de IA e compartilhamento de assinatura.

`npx tsc --noEmit`: passou após integração do tipo da nova RPC pela tarefa principal.
`npx expo lint`: passou durante esta implementação.

### Limites e roteiro nativo pendente

Não foi executada uma baixa real nem uma escrita de teste no Supabase. Android/iOS ainda precisam provar: gesto em página vazia/curta e longa; indicador visível abaixo do header; histórico de fatura imediatamente pago após baixa sem caixa; detalhe/parcelas/relatórios coerentes ao voltar; mudança por IA/WhatsApp com e sem evento Realtime; retorno de background após dados mudarem; modo offline exibindo falha de leitura sem afirmar atualização concluída. Testes Node demonstram invalidação de cache, não o gesto nativo nem a entrega de eventos do servidor.


### Refinamentos após revisão

Regressões adicionais provaram: retorno nativo atualiza cache ainda fresco e respeita consultas disabled; evento active inicial/duplicado não duplica requisição; requisição anterior é abortada e seu retorno tardio não sobrescreve dado atual; desmontagem/remontagem com unsubscribe pendente recebe nome de canal novo; 48 eventos Realtime agrupados produzem uma leitura, e evento durante a leitura produz exatamente uma segunda leitura com o valor final. Os quatro cenários novos foram observados em vermelho e verde. `npx tsc --noEmit` passou novamente. A janela de 50 ms é acionada por evento, termina ao consumir os eventos e não é polling periódico.
