#!/usr/bin/env python3
"""Cria as contas de TESTE no Supabase LOCAL do E2E e roda supabase/seed-e2e.sql.

Só fala com localhost (recusa qualquer outra URL). Idempotente: apaga as contas e2e da rodada
anterior (private.apagar_conta) e recria, com senhas NOVAS geradas aqui.
Saída: scripts/e2e/.e2e-config.json (gitignored) — o Playwright e o agente leem dele.

    python3 scripts/e2e-seed.py
"""
import json, pathlib, secrets, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
WORKDIR = RAIZ / "scripts" / "e2e"
DB_CONTAINER = "supabase_db_proops-e2e"
DOMINIO = "e2e.proops.test"

# slug -> (nome, só-telefone?)
USUARIOS = {
    "admin": ("Admin E2E", False), "admin-mfa": ("Admin MFA E2E", False), "comum": ("Cida Comum", False),
    "nunca": ("Nina Nunca", False), "teste1": ("Tiago Teste", False), "teste2": ("Tereza Teste", False),
    "manual": ("Marta Manual", False), "familia": ("Fabio Familia", False), "membro": ("Mara Membro", False),
    "apple": ("Alice Apple", False), "google": ("Gustavo Google", False), "encerrada": ("Elena Encerrada", False),
    "encerrada2": ("Eduardo Encerrado", False), "suspensa": ("Sara Suspensa", False),
    "sememail": ("Pedro Sem Email", True),
    "a-plano": ("Ana Plano", False), "a-loja": ("Lia Loja", False), "a-susp": ("Saulo Suspenso", False),
    "a-reset": ("Rita Reset", False), "a-zap": ("Zeca Zap", False), "a-del": ("Davi Delete", False),
    "a-del-sem": ("Dora Sem Email", True),
    **{f"bulk{i:02d}": (f"Bulk {i:02d}", False) for i in range(1, 31)},
}


def sh(*cmd, entrada=None):
    r = subprocess.run(cmd, input=entrada, capture_output=True, text=True, cwd=RAIZ)
    if r.returncode:
        sys.exit(f"falhou: {' '.join(cmd)}\n{r.stdout}\n{r.stderr}")
    return r.stdout


def sql(texto):
    return sh("docker", "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-f", "-", entrada=texto)


def http(metodo, url, chave, corpo=None):
    req = urllib.request.Request(url, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{metodo} {url} -> {e.code} {e.read().decode()[:300]}")


def main():
    st = json.loads(sh("npx", "supabase", "status", "--workdir", str(WORKDIR), "-o", "json"))
    api = st["API_URL"]
    if not api.startswith("http://127.0.0.1"):
        sys.exit(f"recusado: API_URL não é local ({api})")
    anon, service = st["ANON_KEY"], st["SERVICE_ROLE_KEY"]

    # 1) apaga a rodada anterior
    sql("""do $$ declare r record; begin
      for r in select id from auth.users where raw_user_meta_data->>'e2e' = '1' loop
        perform private.apagar_conta(r.id); delete from auth.users where id = r.id; end loop; end $$;""")

    # 2) cria as contas (senhas novas)
    users = {}
    for slug, (nome, so_tel) in USUARIOS.items():
        senha = secrets.token_urlsafe(18)
        email = f"{slug}@{DOMINIO}"
        r = http("POST", f"{api}/auth/v1/admin/users", service, {
            "email": email, "password": senha, "email_confirm": True,
            "user_metadata": {"e2e": "1", "slug": slug, "display_name": nome}})
        users[slug] = {"id": r["id"], "email": None if so_tel else email, "password": senha, "name": nome}

    # 3) sessões reais para quem os testes vão encerrar/suspender
    for slug in ("a-susp", "a-reset"):
        for _ in range(2):
            http("POST", f"{api}/auth/v1/token?grant_type=password", anon, {"email": users[slug]["email"], "password": users[slug]["password"]})

    # 4) cenários
    sql((RAIZ / "supabase" / "seed-e2e.sql").read_text())
    fones = dict(l.split("|") for l in sql("select e.slug||'|'||p.phone from (select raw_user_meta_data->>'slug' slug, id from auth.users where raw_user_meta_data->>'e2e'='1') e join public.profiles p on p.id=e.id where p.phone is not null").split())
    for slug, fone in fones.items():
        users[slug]["phone"] = fone

    cfg = {
        "apiUrl": api, "anonKey": anon, "serviceKey": service, "dbUrl": st["DB_URL"],
        "agentUrl": "http://127.0.0.1:8096", "panelUrl": "http://127.0.0.1:8095", "mailpitUrl": "http://127.0.0.1:54324",
        "adminIds": [users["admin"]["id"], users["admin-mfa"]["id"]], "users": users,
    }
    (WORKDIR / ".e2e-config.json").write_text(json.dumps(cfg, indent=2))
    print(f"seed ok: {len(users)} contas -> scripts/e2e/.e2e-config.json")


main()
