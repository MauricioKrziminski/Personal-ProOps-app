#!/usr/bin/env bash
# Aplica UM arquivo .sql em produção. Existe porque não há psql no PATH deste Mac e porque
# correção de DADO não pode virar migration (migration roda no staging também, onde os dados
# são outros).
#
#   PROOPS_PROD_OK=1 ./supabase/fixes/aplicar-em-producao.sh supabase/fixes/<arquivo>.sql
#
# O arquivo precisa abrir com `begin` e fechar com `commit`: é ele que decide o que é atômico,
# e as asserções dentro dele é que dizem se o resultado bate com os documentos.
set -euo pipefail
cd "$(dirname "$0")/../.."

[ $# -eq 1 ] || { echo "uso: $0 <arquivo.sql>"; exit 2; }
[ -f "$1" ] || { echo "não achei $1"; exit 2; }
[ "${PROOPS_PROD_OK:-}" = "1" ] || {
  echo "isto ESCREVE EM PRODUÇÃO. Repita com PROOPS_PROD_OK=1 na frente."; exit 1; }

exec agent/.venv/bin/python - "$1" <<'PY'
import re, sys
from pathlib import Path
import psycopg

url = next(re.sub(r"\s+#.*$", "", l.split("=", 1)[1]).strip().strip('"')
           for l in Path("agent/.env.production").read_text().splitlines()
           if l.startswith("DATABASE_URL="))
assert "kwriuifcwyvdrxtspjiz" in url, "esse DATABASE_URL não é o de produção"

sql = Path(sys.argv[1]).read_text()
print(f"produção kwriuifcwyvdrxtspjiz ← {sys.argv[1]}")
# autocommit para o `begin`/`commit` de dentro do arquivo valerem; sem ele o psycopg abriria uma
# transação por fora e o `commit` do arquivo fecharia a errada.
with psycopg.connect(url, autocommit=True, connect_timeout=30) as c:
    c.add_notice_handler(lambda d: print(d.message_primary))
    with c.cursor() as cur:
        cur.execute(sql)
print("aplicado")
PY
