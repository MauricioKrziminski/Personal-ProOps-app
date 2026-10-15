"""Sonda: o texto de uma notificação de banco vira o rascunho certo — ou nenhum.

Espelha a rota (`routes/captures.py`): o portão `tem_valor` (sem R$ não chama modelo), o `finance_node` com a
origem da captura e a conferência do código (`domain/captura.fechar`: mark_paid, valor ancorado no texto,
data). O resultado que importa é o rascunho FINAL, não a saída crua do modelo.

Roda no Gemini GRATUITO (IA_TABELA=economica) e imprime quantas chamadas fará antes de fazer.
Os casos moram em `notificacoes_de_banco.py` (o simulador lê os mesmos). Esperado:
("expense"|"income", centavos), ("expense"|"income", None) = sem valor e com pergunta, None = não lança.

    cd agent && .venv/bin/python scripts/probe_captura_notificacao.py [--ultimos N]
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


async def main(ultimos: int | None = None) -> int:
    """`--ultimos N`: só os N últimos casos (para medir um caso novo sem gastar a cota do dia inteira)."""
    casos = CASOS[-ultimos:] if ultimos else CASOS
    com_modelo = sum(tem_valor(f"{t} {x}") for _p, t, x, _e in casos)
    print(f"{com_modelo} chamadas ao modelo (parse); {len(casos) - com_modelo} casos não chegam a ele (sem valor em reais).")
    erros = 0
    for pacote, titulo, texto, esperado in casos:
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
        # 2 elementos: valor sem pergunta de valor (ou, com None, só a pergunta); 3º "confira": valor E pergunta
        pede_pergunta = esperado is not None and (esperado[1] is None or len(esperado) == 3)
        ok = (obtido == (esperado[:2] if esperado else None)
              and (esperado is None or pede_pergunta == any(q.startswith(("Confira o valor", "Compra de")) for q in perguntas)))
        erros += not ok
        print(("ok   " if ok else "FALHA"), banco, "|", texto[:60], "→", obtido, perguntas or "",
              "" if ok else f"(esperado {esperado})")
    print(f"\n{len(casos) - erros}/{len(casos)}")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "--ultimos" else None)))
