#!/usr/bin/env python3
"""Simula notificação de banco para testar a captura no STAGING.

    python3 scripts/simular-notificacao.py --lista                 # os casos prontos, numerados
    python3 scripts/simular-notificacao.py 0 2 8                   # pelo aparelho (adb)
    python3 scripts/simular-notificacao.py --todos --via rota      # direto no agente do staging
    python3 scripts/simular-notificacao.py --titulo "Pix recebido" --texto "Você recebeu um Pix de R$ 80,00 de ANA."

Os casos são os de `agent/scripts/notificacoes_de_banco.py` (os mesmos da sonda do modelo).

## Dois caminhos, e o que cada um prova

- **adb** (padrão): posta uma notificação de verdade no Android ligado ao `adb`. Passa pelo leitor
  (`CapturaService`), pela fila do aparelho, pelo envio do app e pelo agente — o caminho inteiro.
  O Android não deixa postar em nome de outro app, então ela chega como o pacote `com.android.shell`,
  que o app chama de "Teste (adb)". Precisa: build de DESENVOLVIMENTO (o banco de teste só existe em
  `__DEV__`), captura ligada no Perfil com "Teste (adb)" marcado, e o agente com
  `CAPTURA_ACEITA_TESTE=true` (o staging tem). O app envia a fila ao abrir ou voltar para a frente.
  A mesma notificação (título e texto iguais) em menos de 5 min vira uma só no aparelho — é o
  comportamento real, não defeito.
- **rota**: entra como `dev@proops.local` e manda direto para `/internal/captures/notifications`,
  com o pacote REAL do banco (Nubank, Itaú…). Prova o servidor, o rascunho e a duplicata com o
  enquadramento de cada banco; não passa pelo aparelho. Resultado em Finanças → Capturas da conta dev.

Cada notificação que tem valor em reais é uma chamada ao modelo do staging (Claude Haiku).
"""

import argparse
import hashlib
import json
import pathlib
import runpy
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent
STAGING_REF = "utkqoiigimqzeenxkxdl"
CASOS = runpy.run_path(str(RAIZ / "agent/scripts/notificacoes_de_banco.py"))["CASOS"]


def ambiente() -> dict[str, str]:
    env = {}
    for linha in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in linha and not linha.lstrip().startswith("#"):
            chave, valor = linha.split("=", 1)
            env[chave.strip()] = valor.strip().strip('"')
    if STAGING_REF not in env.get("EXPO_PUBLIC_SUPABASE_URL", ""):
        sys.exit("`.env.local` não aponta para o staging — recuso mandar notificação simulada.")
    return env


def post(url: str, corpo: dict, cabecalhos: dict) -> dict:
    pedido = urllib.request.Request(
        url, data=json.dumps(corpo).encode(), method="POST",
        headers={"Content-Type": "application/json", **cabecalhos},
    )
    try:
        with urllib.request.urlopen(pedido, timeout=120) as resposta:
            return json.loads(resposta.read() or b"{}")
    except urllib.error.HTTPError as erro:
        sys.exit(f"{url} → HTTP {erro.code}: {erro.read().decode()[:300]}")


def via_adb(itens: list[tuple[str, str, str]]) -> None:
    for i, (_pacote, titulo, texto) in enumerate(itens):
        tag = f"proops-sim-{int(time.time())}-{i}"
        remoto = " ".join(shlex.quote(p) for p in
                          ["cmd", "notification", "post", "-S", "bigtext", "-t", titulo, tag, texto])
        subprocess.run(["adb", "shell", remoto], check=True)
        print(f"postada: {titulo} | {texto}")
    print("\nAbra o app (ou volte para ele) para enviar a fila; o resultado aparece em Finanças → Capturas.")


def via_rota(itens: list[tuple[str, str, str]], email: str, senha: str) -> None:
    env = ambiente()
    anon = env["EXPO_PUBLIC_SUPABASE_ANON_KEY"]
    sessao = post(f"{env['EXPO_PUBLIC_SUPABASE_URL']}/auth/v1/token?grant_type=password",
                  {"email": email, "password": senha}, {"apikey": anon})
    agora = datetime.now(timezone.utc).isoformat()
    lote = [{
        "external_id": hashlib.sha256(f"{p}|{t}|{x}|{time.time_ns()}".encode()).hexdigest(),
        "package": p, "title": t, "text": x, "posted_at": agora,
    } for p, t, x in itens]
    for inicio in range(0, len(lote), 20):  # MAX_POR_ENVIO da rota
        r = post(f"{env['EXPO_PUBLIC_AGENT_URL'].rstrip('/')}/internal/captures/notifications",
                 {"timezone": "America/Sao_Paulo", "items": lote[inicio:inicio + 20]},
                 {"Authorization": f"Bearer {sessao['access_token']}"})
        print(f"aceitas {len(r.get('aceitos', []))}, novas {r.get('novos')}")
    print(f"\nResultado em Finanças → Capturas, entrando como {email}.")


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("casos", nargs="*", type=int, help="números da --lista")
    a.add_argument("--lista", action="store_true")
    a.add_argument("--todos", action="store_true")
    a.add_argument("--via", choices=["adb", "rota"], default="adb")
    a.add_argument("--titulo", default="")
    a.add_argument("--texto", help="notificação própria (cole a do seu banco)")
    a.add_argument("--banco", default="com.nu.production", help="pacote do banco, só na --via rota")
    a.add_argument("--email", default="dev@proops.local")
    a.add_argument("--senha", default="devtest123")
    args = a.parse_args()

    if args.lista:
        for i, (pacote, titulo, texto, esperado) in enumerate(CASOS):
            print(f"{i:2}  {pacote:24} {titulo} | {texto}  → {esperado or 'não lança'}")
        return
    if args.texto:
        itens = [(args.banco, args.titulo, args.texto)]
    else:
        escolhidos = range(len(CASOS)) if args.todos else args.casos
        if not escolhidos:
            a.error("diga os casos (números da --lista), --todos ou --texto")
        itens = [CASOS[i][:3] for i in escolhidos]

    if args.via == "adb":
        via_adb(itens)
    else:
        via_rota(itens, args.email, args.senha)


if __name__ == "__main__":
    main()
