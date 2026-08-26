-- Advisors: os helpers de `private` ficaram com search_path mutavel.
-- Sao `immutable` e chamaveis por `authenticated`, entao levam search_path fixo
-- igual as demais funcoes do projeto. As chamadas internas ja sao schema-qualified.
alter function private.day_in_month(date, int) set search_path = public;
alter function private.add_months(date, int) set search_path = public;
alter function private.invoice_window(int, int, date) set search_path = public;
alter function private.normalize_description(text) set search_path = public;
alter function private.dedupe_hash(date, bigint, text) set search_path = public;
