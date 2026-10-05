# F12 — aporte e resgate com origem e destino

Estado: contrato do incremento, antes do código. Depende do F11 (modelo de vínculo com
transferência). Staging `utkqoiigimqzeenxkxdl`. Não declara implementação nem testes.

## Custódia: a conta de investimento é a posição

Uma **posição** é uma conta `type='investment'` (corretora, CDB, caixinha que rende). Ela já
existe, tem saldo derivado e já é tratada à parte em Contas. **Não** se cria um ativo ligado à
conta: os bens de `assets` (classe investimento/cripto/ações) continuam sendo posições manuais,
separadas, e nunca representam o mesmo dinheiro de uma conta de investimento. A folha de bem
passa a dizer isso numa linha quando a pessoa cria um bem da classe investimento e já tem conta
de investimento ("Se este dinheiro está numa conta de investimento, registre aportes nela").

## Comportamento

Em Patrimônio (e no detalhe da conta de investimento), **Aplicar** e **Resgatar**:

- Aplicar: origem (conta que não é cartão nem investimento) → posição (conta de investimento) →
  valor → data → revisar. Nasce UMA transferência real origem → posição.
- Resgatar: posição → destino (conta que não é cartão) → valor → data → revisar. Nasce UMA
  transferência posição → destino.
- **Vincular** uma transferência já lançada/importada entre uma conta comum e uma conta de
  investimento, em vez de criar outra.
- Histórico da posição (do mais recente ao mais antigo, `VerMais`) abre o detalhe; editar valor
  e data; desfazer (apaga a transferência que o movimento criou, ou só solta a vinculada).

Aporte e resgate não são consumo nem renda (são transferências). O total do patrimônio não muda
num aporte ou resgate sem rendimento: só a distribuição entre caixa e investimentos.

## Regras

- Centavos 1..9007199254740991; data civil explícita; futura permitida (transferência
  `pending`, pela regra atual de transferência).
- Origem ≠ destino; contas do workspace, não arquivadas; nenhuma ponta é cartão; a posição é
  `investment` e a outra ponta não é `investment`.
- **Resgate não passa do disponível da posição**: saldo realizado da conta de investimento na data
  do resgate e em toda data posterior (incluindo resgates futuros já lançados) ≥ 0 depois da
  operação. Conferido sob trava da posição. Mesma regra ao **editar** um aporte para baixo ou
  **desfazer** um aporte que um resgate posterior consumiu: recusa com a frase e o caminho
  ("desfaça o resgate de DD/MM antes").
- Uma transferência é vinculada a no máximo UM movimento — de investimento OU de meta (F11). Um
  gatilho nas duas tabelas impede o mesmo `transfer_id` nas duas.
- Valor e data editados atualizam a transferência criada pelo movimento (mesma linha, mesmo id).
  Movimento vinculado: valor/data são da transferência (editar pelo lançamento).
- Transferência criada com data futura nasce `pending` com `auto_confirm` (confirma sozinha no dia). Editar preserva o `status` e só o troca quando a data cruza hoje; `paid_at` segue a data.
- A transferência CRIADA pelo movimento é protegida por gatilho: apagar ou mudar tipo, contas, valor ou data direto é recusado ("edite ou desfaça pela posição"); cascata de conta/espaço passa.
- Histórico ordenado pela data da transferência (depois criação e id), cursor composto; movimento cuja transferência foi apagada aparece como "Lançamento apagado", só com Desfazer.
- Transferência apagada fora do movimento: FK `set null`, o movimento fica "sem lançamento" e
  some do histórico de posição (é a transferência que move o saldo).

## Persistência

Migration `<ts>_investment_movements.sql`:

```sql
create table public.investment_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  position_account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('contribution','redemption')),
  transfer_id uuid unique references public.transactions(id) on delete set null,
  created_transfer boolean not null default false,
  edit_revision bigint not null default 1,
  created_at timestamptz not null default now()
);
```

Valor, data e contraparte moram na transferência (fonte única). RLS deny-by-default, select por
workspace; escrita só pelas funções. Recibo selado `private.investment_write_receipts`, mesmo
desenho do F11.

## RPCs

`private.*` security definer + wrapper `public` invoker; revoke public/anon; `search_path=''`;
`set timezone to 'America/Sao_Paulo'` no cabeçalho.

```ts
// public.investment_command(p_input jsonb, p_request_id uuid) returns jsonb
type InvestmentInput =
  | { op: 'contribute'; position_account_id: string; from_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'redeem'; position_account_id: string; to_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'link'; transfer_id: string }               // a ponta investment define posição e natureza
  | { op: 'edit'; movement_id: string; amount_cents: string; occurred_on: string; expected_revision: number }
  | { op: 'undo'; movement_id: string; expected_revision: number };
// → { movement_id, transfer_id, position_balance_cents: string, revision }
```

Ordem de travas: advisory `investment:<ws>`, depois a conta-posição `for update`. Revisão velha →
`PT409`. Mesma chave + payload devolve o anterior; payload diferente é erro.

Leituras: `public.investment_positions()` (posições do workspace: saldo realizado, aportado
líquido, contagem de movimentos) e `public.investment_movements_page(p_position_account_id,
p_limit, p_before)` (paginado, mais recente primeiro, com valor/data/contraparte/natureza/status
da transferência). `public.investment_link_candidates(p_limit)`.

## Cliente

`src/lib/investment.ts` (+ teste): tipos, validação, efeito (origem/posição antes → depois),
rótulos. `src/hooks/use-investments.ts`. UI: seção "Investimentos" em
`src/app/finance/net-worth.tsx` com as posições, ações Aplicar/Resgatar e o histórico; folha
curta compartilhada (`Segmented` Aplicar | Resgatar, `AccountPicker`s, `MoneyField`,
`DatePickerField`, efeito, salvar). Sem kit novo. Linha no `docs/AGENTE-PARIDADE-COM-O-APP.md`
(o agente ainda não aplica/resgata).

## Aceite (matriz)

Resgate parcial/total/excessivo; aporte seguido de resgate e desfazer do aporte (recusado);
data retroativa e futura; editar valor; origem=destino; ponta cartão; dois resgates ao mesmo
tempo (um recusa); mesmo request repetido; vincular transferência importada e repetir; mesma
transferência tentando entrar numa meta (F11) e num investimento; receita/despesa consolidadas
e patrimônio líquido iguais antes/depois. Nativo nos dois sistemas com claro/escuro, fonte
grande, ocultar valores e Reduzir movimento.
