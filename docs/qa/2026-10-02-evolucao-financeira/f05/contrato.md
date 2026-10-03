# F05 — Filtrar por forma de pagamento

Status: aceite técnico no staging em 03/10/2026; matriz funcional nativa e revisão visual concluídas.

## Fluxo no ProOps

Em Lançamentos → Filtros, escolher uma ou várias formas de pagamento. A seleção é um rascunho até Aplicar; fechar, arrastar ou voltar cancela. Todos remove somente esse grupo. Não informado seleciona metadata histórica nula, sem deduzir a forma pela conta. Limpar filtros remove todos os critérios, preservando a navegação pelo mês/série.

A seleção combina com situação, tipo, conta ou cartão, categoria, origem, busca, datas e valores. Uma seleção de três formas é um critério, com todos os nomes no resumo acessível. O resumo financeiro global continua oculto quando há qualquer recorte: não se publica soma parcial de páginas.

## Arquitetura e invariantes

- `payment-method-filters.ts` centraliza opções, normalização canônica, interpretação de links e expressão fechada de PostgREST. Duplicatas e ordem de toque não fragmentam o cache. Valor desconhecido é rejeitado antes da consulta; não vira Não informado.
- `useTransactions` aplica a condição no servidor antes do intervalo de 50 registros. Grupos OR de método, conta, situação e busca se combinam por AND, mantendo a ordenação e os filtros em todas as páginas.
- `filterExpectedLines` aplica a mesma seleção sobre o método temporal retornado pelo motor. A leitura de previsões percorre todas as páginas antes do filtro; nenhuma ocorrência é materializada por abrir filtros. Em trânsito também recebe o critério.
- `ListFiltersValue.multiSelections` e `ListFilters.multiSelects` acrescentam seleção múltipla genérica ao componente compartilhado. A contagem trata cada grupo como um critério e o resumo usa opções, sem exibir identificadores internos.
- A folha reutiliza `Field`, `Chip`, `SheetScroll`, `TaskHeader` e os tokens existentes. `Chip` mantém seleção acessível, feedback tátil, molas e movimento reduzido do projeto. Não há nova tela, paleta, biblioteca ou animação paralela.
- O link `paymentMethods=pix,boleto,not_informed` aceita lista e parâmetros repetidos, valida o conjunto inteiro e atualiza uma tela já montada. Parâmetro ausente conserva a escolha; vazio remove esse grupo. Link inválido apresenta recuperação explícita, sem consultar uma lista ampliada silenciosamente.
- Estado e filtro são locais à tela. Não há preferência persistida, escrita financeira, migração ou alteração de RPC.

## Correções demonstradas durante o QA

O `Row` compartilhado voltou a preservar o tamanho tipográfico do dinheiro quando há
espaço para título e valor. Se a largura medida e a escala da fonte não acomodarem duas
colunas legíveis, ele reserva uma linha inteira ao valor e permite ajuste nessa linha.
Não usa tamanho de fonte fixo, remount ou API privada. O catálogo de desenvolvimento
inclui valores sintéticos para repetir o caso sem criar lançamentos.

O modo de ocultação também passa a governar os rótulos acessíveis financeiros. Lista,
detalhe, previsões e superfícies financeiras que já montavam rótulos monetários usam
`useBRL`, assim como o texto visível. Os testes executam o formatter real nos widgets;
as hierarquias nativas de lista, detalhe, previsões e início financeiro confirmam que
ocultar não conserva o número no nome acessível. Isso não certifica fala de VoiceOver
ou TalkBack nem cada tela adicional em dispositivo.

## Semânticas preservadas

Situação continua na régua já existente: uma compra gravada com fatura e data passada pode aparecer como Concluído ainda que o dinheiro esteja pending; uma ocorrência virtual usa o estado calculado pelo motor. O método não define tipo de conta nem altera essa regra. Transferência recebida continua entrando no extrato da conta de destino. Período com uma borda continua incluindo somente registros gravados, com essa limitação indicada na interface.

Não há exportação da lista de Lançamentos no fluxo atual. Os relatórios independentes não recebem um filtro implícito. Detalhe e edição mantêm o registro escolhido e sua forma de pagamento.

## Validação executada

1. Contrato puro: null explícito, múltiplos, duplicação/ordem, parâmetros repetidos/vazios/inválidos e arrays inválidos.
2. Transporte real do cliente PostgREST com fetch controlado: método AND outros grupos OR, página seguinte, resultado além dos 50 primeiros globais, zero registros, erro/retry e separação de cache.
3. Componentes reais em harness: draft, cancelar/reabrir, alternar opções, Todos, Limpar, contagem/resumo e ausência de regressão nos seletores simples.
4. Banco de staging `utkqoiigimqzeenxkxdl`, conta TEST: comparar consultas compostas com leitura independente e confirmar que navegar/filtrar não escreve.
5. iOS e Android: selecionar várias formas/Não informado, aplicar/cancelar/limpar, combinar busca/conta/status/período, resultado vazio e recuperação, detalhe e retorno, privacidade, fonte grande e tema escuro. Validar tablet conforme composição já existente.
6. TypeScript e lint com exit 0; suíte Node completa com **1.590 passed**, zero falhas,
   skips ou cancelamentos. Contrato, HTTP real, matriz e limites estão no
   [registro nativo](registro-nativo.md). As [23 capturas](captures.json) têm origem,
   dimensões e SHA-256; o [pacote visual](revisao-visual.md) delimita a revisão independente.
