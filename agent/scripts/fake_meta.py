#!/usr/bin/env python3
"""Manda um webhook ASSINADO como se fosse a Meta. É o loop de teste local.

Assina de verdade com o WHATSAPP_APP_SECRET: testar com a verificação de HMAC
desligada esconderia justamente o erro mais caro possível nesse endpoint.

    python scripts/fake_meta.py "gastei 45 no mercado"
    python scripts/fake_meta.py --burst "mercado 45" "uber 30" "recebi 500"
    python scripts/fake_meta.py --phone 5551999999999 "apaga o último"
    python scripts/fake_meta.py --click "ds:<id do rascunho>:c:<id do cartão>"

--burst manda tudo em sequência, sem espera: é o teste do debounce. O certo é
UMA resposta consolidada, não três.

--click manda um `interactive.list_reply`, que é o que a Meta entrega quando o
usuário toca numa opção. Sem ele NENHUM clique era testável localmente — nem os
botões de confirmação que já estão em produção —, e o passo "subir local e mandar
payload assinado" do workflow simplesmente não alcançava esse caminho.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid

import httpx


def payload(phone: str, texto: str, clique: str = "") -> dict:
    # o rótulo vai junto no `title` de propósito: é ele que o worker usaria como
    # texto se o clique não fosse reconhecido, e é assim que se vê na prática se
    # a trava contra "rótulo virando lançamento" está de pé
    mensagem = (
        {"type": "interactive",
         "interactive": {"type": "list_reply",
                         "list_reply": {"id": clique, "title": texto}}}
        if clique
        else {"type": "text", "text": {"body": texto}}
    )
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "0",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {"phone_number_id": "teste"},
                            "messages": [
                                {
                                    "from": phone,
                                    "id": f"wamid.TESTE{uuid.uuid4().hex[:20]}",
                                    "timestamp": str(int(time.time())),
                                    **mensagem,
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("mensagens", nargs="*", default=[])
    p.add_argument("--click", default="", help="id da opção clicada (ex: ds:<uuid>:c:<uuid>)")
    p.add_argument("--phone", default=os.getenv("TEST_PHONE", "5551999999999"))
    p.add_argument("--url", default=os.getenv("AGENT_URL", "http://localhost:8080"))
    p.add_argument("--burst", action="store_true", help="manda tudo seguido (testa o debounce)")
    args = p.parse_args()

    segredo = os.getenv("WHATSAPP_APP_SECRET")
    if not segredo:
        print("WHATSAPP_APP_SECRET não definido (exporte ou use o .env)", file=sys.stderr)
        return 1

    mensagens = args.mensagens if args.burst else args.mensagens[:1]
    if args.click and not mensagens:
        # o rótulo do botão é opcional; sem ele o clique vai com um genérico
        mensagens = ["(opção clicada)"]
    if not mensagens:
        print("nada a mandar: passe uma mensagem ou --click", file=sys.stderr)
        return 1
    for texto in mensagens:
        corpo = json.dumps(payload(args.phone, texto, args.click)).encode()
        assinatura = "sha256=" + hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
        resposta = httpx.post(
            f"{args.url}/whatsapp-inbound",
            content=corpo,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": assinatura,
            },
            timeout=10,
        )
        print(f"[{resposta.status_code}] {texto!r} -> {resposta.text}")

    if args.burst:
        print("\nAgora espere ~3s: o debounce deve produzir UMA resposta para as "
              f"{len(mensagens)} mensagens.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
