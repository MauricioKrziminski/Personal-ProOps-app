# Importações — `src/app/(tabs)/profile/imports.tsx` *(tela nova)*

`import_batches` existe desde a `0017` — arquivo, origem, conta, data, `status`
(`parsing|review|done|failed`) e `error` — com índice feito sob medida para esta tela
(`import_batches_ws_idx (workspace_id, created_at desc)`). **Nada lê essa tabela.** A única
referência no repositório inteiro é o `insert` da Edge Function (`import-statement/index.ts:66`).

O efeito prático: o `batch_id` vive num `useState` da tela de importação (`import.tsx:43`). Fechou
o app no meio da revisão de 80 linhas, **perdeu o lote de vista** — ele continua no banco, com os
itens pendentes intactos, e não existe caminho nenhum de volta até eles.

Duas consequências do estado atual que esta tela precisa contornar:

- **`status` é decorativo.** É gravado como `'review'` na criação e **nunca atualizado**:
  `parsing`, `done` e `failed` são estados mortos e `error` é sempre `null`. Então o rótulo da
  linha sai da **contagem dos itens**, não da coluna.
- **Lote fantasma é possível.** O batch é inserido (`:66`) antes dos itens (`:79`); se o insert dos
  itens ou o `_prepare_import_batch` estourar, sobra um lote com zero item e status `'review'`.
  A tela mostra isso como **"Falhou"**, e o `catch` da function (`:139`) passa a gravar
  `status='failed'` + `error` antes de devolver 500.

## Pergunta que responde

> "Cadê aquele extrato que eu comecei a importar?"

E a variação que aparece uma semana depois: *"esses 40 lançamentos de julho vieram de onde?"*

## Persona

- **Primária: Rafa, 29** — importa todo mês, às vezes dois arquivos, e é quem mais fecha o app no
  meio (revisão de extrato de PJ é longa).
- **Secundária: o casal** — um importa, o outro vê aparecer 60 lançamentos no financeiro
  compartilhado e quer saber **quem trouxe e de onde**.
- Tela de baixa frequência, alta importância: ninguém abre por prazer, abre porque perdeu algo.

## Entrada e saída

- **Entrada:** Perfil › Dados › Importações. Também é o destino do link "ver importações
  anteriores" da etapa 1 da tela de importação.
- **Saída:**
  - lote com item pendente → `push /import?batch=<id>` (retoma a revisão exatamente onde parou)
  - lote concluído → mesma rota, em **modo leitura**: a tela de importação já renderiza todos os
    itens, inclusive aprovados e descartados (`import.tsx:182` mapeia `items`, não `pendentes`)
  - "Importar agora" → `/import`
- **Back:** `pop` para o Perfil. Nada aqui é porta de mão única.

## Anatomia

1. **Header nativo** — large title "Importações". `headerRight`: `plus` → nova importação.
2. **Faixa de aviso**, só quando existe lote com item pendente: uma linha de texto em `warning`,
   *"1 importação esperando revisão"*, tocável, levando direto ao lote. *É a razão nº1 de alguém
   abrir esta tela; não pode estar no meio de uma lista cronológica.*
3. **Lista, agrupada por mês** — `Section` por mês, `Row` por lote:
   - **título** = `filename` (ou "Extrato" quando null);
   - **subtítulo** = o que aconteceu, em números: *"32 lançados · 2 descartados"* /
     *"18 esperando revisão"* / *"Falhou"*;
   - **trailing** = data (`created_at`, `formatDateBR`) e um selo curto de origem (`OFX` / `CSV`);
   - a conta escolhida no import (`account_id`), quando existe, em segunda linha.
4. **Sem card de destaque.** Esta tela não tem uma pergunta com resposta em número grande — tem
   uma lista. O único glass da tela é a chrome. *Inventar um "total importado no ano" aqui seria
   card por simetria, não por uso.*
5. **Rodapé de retenção**, uma linha: *"Os arquivos não ficam guardados — só os lançamentos que
   você confirmou."* O conteúdo do extrato fica em `import_items.raw` (jsonb) e é a informação
   mais sensível que o app guarda; dizer o que acontece com ela é higiene, não enfeite.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lista | `useImportBatches()` **(novo)** | `['import-batches']` | RPC `import_batches_list()` **(nova)** | `import_batches` **(a incluir na publicação)** |
| Apagar lote | `useDeleteImportBatch()` **(novo)** | — | delete em `import_batches` | invalida `['import-batches']` |
| Itens do lote | `useImportItems(batchId)` | `['import-items', id]` | `import_items` | `import_items` (já existe) |

**Por que uma RPC e não um `select`:** o rótulo da linha é uma agregação (quantos itens por
status). Somar isso no cliente exigiria baixar todos os `import_items` de todos os lotes — e a
regra do projeto é que leitura agregada é RPC. Como só o app lê, é **wrapper único**
`security invoker` com a query inline filtrando `workspace_id in (select
private.my_workspace_ids())`; não precisa do par interna/wrapper (nenhuma Edge Function chama).

Retorno: `id, filename, source, account_id, status, error, created_at, total, pendentes,
aprovados, descartados, duplicados`.

**Realtime:** a `0017` adicionou `import_items` e `categorization_rules` à publicação, mas não
`import_batches`. Entra na mesma migration — uma linha — porque o workspace é compartilhado e a
importação do parceiro precisa aparecer sem refresh.

## Ação primária

**Retomar a revisão pendente.** Um toque na linha, e a tela de importação abre no lote — o item
que faltava conferir ainda está lá.

## Ações secundárias

- Nova importação (`headerRight`).
- Context menu do lote: **Ver lançamentos** · **Apagar registro da importação** (destrutivo).
- Action sheet do apagar diz exatamente o que sobra, porque é a dúvida óbvia:
  *"Apagar o registro desta importação? Os 32 lançamentos que você confirmou continuam no
  financeiro."* — o `on delete cascade` derruba os `import_items`; `transactions` tem
  `on delete set null` do lado do item e **não** é afetada (`0017`).

## Estados

- **Loading** — `Skeleton` de 4 linhas com a forma "nome do arquivo + contagem".
- **Empty** — `EmptyState` ícone `tray`, título "Nenhuma importação ainda", dica acionável:
  *"Exporte o extrato do banco em OFX ou CSV e traga aqui — ou manda foto do cupom no WhatsApp, que
  também vira lançamento."*
- **Empty por plano** — no Free (`can_import = false`, `private.plan_limits`, `0029`) a tela ainda
  abre e explica em vez de esconder: título "Importação é do Pro", dica com o que o Free faz bem
  (*"No Free dá para registrar pelo WhatsApp à vontade"*) e um caminho para `/paywall`.
  **Esconder a funcionalidade não vende plano; explicar vende.**
- **Error** — inline com "Tentar de novo".
- **Lote com falha** — a linha mostra "Falhou" em `danger` com o `error` do banco resumido, e o
  context menu oferece **Tentar de novo** (leva para `/import`, arquivo novo — não guardamos o
  original) e **Apagar registro**.
- **Conteúdo longo** — nome de arquivo de banco é comprido e feio: trunca no meio
  (`extrato_conta_corrente…_2026.ofx`), a contagem nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Faixa de pendente aparecendo/sumindo | continuidade | `LinearTransition` em `Motion.base` |
| Entrada das linhas | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms |
| Apagar lote | mudança de estado | linha sai com `LinearTransition` em `Motion.fast`; haptic `notificationAsync(Warning)` |
| Lote novo chegando por realtime | explicação | entra em `Motion.base` com highlight de 600 ms |
| Press na `Row` | feedback | highlight de fundo, 120 ms — não scale |

## Acessibilidade

- A `Row` é lida como frase: *"Extrato de julho, CSV, 12 de agosto, 32 lançados, 2 descartados"*.
- "Falhou" e "esperando revisão" são **texto**, nunca só cor.
- Alvos ≥ 44pt.
- Dynamic Type XL: data desce para a segunda linha em vez de truncar o nome do arquivo.
- Botão de nova importação (só ícone) com `accessibilityLabel`.

## Fora de escopo

- **Guardar o arquivo original.** Nem o OFX nem o CSV são persistidos, e não vamos passar a
  persistir: o valor está no lançamento revisado, e o extrato bruto é o dado mais sensível do
  produto. "Tentar de novo" pede o arquivo outra vez, e está certo.
- Desfazer uma importação inteira (apagar as 32 transações que ela criou). É destrutivo demais
  para uma tela de histórico e o caminho existe: apagar lançamento a lançamento no extrato.
- Filtro e busca no histórico. Quem importa uma vez por mês tem doze linhas por ano.
- Purga automática de `import_items` antigos: é uma decisão de retenção (com cron, como a lixeira
  de notas), não de tela.
- Estatística de acerto da IA por lote ("categorizou 80% certo"). Precisa comparar sugestão com o
  que o usuário corrigiu — mede a IA, não ajuda o usuário a achar o extrato dele.
