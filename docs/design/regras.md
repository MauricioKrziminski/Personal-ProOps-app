# Regras de categoria — `src/app/(tabs)/finance/rules.tsx`

Esta é a resposta do produto à queixa nº1 contra os concorrentes: *"categorizou errado e não dá
para consertar"*. A regra do usuário **ganha da IA** — `_match_rule` (`0017`) roda **depois** do
parse no WhatsApp (`process-jobs/index.ts:151`) e **antes** do Gemini na importação
(`_prepare_import_batch`, `0019`), economizando a chamada. Cada acerto incrementa `hits`
(`_bump_rule_hits`, `0018`, chamado em `process-jobs/index.ts:160`).

Hoje são 275 linhas com três problemas concretos:

- **O banco tem mais do que a tela.** `categorization_rules` (`0017`) tem `match_type`
  (`contains|merchant|regex`), `account_id` e `priority` (menor roda primeiro). `useRules`
  (`use-finance.ts:600`) **lê** os sete campos e ordena por `priority`, mas `useSaveRule`
  (`use-finance.ts:616`) só manda `pattern` + `category` e **fixa** `match_type: 'contains'`
  (`:626-635`). Regex, prioridade e regra por conta não têm UI nenhuma.
- **Interação proibida.** Remover é `onLongPress` → `Alert.alert` (`rules.tsx:96` e `:52-64`), e a
  tela precisa de uma legenda no rodapé explicando isso (`:199`, *"Toque para editar. Segure para
  remover."*). Legenda de affordance é o sintoma: se precisa explicar, não está visível.
- **Erro adivinhado.** `save.isError` vira *"Não deu para salvar (regra repetida?)"* (`:178`) — o
  ponto de interrogação é o app chutando. O motivo real é o `unique (workspace_id, match_type,
  pattern)` do `0017`, e dá para dizer qual regra já existe. `useDeleteRule`
  (`use-finance.ts:641`) não trata erro nenhum: apagar falha em silêncio.

## Pergunta que responde

> "A IA errou a categoria de novo — como eu ensino de vez?"

## Persona

- **Primária: Camila, 34** — quer regra e relatório. Ela **quer** configurar; é a única persona
  que abre esta tela de propósito.
- **Secundária: Rafa, 29** — chega aqui pela importação, quando 40 linhas caem em "outros".
- **Terciária: qualquer um** — chega pelo WhatsApp: a resposta do `set_rule`
  (`process-jobs/index.ts:615`) termina em *"você pode ver e apagar suas regras no app"*. Quem
  vem por esse caminho precisa **achar a regra recém-criada no topo**, não caçar numa lista.

## Entrada e saída

- **Entrada:** menu do header do Financeiro · Perfil › Preferências › Regras de categoria · link
  da tela de importação · a frase de fim da resposta do WhatsApp.
- **Saída:** back = `pop`. Toque numa regra abre a edição.
- **Back:** normal. Sair no meio de um formulário aberto pede confirmação (é `modal`).

## Anatomia

1. **Header nativo** — large title "Regras". `headerRight`: `plus` (nova regra). *Hoje o botão de
   criar é um retângulo azul no fim do scroll com um glifo `＋` de texto (`rules.tsx:193`) — glifo
   não é ícone.*
2. **Faixa explicativa**, duas linhas de texto secundário (não um card): *"Sua regra ganha da IA.
   Vale no WhatsApp e na importação de extrato."* + *"Dá para criar por mensagem: 'sempre que eu
   falar ifood, põe em restaurante'."* Hoje isso é um `GlassCard` (`rules.tsx:72`) do tamanho de
   um card de dado, competindo com o conteúdo.
3. **Lista de regras** — `Section` de `Row`s opacas, na ordem que o banco resolve
   (`priority`, depois `hits desc`, `use-finance.ts:611-612`). Cada linha:
   - **gatilho → categoria**, o gatilho em destaque;
   - subtítulo com o que a regra fez: *"aplicada 12x"* ou *"ainda não pegou nada"*, e `· aprendida`
     quando `source='learned'`.
   - **`hits` é a única métrica de valor da tela**: regra com 0 acerto é lixo e o usuário precisa
     ver isso para limpar.
4. **Card de destaque (o único `GlassCard`) — "O que suas regras já pouparam"**: soma de `hits` e
   quantas categorizações não precisaram de IA. É o número que transforma uma tela de configuração
   em algo que se olha com gosto — e é derivável do que já vem em `useRules`, sem RPC nova.
   *Fica no topo só quando existe pelo menos uma regra com `hits > 0`.*
5. **Formulário** — sai de dentro do scroll e vira `formSheet` com detents (`rules.tsx:124-181`
   hoje empurra a lista para baixo quando abre). Campos:
   - "Quando o lançamento contiver" → texto;
   - "Categorizar como" → chips de `SUGGESTED_CATEGORIES` (`src/lib/categories.ts`);
   - **"Só nesta conta"** (opcional) → `account_id`, hoje existe no banco e não na tela;
   - Salvar / Cancelar no header do sheet, não como botões no corpo.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lista | `useRules()` | `['rules']` | `categorization_rules` | `categorization_rules` (`0017`) |
| Salvar | `useSaveRule()` | — | insert/update direto | invalida `['rules']` |
| Apagar | `useDeleteRule()` | — | delete direto | invalida `['rules']` |

`useSaveRule` precisa passar a aceitar `account_id` **(novo campo no input, não hook novo)**.
`match_type` e `priority` continuam fora da UI — ver *Fora de escopo*.

Realtime importa aqui de verdade: a regra criada por mensagem no WhatsApp aparece na tela **sem
refresh**, e essa é a demonstração mais barata de que o app e o WhatsApp são a mesma coisa.

## Ação primária

**Criar a regra que conserta o erro que acabou de acontecer.**

O caminho mais curto para isso não começa nesta tela: começa no lançamento errado. Por isso o
context menu de qualquer transação e de qualquer item de importação ganha **"Sempre categorizar
assim"**, que abre este `formSheet` com gatilho e categoria já preenchidos. Esta tela é a lista de
manutenção; a criação nasce onde o erro apareceu.

## Ações secundárias

- Context menu na regra: **Editar** · **Apagar** (destrutivo, com action sheet nativo:
  *"Parar de categorizar 'ifood' automaticamente?"*).
- Nova regra pelo `headerRight`.
- Toque na linha → editar (mantém o comportamento atual, que é bom).

`onLongPress` + `Alert` sai (`rules.tsx:96`). Context menu nativo mostra as opções sem legenda no
rodapé — e a legenda `:199` some junto.

## Estados

- **Loading** — `Skeleton` de 4 linhas com a forma "gatilho → categoria".
- **Empty** — `EmptyState` ícone `text.badge.checkmark`, título "Nenhuma regra ainda", dica
  acionável: *"Crie uma para o que a IA sempre erra — 'posto' vira transporte. Ou manda no
  WhatsApp: 'sempre que eu falar ifood, põe em restaurante'."*
- **Error (lista)** — inline com "Tentar de novo".
- **Error (salvar)** — específico, não adivinhado: gatilho repetido diz **qual** regra já existe e
  oferece **"Editar a regra existente"**. Qualquer outro erro: "Não deu para salvar. Tenta de
  novo." com o toast padrão.
- **Error (apagar)** — hoje é silencioso: a linha some da UI e volta na próxima query. Precisa de
  rollback visível + toast.
- **Conteúdo longo** — gatilho longo trunca em uma linha; a categoria nunca trunca (é a metade que
  responde "o que essa regra faz?").

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Regra criada pelo WhatsApp chegando | explicação | entra com `LinearTransition` em `Motion.base` e um highlight de 600 ms — o usuário precisa ver que a mensagem virou regra |
| Apagar | mudança de estado | linha sai com `LinearTransition` em `Motion.fast`; haptic `notificationAsync(Warning)` |
| Salvar | feedback | sheet fecha na mola `Motion.spring.sheet`; haptic `notificationAsync(Success)` (`rules.tsx:45`, manter) |
| Chip de categoria | feedback | `selectionAsync` + fundo em 120 ms, sem scale |
| Entrada das linhas | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms (`rules.tsx:87`, manter) |
| Contador de `hits` | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` |

## Acessibilidade

- A `Row` anuncia a regra como frase: *"Quando contiver ifood, categorizar como restaurante,
  aplicada 12 vezes"* — a seta `→` não é lida.
- Botão de nova regra (só ícone) com `accessibilityLabel="Nova regra"`.
- Alvos ≥ 44pt inclusive nas linhas mais curtas.
- Dynamic Type XL: `gatilho → categoria` empilha em duas linhas em vez de truncar as duas metades.
- Estado "aprendida" é texto, nunca só um selo colorido.

## Fora de escopo

- **`match_type: 'regex'` na UI.** O banco suporta (`0017`) e a tela não vai expor: regex mal
  escrita cria categorização errada silenciosa em massa, que é exatamente a dor que esta tela
  existe para curar. Fica para quem precisar de verdade pedir.
- **`priority` editável** (arrastar para reordenar). Hoje todas nascem com 100 e o desempate é a
  regra mais específica (`order by r.priority, length(r.pattern) desc`, `0017`) — que é o que o
  usuário espera sem saber explicar. Só entra quando alguém reclamar de duas regras brigando.
- **`match_type: 'merchant'`**: `merchant` só é preenchido de forma confiável na importação; expor
  antes disso seria vender um filtro que quase nunca casa.
- Testar a regra contra o histórico ("isso pegaria 34 lançamentos passados") e recategorizar em
  lote — feature boa, tela outra.
- Criar regra de conta/valor ("todo Pix acima de 1.000 é aluguel"): o schema não tem, e inventar
  coluna por causa de tela é como o produto incha.
