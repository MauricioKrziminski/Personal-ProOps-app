-- O dia do fechamento pertence à fatura SEGUINTE.
--
-- `private.invoice_window` (0013) mandava a compra feita NO dia do fechamento para a fatura
-- daquele mês (`p_occurred <= day_in_month(...)`). O cartão faz o contrário, e os documentos de
-- 09/09/2026 provam isso dos dois lados, com o mesmo cartão (Nubank, fecha dia 3):
--
--   · fatura que vence 10/09, "Período vigente: 03 AGO a 03 SET" — CONTÉM as compras de 03 AGO
--     (Globo Premiere 2/10, Mercadolivre 2/2, Pneustore 6/10, King Cell 9/10);
--   · OFX da fatura de outubro, `DTSTART 20260903` — CONTÉM as compras de 03 SET
--     (King Cell 10/10, Luizroberto 2/12, Pneustore 7/10, Globo Premiere 3/10).
--
-- A mesma data não pode estar nas duas, então a janela real é `[fechamento anterior, fechamento
-- atual)`: começa NO dia do fechamento anterior e termina UM DIA ANTES do próximo. Com a regra
-- velha, uma compra de 03/08 era cobrada em 10/08 pelo app e em 10/09 pelo cartão — um ciclo
-- inteiro de diferença, e a causa de as parcelas do Nubank parecerem um mês atrasadas.
--
-- É um caractere porque a regra mora num lugar só: o trigger `set_invoice`, o app, o agente e a
-- importação todos derivam daqui. Corrigir em qualquer outro lugar criaria a segunda cópia.
--
-- ⚠️ Esta migration NÃO move nenhuma linha existente. `set_invoice` é
-- `before insert or update of account_id, occurred_at` (0013): sem um UPDATE que toque nessas
-- duas colunas, nada é reavaliado. O remanejamento das linhas já gravadas é decisão separada,
-- feita linha a linha.
--
-- ⚠️ Vale para qualquer cartão, e é isso que se quer: a regra é do produto, não de um emissor.
-- Só há evidência documental do Nubank (o BB fecha dia 31 e nenhuma fatura tem compra no dia 31),
-- mas manter dois comportamentos exigiria uma coluna por cartão para uma diferença que ninguém
-- demonstrou existir.
create or replace function private.invoice_window(
  p_closing_day int, p_due_day int, p_occurred date
)
returns table(reference_month date, closing_date date, due_date date)
language sql immutable
as $$
  with ref as (
    select case
      -- `<` e não `<=`: a compra DO dia do fechamento já é da próxima fatura
      when p_occurred < private.day_in_month(p_occurred, p_closing_day)
        then date_trunc('month', p_occurred)::date
      else (date_trunc('month', p_occurred) + interval '1 month')::date
    end as ref_month
  )
  select r.ref_month,
         private.day_in_month(r.ref_month, p_closing_day),
         case when p_due_day > p_closing_day
              then private.day_in_month(r.ref_month, p_due_day)
              else private.day_in_month(private.add_months(r.ref_month, 1), p_due_day)
         end
  from ref r;
$$;

-- A prova, rodando: os casos que os documentos fixam. Falha aqui derruba a migration antes de
-- qualquer linha ser gravada, que é o único momento em que isso custa barato.
do $$
declare v date;
begin
  -- compra NO fechamento (03/08, cartão que fecha dia 3) → fatura que vence 10/09.
  -- Documento: fatura Nubank de 10/09, "Período vigente: 03 AGO a 03 SET", contém as de 03 AGO.
  select due_date into v from private.invoice_window(3, 10, date '2026-08-03');
  assert v = date '2026-09-10', format('03/08 deveria vencer 10/09, veio %s', v);

  -- o dia seguinte continua na mesma fatura (era o único que já estava certo)
  select due_date into v from private.invoice_window(3, 10, date '2026-08-04');
  assert v = date '2026-09-10', format('04/08 deveria vencer 10/09, veio %s', v);

  -- a véspera do fechamento é da fatura que fecha — o outro lado da borda
  select due_date into v from private.invoice_window(3, 10, date '2026-08-02');
  assert v = date '2026-08-10', format('02/08 deveria vencer 10/08, veio %s', v);

  -- um ciclo adiante, pelo segundo documento.
  -- OFX da fatura de outubro: DTSTART 20260903, e as parcelas de 03/09 estão nela.
  select due_date into v from private.invoice_window(3, 10, date '2026-09-03');
  assert v = date '2026-10-10', format('03/09 deveria vencer 10/10, veio %s', v);

  -- regressão de `private.day_in_month`: fechamento 31 em mês curto continua sendo o último dia,
  -- e o vencimento continua rolando para o mês seguinte quando due_day < closing_day
  select due_date into v from private.invoice_window(31, 10, date '2026-02-15');
  assert v = date '2026-03-10', format('15/02 c/ fechamento 31 deveria vencer 10/03, veio %s', v);
end $$;
