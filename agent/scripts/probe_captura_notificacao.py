"""Sonda: o texto de uma notificação de banco vira o rascunho certo — ou nenhum.

Espelha a rota (`routes/captures.py`): o portão `tem_valor` (sem R$ não chama modelo), o `finance_node` com a
origem da captura e a conferência do código (`domain/captura.fechar`: mark_paid, valor ancorado no texto,
data). O resultado que importa é o rascunho FINAL, não a saída crua do modelo.

Roda no Gemini GRATUITO (IA_TABELA=economica) e imprime quantas chamadas fará antes de fazer.
Os casos moram em `notificacoes_de_banco.py` (o simulador lê os mesmos). Esperado:
("expense"|"income", centavos), ("expense"|"income", None) = sem valor e com pergunta, None = não lança.

    cd agent && .venv/bin/python scripts/probe_captura_notificacao.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("IA_TABELA", "economica")
os.environ["LANGFUSE_PUBLIC_KEY"] = ""

from app.domain import captura  # noqa: E402
from app.graph import nodes  # noqa: E402
from scripts.eval_cache import com_paciencia  # noqa: E402
from app.routes.captures import BANCOS, origem_da_notificacao, tem_valor, texto_da_notificacao  # noqa: E402
from scripts.notificacoes_de_banco import CASOS  # noqa: E402


async def main() -> int:
    com_modelo = sum(tem_valor(f"{t} {x}") for _p, t, x, _e in CASOS)
    print(f"{com_modelo} chamadas ao modelo (parse); {len(CASOS) - com_modelo} casos não chegam a ele (sem valor em reais).")
    erros = 0
    for pacote, titulo, texto, esperado in CASOS:
        banco = BANCOS[pacote]
        obtido, perguntas = None, []
        if tem_valor(f"{titulo} {texto}"):
            estado = {"text": texto_da_notificacao(titulo, texto), "origem": origem_da_notificacao(banco),
                      "timezone": "America/Sao_Paulo", "workspace_id": None, "messages": None,
                      "agora_local": "2026-10-12T13:05:00"}
            saida = await com_paciencia(lambda: nodes.finance_node(estado))
            acao, perguntas = captura.fechar(saida.get("finance_actions", []), titulo, texto)
            if acao:
                obtido = ("income" if acao["type"] == "create_income" else "expense", acao.get("amount_cents"))
        ok = obtido == esperado and (esperado is None or esperado[1] is not None or bool(perguntas))
        erros += not ok
        print(("ok   " if ok else "FALHA"), banco, "|", texto[:60], "→", obtido, perguntas or "",
              "" if ok else f"(esperado {esperado})")
    print(f"\n{len(CASOS) - erros}/{len(CASOS)}")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
