# Próximo passo — o que ficou faltando

Duas frentes independentes. Nenhuma foi feita; as duas estão prontas para começar.

---

## A. Migrations: reconciliar o histórico e aplicar `0038` + `0039`

`npx supabase migration list` (rodado em 28/08) mostra **zero sobreposição**:

- Local `0001`–`0039` → coluna Remote **vazia** em todas.
- Remote → **39 versões em timestamp**, coluna Local **vazia** em todas.

Das 39 remotas, 37 correspondem às `0001`–`0037` aplicadas pelo dashboard. **Sobram 2 sem arquivo
no repo** — mudanças feitas direto no banco que nunca voltaram para cá. Descobrir o que são é o
passo que não pode ser pulado: se houver schema no remoto que o repo não descreve, qualquer
`db push` futuro conflita.

### Ordem

```bash
# 0. rede de segurança (o repair mexe em bookkeeping, mas o push mexe em schema)
npx supabase db dump --linked -f /tmp/backup-pre-0038.sql

# 1. o remoto tem algo que o repo não tem?
npx supabase db diff --linked --schema public > /tmp/drift.sql
#    → vazio: siga. não vazio: LEIA antes de continuar; provavelmente vira uma migration nova
#      descrevendo o que já existe lá.

# 2. dizer ao CLI que 0001–0037 já estão no banco (NÃO roda SQL, só marca)
npx supabase migration repair --status applied 0001 0002 ... 0037

# 3. tirar as entradas em timestamp do histórico (também NÃO desfaz schema)
npx supabase migration repair --status reverted 20260713213342 ... 20260827170352

# 4. agora sim, só 0038 e 0039 são novas
npx supabase migration list        # confere o pareamento antes
npx supabase db push

# 5. regenerar os tipos — hoje as colunas novas estão escritas À MÃO
npx supabase gen types typescript --project-id kwriuifcwyvdrxtspjiz > src/lib/database.types.ts
```

**O que cada migration faz no remoto:**
- `0038` — muda schema de verdade: `note_folders`, `folder_id`/`pinned`/`deleted_at`/`tags`/
  `search_tsv` em `notes`, config `pt_unaccent`, backfill de `category` → pasta, cron de purga.
  Puramente aditiva; `notes.category` continua existindo de propósito.
- `0039` — provavelmente **no-op** no remoto (os GRANTs já existem lá, herdados do dashboard).
  Ela existe para que um ambiente novo funcione, que foi como o problema apareceu.

⚠️ O backfill da `0038` desliga o trigger `set_updated_at` em volta do `update`. Isso é
proposital: sem desligar, toda nota categorizada teria o `updated_at` colapsado para o timestamp
da migration, e a ordenação da lista de notas (que é por `updated_at`) viraria lixo, sem volta.

---

## B. Acabamento visual — o que eu entreguei pela metade

### O diagnóstico honesto

Os 35 documentos são **fortes em anatomia** (o que aparece, em que ordem, por quê; estados;
navegação; movimento) e **fracos em especificação visual**. Eles dizem "card de destaque em glass"
e "`Row` com trailing" — isso é estrutura, não aparência. Nenhum documento diz peso tipográfico
por bloco, densidade, contraste, tratamento de superfície ou hierarquia de cor.

Consequência: as telas saíram **corretas e sem graça**. Estrutura certa, aparência default.

**A causa raiz foi minha:** o MCP do Appllama (que puxa telas reais de apps rankeados) não estava
conectado, as buscas na web voltaram artigo genérico, e eu segui em frente com princípios + meu
próprio repertório. A regra da skill de design é literal: *"nunca desenhe uma tela da imaginação
quando você pode estudar como os melhores apps resolveram a mesma tela"*. Eu pulei esse passo e
tratei como se tivesse feito.

### Defeitos concretos vistos rodando (28/08)

**Hoje**
- O card de destaque é um retângulo cinza com um número. O `Sparkline` desenha, mas tão achatado
  que lê como divisor — falta escala mínima e área preenchida.
- O glass some contra fundo claro: `GlassCard` sobre `groupedBackground` vira cinza chapado.
- "Paguei" é uma pílula cinza apagada — a ação mais importante da tela não parece ação.
- Conteúdo passa por baixo da tab bar (`PASSANDO DO ORÇAMENTO` cortado).

**Notas**
- **Quatro controles empilhados** antes de qualquer conteúdo: busca, quick-add, chips de pasta,
  chips de tag. É o maior problema da tela.
- As linhas de nota **não têm agrupamento nenhum** — texto solto na margem, inconsistente com a
  Hoje, que usa `Section`/`Card`. As duas telas parecem de apps diferentes.
- **Bug:** `notePreview` (`src/lib/search.ts:32`) junta as linhas com espaço, então o checklist
  vaza cru na prévia: `- [x] leite - [ ] pão - [ ] café`. Precisa remover a marcação e mostrar só
  o texto.
- Metadados repetem: `mercado · #mercado` (pasta e tag com o mesmo nome).

### O caminho, e por que é barato

**Tudo passa pelos primitivos.** Mudar aparência é mexer em ~8 arquivos, não em 36 telas:

```
src/design/tokens.ts          escala tipográfica, densidade, elevação, raio
src/constants/theme.ts        paleta
src/components/ui/card.tsx    superfície de conteúdo
src/components/ui/row.tsx     a linha — é ela que define a "cara" de 80% do app
src/components/ui/button.tsx  peso e presença da ação
src/components/ui/money.tsx   o número, que é o herói deste produto
src/components/ui/sparkline.tsx
src/components/glass/glass-card.tsx
```

### Ordem sugerida

1. **Referência primeiro** — conectar o MCP do Appllama, **ou** você me passar 5–10 prints de apps
   que considera bonitos (Copilot Money, Monarch, Things, Apple Wallet…). Sem isso o passo 2 vira
   chute de novo.
2. **Extrair o padrão, não os pixels**: escala tipográfica real, densidade (altura de linha,
   respiro entre seções), peso de cor, tratamento de card, onde mora o contraste.
3. **Reescrever a camada visual dos 8 arquivos** e ver no catálogo (`/catalog`) nos dois temas.
4. **Acrescentar a seção "Visual" aos documentos de tela** — hierarquia por bloco, o que é
   protagonista, o que é secundário. É o campo que faltou.
5. Só então varrer as telas.

---

## C. Telas documentadas que não foram implementadas

- `conta-detalhe` — extrato de uma conta. **Não existe.**
- `conta-a-pagar` — virou modo do formulário de transação, não tela própria (decisão aceitável,
  mas o documento diz outra coisa).
- `lembrete-recorrencia` — virou seção inline no form, não `formSheet`.

Fora isso, 36 telas existem.
