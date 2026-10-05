# F22 — duplicar e favoritos de lançamento

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes.

## Parte A — Duplicar abre o formulário

Hoje `[txId].tsx` (`duplicate`) grava direto uma cópia para hoje. Passa a abrir
`/finance/lancar` PRÉ-PREENCHIDO (uma porta só, `hrefDoLancar('uma', params)`), com a data de
HOJE explícita e editável; a pessoa revisa e salva (chave de requisição nova, porque é uma
intenção nova; duplo toque no Salvar continua um lançamento só). "Duplicar" passa a existir
também no menu de item das listas de lançamentos (`ItemLink` actions), pelo mesmo helper.

**Copia** (dados da pessoa): tipo, título, estabelecimento, valor, categoria, subcategoria,
conta, contraparte (transferência), forma de pagamento, classificação do gasto.
**Nunca copia** (vínculos e estado): `id`, `invoice_id`, `installment_plan_id`/`installment_no`,
`recurring_id`, `debt_id` e colunas `debt_*`, `pays_invoice_id`, `rollover_of_invoice_id`,
`pix_fee_for_transaction_id`, `down_payment_*`, `status`/`paid_at`/`auto_confirm`, `due_at`,
`attachment_path`, `source`, chaves de requisição, `edit_revision`.

- Parcela: duplica como lançamento **à vista no valor da parcela**, e o topo diz "Cópia da
  parcela 3/10 — vira um lançamento à vista" (copiar a compra inteira não é oferecido).
- Pagamento de fatura, de dívida e juros do Pix: sem "Duplicar" (como hoje).
- Conta de origem arquivada ou apagada: campo de conta vazio + "A conta original não está mais
  ativa: escolha outra". Forma de pagamento incompatível com a conta escolhida: o formulário já
  limpa (regra do F01).

`lancar.tsx` passa a aceitar `merchant` e os campos que faltam nos params (o helper
`paramsDaCopia`, `src/lib/duplicar.ts`, + teste da lista de colunas copiadas/ignoradas).

## Parte B — Favoritos (modelos)

- **No formulário de lançamento** (Uma vez): ação **Salvar como favorito** (pede um nome, padrão
  = título) grava o modelo com os campos de `Comum` + forma de pagamento + tipo — sem data, sem
  vínculo. Disponível também no menu do detalhe de um lançamento ("Virar favorito").
- **Usar**: no topo do formulário de criação, uma fileira compacta **Favoritos** (até 6, os mais
  usados) + "Todos" abre a lista. Tocar preenche os campos (a data fica a de hoje); a pessoa
  revisa e salva. Nunca grava sozinho.
- **Gerenciar** (lista "Favoritos", entrada em Gerenciar): renomear, editar (os MESMOS campos do
  formulário), arquivar/desarquivar (`SecaoDeArquivados`), apagar. Apagar favorito não toca
  nenhum lançamento.
- Conta/categoria do favorito que deixou de existir ou foi arquivada: ao usar, o campo vem vazio
  com o aviso (mesma regra do duplicar); ao editar, o favorito pede revisão.

**Persistência** (por workspace, sincroniza entre aparelhos):

```sql
create table public.transaction_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  fields jsonb not null,           -- Comum + paymentMethod + kind; validado pelo decoder do app
  use_count int not null default 0,
  last_used_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

RLS por workspace (padrão das tabelas do app; leitura/escrita para membros), índice
`(workspace_id, archived, use_count desc)`, `unique (workspace_id, lower(name))` só entre não
arquivados. Escrita direta via supabase-js. `fields` só é aceito pelo decoder `decodeModelo`
(`src/lib/favoritos.ts`, + teste) — chave desconhecida é ignorada, valor inválido zera o campo.
Linha nova em `AGENTE-PARIDADE-COM-O-APP.md` (o agente não usa favoritos).

## Aceite (matriz)

Duplicar avulso, parcela, ocorrência de recorrente, transferência, pending e cleared (cópia
sempre nova e sem vínculo, conferido no banco); data antiga → hoje; conta arquivada; forma
incompatível; duas duplicações intencionais iguais = dois lançamentos; duplo toque = um. Favorito:
criar, usar, renomear, nome repetido recusado, arquivar/desarquivar, apagar (lançamentos
intactos), conta apagada, outro workspace não vê. Teste SQL de RLS/unique; nativo nos dois
sistemas, claro/escuro, fonte grande, ocultar valores, Reduzir movimento.
