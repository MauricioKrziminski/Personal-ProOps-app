"""Compara os prompts v1 e v2 (`AGENT_PROMPT_V2`) — para APROVAR antes de ligar a flag.

    .venv/bin/python scripts/comparar_prompts.py --so-prompts      # offline: tamanhos e estimativa de tokens
    .venv/bin/python scripts/comparar_prompts.py                   # Gemini REAL: as frases embutidas
    .venv/bin/python scripts/comparar_prompts.py --frases f.txt    # uma frase por linha (sem histórico)
    .venv/bin/python scripts/comparar_prompts.py --n 10 --output /tmp/cmp.json

O modo padrão roda cada frase nos DOIS caminhos (router -> nós de domínio) e imprime, por frase: os
domínios, as sub-intenções do v2, se as ações extraídas são IGUAIS ou DIFERENTES (com as duas
saídas), os exemplos que o v2 recuperou e os tokens de entrada medidos de cada nó (lidos da
resposta do Gemini). No fim: o total de tokens de entrada v1 × v2 e quantas frases divergiram.

⚠️ Gasta cota: por frase são ~2 a 3 chamadas por caminho (router + domínio) mais 1 embedding no v2.
O script imprime a conta ANTES de rodar. Sem banco e sem envio: leituras viram lista vazia.
Divergência não é regressão por si: o v1 também varia entre execuções (o Lite chuta diferente) —
rode duas vezes antes de concluir, e confira as divergências a olho.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
for linha in (RAIZ / ".env").read_text().splitlines() if (RAIZ / ".env").exists() else []:
    if linha.startswith("GEMINI_") and "=" in linha:
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave, valor.strip().strip('"'))
os.environ.setdefault("DATABASE_URL", "postgresql://sem-banco/nesta-comparacao")
os.environ.setdefault("WHATSAPP_APP_SECRET", "sem-envio")

from app import db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.graph import exemplos, nodes, prompts, prompts_v2  # noqa: E402
from app.services import consumo  # noqa: E402
from scripts.eval_cache import com_paciencia  # noqa: E402

WS = "20000000-0000-0000-0000-000000000001"
BASE = {"timezone": "America/Sao_Paulo", "workspace_id": WS, "user_id": WS, "phone": None,
        "source_message_id": "comparacao", "results": []}

H_MERCADO = [{"role": "user", "content": "gastei 45 no mercado"},
             {"role": "assistant", "content": "✅ Gasto de R$ 45,00 registrado: mercado."}]
H_WARDOGS = [{"role": "user", "content": "Comprei wardogs por 104,99"},
             {"role": "assistant", "content": "✅ Gasto de R$ 104,99 registrado: wardogs."}]
H_LISTA = [{"role": "user", "content": "quanto gastei no Nubank?"},
           {"role": "assistant", "content": "Você gastou R$ 1.200,00 no Nubank. Lançamentos: 1) ..."}]

# (frase, histórico). Cobrem cada módulo, as fronteiras que o prompt existe para segurar e as
# frases dos incidentes (wardogs, nuuvem, "foi engano").
FRASES: list[tuple[str, list[dict]]] = [
    ("gastei 10 no café", []), ("gastei 45 no mercado no pix", []),
    ("recebi 500 de freela", []), ("anota aí que eu gastei 80 no restaurante", []),
    ("gastei uns 40 ou 50 no mercado", []), ("comprei um mac em 12x", []),
    ("comprei uma tv em 10x de 300 no nubank", []), ("tô na 3ª de 8 da cama, 200 cada", []),
    ("transferi 500 da nubank pra poupança", []), ("apliquei 200 no CDB", []),
    ("paguei a fatura do nubank pelo inter", []), ("marca a fatura do inter como paga", []),
    ("paguei a luz, foi 230", []), ("Todas as 8 anteriores do carro, marque como pagas", []),
    ("na verdade foi 50", H_MERCADO), ("foi engano, era 54", H_MERCADO),
    ("o mercado foi 120, não 100", []), ("Na verdade eu comprei em 2x no cartao", H_WARDOGS),
    ("desparcela a compra da tv", []), ("a tv na verdade foi em 12x", []),
    ("apaga o último", []), ("remove o lançamento nuuvem", []),
    ("separei 300 da nubank pra viagem", []), ("quero juntar 10 mil até dezembro de 2027", []),
    ("gastei 30 no almoço e me lembra de pagar a luz amanhã", []),
    ("paguei 45 no mercado, quanto sobrou?", []),
    ("quanto gastei esse mês?", []), ("quanto gastei no pix esse mês?", []),
    ("lançamentos dos últimos 60 dias e com projeção dos próximos 90 dias", []),
    ("por que gastei mais esse mês?", []), ("qual é o meu ciclo?", []),
    ("quando fecha a fatura do nubank?", []), ("vou ficar no vermelho?", []),
    ("e se eu receber 1500 por mês?", []), ("posso comprar um celular de 3000 em 10x?", []),
    ("quando cai meu salário?", []), ("quanto falta do carro?", []),
    ("ver mais", H_LISTA), ("e no outro cartão?", H_LISTA),
    ("cancela a assinatura da netflix", []),
]

# Medido em 06/10/2026 no Gemini real (entrada, sem acerto de cache): router 1.945, parse 4.080.
MEDIDO_V1 = {"router": 1945, "parse": 4080}
TURNO_TIPICO_CHARS = 140  # data + envelope + frase curta


# --------------------------------------------------------------------------- offline


def so_prompts() -> None:
    """Tamanho dos system prompts por tipo de mensagem e estimativa de tokens por CARACTERES.

    A estimativa calibra caracteres/token com os dois pontos medidos hoje (router 1.945 e parse
    4.080 tokens de entrada) — é aproximação, não contagem: a contagem real vem do modo Gemini.
    """
    razao_router = (len(prompts.ROUTER) + TURNO_TIPICO_CHARS) / MEDIDO_V1["router"]
    razao_parse = (len(prompts.FINANCE) + TURNO_TIPICO_CHARS) / MEDIDO_V1["parse"]
    # 4 exemplos típicos de 1 linha (frase -> saída) cabem em ~ isto
    todos = exemplos.carregar()
    media = sum(len(e["frase"]) + len(e["saida"]) + 8 for e in todos) / len(todos)
    ex = 150 + 4 * media

    def tok(chars: float, razao: float) -> int:
        return round(chars / razao)

    linhas = []
    linhas.append(("router", len(prompts.ROUTER), len(prompts_v2.ROUTER_V2), 0, razao_router,
                   MEDIDO_V1["router"]))
    cenarios = [
        ("parse: gastei 10 no café   [criar]", ["criar"]),
        ("parse: tv em 10x           [parcelado]", ["parcelado"]),
        ("parse: transferi 500       [transferencia]", ["transferencia"]),
        ("parse: paguei a fatura     [fatura]", ["fatura"]),
        ("parse: paguei a luz        [baixa]", ["baixa"]),
        ("parse: na verdade foi 50   [alterar]", ["alterar"]),
        ("parse: separei 300 p/ meta [meta]", ["meta"]),
        ("parse: gastei e corrigi    [criar+alterar]", ["criar", "alterar"]),
        ("parse: router sem pista    [TODOS]", []),
    ]
    for nome, subs in cenarios:
        linhas.append((nome, len(prompts.FINANCE), len(prompts_v2.finance(subs)), ex, razao_parse,
                       MEDIDO_V1["parse"]))
    linhas.append(("parse: com ANEXO [todos+documento]", len(prompts.FINANCE),
                   len(prompts_v2.finance([], tem_anexo=True)), 0, razao_parse, MEDIDO_V1["parse"]))
    razao_q = razao_parse
    linhas.append(("consulta: sem histórico", len(prompts.FINANCE_QUERY),
                   len(prompts_v2.finance_query(False)), ex, razao_q, None))
    linhas.append(("consulta: com histórico", len(prompts.FINANCE_QUERY),
                   len(prompts_v2.finance_query(True)), ex, razao_q, None))

    print(f"{'tipo de mensagem':46}{'v1 chars':>9}{'v2 chars':>9}{'v1 tok':>8}{'v2 tok':>8}{'v2 +ex':>8}")
    for nome, c1, c2, extra, razao, medido in linhas:
        t1 = medido if medido else tok(c1 + TURNO_TIPICO_CHARS, razao)
        t2 = tok(c2 + TURNO_TIPICO_CHARS, razao)
        print(f"{nome:46}{c1:>9}{c2:>9}{t1:>8}{t2:>8}{t2 + tok(extra, razao) if extra else t2:>8}")
    print("\nv1 tok = medido (router, parse) ou estimado por caracteres (consulta, mesma razão do parse);"
          "\nv2 tok = estimativa por caracteres com a mesma razão; '+ex' soma os 4 exemplos dinâmicos.")


# --------------------------------------------------------------------------- Gemini


def _resumo(acao: dict) -> dict:
    return {k: v for k, v in acao.items() if v not in (None, "", [], {}) and k != "confidence"}


async def _um_caminho(v2: bool, texto: str, historico: list[dict]) -> dict:
    """Router + nós de domínio no caminho pedido; tokens de entrada por nó."""
    get_settings().agent_prompt_v2 = v2
    uso = consumo.abrir()
    estado = {**BASE, "text": texto,
              "messages": [*historico, {"role": "user", "content": texto}], "subintents": []}
    saida: dict = {"erro": None, "dominios": [], "subintents": [], "acoes": []}
    async def rodar() -> None:
        saida.update(dominios=[], subintents=[], acoes=[])
        local = dict(estado)
        roteado = await nodes.route(local)
        local.update(roteado)
        saida["dominios"] = list(roteado.get("domains") or [])
        saida["subintents"] = list(roteado.get("subintents") or [])
        if "financas" in saida["dominios"]:
            r = await nodes.finance_node(local)
            saida["acoes"] += [_resumo(a) for a in r.get("finance_actions") or []]
        if "financas_consulta" in saida["dominios"]:
            r = await nodes.finance_query_node(local)
            saida["acoes"] += [_resumo(a) for a in r.get("finance_queries") or []]

    try:
        await com_paciencia(rodar)
    except Exception as erro:  # noqa: BLE001 — a comparação registra e segue
        saida["erro"] = f"{type(erro).__name__}: {erro}"[:200]
    saida["tokens"] = {c["no"]: c["input_tokens"] for c in uso.chamadas if c.get("input_tokens")}
    saida["tokens_total"] = sum(saida["tokens"].values())
    saida["embeddings"] = sum(1 for c in uso.chamadas if c["papel"] == "embedding")
    return saida


async def gemini_real(frases: list[tuple[str, list[dict]]], output: str | None) -> int:
    chamadas = len(frases) * 2 * 2
    print(f"{len(frases)} frases x 2 caminhos = ~{chamadas}-{chamadas + len(frases) * 2} chamadas ao "
          f"Gemini (router + domínio, mais 1 embedding por frase no v2).\n", flush=True)

    async def sem_leitura(*_a, **_k):
        return []

    resultados, divergiram, t1, t2 = [], 0, 0, 0
    with patch.object(db, "fetch", side_effect=sem_leitura), \
            patch.object(db, "accounts", side_effect=sem_leitura), \
            patch.object(db, "fetch_one", side_effect=sem_leitura):
        for texto, historico in frases:
            a = await _um_caminho(False, texto, historico)
            b = await _um_caminho(True, texto, historico)
            parecidos = await exemplos.parecidos(texto, "parse")  # vetor já em cache: sem nova chamada
            igual = a["acoes"] == b["acoes"] and a["dominios"] == b["dominios"] and not (a["erro"] or b["erro"])
            divergiram += not igual
            t1 += a["tokens_total"]
            t2 += b["tokens_total"]
            resultados.append({"frase": texto, "historico": bool(historico), "v1": a, "v2": b,
                               "igual": igual, "exemplos": parecidos})
            print(f"{'=' if igual else '≠'} {texto!r}  tokens v1={a['tokens_total']} v2={b['tokens_total']}"
                  f"  dominios={b['dominios']} subintents={b['subintents'] or '(todos)'}", flush=True)
            if not igual:
                print(f"    v1: {a['erro'] or json.dumps([a['dominios'], a['acoes']], ensure_ascii=False)}")
                print(f"    v2: {b['erro'] or json.dumps([b['dominios'], b['acoes']], ensure_ascii=False)}")
                if parecidos:
                    print("    exemplos do v2:\n      " + parecidos.replace("\n", "\n      "))
    print(f"\n{len(frases) - divergiram}/{len(frases)} iguais; tokens de entrada v1={t1} v2={t2} "
          f"({(t2 - t1) / t1:+.0%})" if t1 else "\nsem tokens medidos (a chave do Gemini está configurada?)")
    if output:
        Path(output).write_text(json.dumps(resultados, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--so-prompts", action="store_true",
                        help="offline: tamanhos e estimativa de tokens (não chama o Gemini)")
    parser.add_argument("--frases", help="arquivo com uma frase por linha (sem histórico)")
    parser.add_argument("--n", type=int, help="só as N primeiras frases")
    parser.add_argument("--output", help="grava o JSON completo aqui")
    args = parser.parse_args()
    if args.so_prompts:
        so_prompts()
        raise SystemExit(0)
    if args.frases:
        lista = [(l.strip(), []) for l in Path(args.frases).read_text().splitlines() if l.strip()]
    else:
        lista = FRASES
    raise SystemExit(asyncio.run(gemini_real(lista[: args.n] if args.n else lista, args.output)))
