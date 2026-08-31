#!/usr/bin/env python3
"""Dia 1: os schemas por domínio passam no Gemini REAL?

Por que este script existe. O teto de 15 propriedades e UM enum foi medido no
`responseSchema` cru da API v1beta. O agente não fala com a API assim — ele usa
`with_structured_output` do langchain-google-genai, que converte o modelo Pydantic
para **function calling**. É outro caminho, com outra serialização e possivelmente
outro limite. Descobrir isso em produção custa o parse inteiro parando.

    export GEMINI_API_KEY=...
    .venv/bin/python scripts/validate_gemini_schemas.py
    .venv/bin/python scripts/validate_gemini_schemas.py --probe   # acha o teto real

Sem `--probe` gasta 3 chamadas do Flash-Lite (cota grátis: 500/dia).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="langchain_google_genai.*")
logging.getLogger("google_genai").setLevel(logging.ERROR)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pydantic import BaseModel, Field, create_model  # noqa: E402

from app.graph.prompts import FINANCE, FINANCE_QUERY, NOTES, ROUTER  # noqa: E402
from app.graph.schemas import (  # noqa: E402
    FinancePlan,
    FinanceQueryPlan,
    NotesPlan,
    RouterDecision,
)
from app.services import gemini  # noqa: E402

VERDE, VERMELHO, AMARELO, FIM = "\033[32m", "\033[31m", "\033[33m", "\033[0m"

# Mensagens reais, não "teste": um schema pode ser aceito e ainda assim o modelo
# devolver lixo. Aqui dá para ver as duas coisas de uma vez.
CASOS = [
    ("Router", RouterDecision, ROUTER, "gastei 45 no mercado e me lembra de pagar o aluguel dia 5"),
    ("Finanças (escrita)", FinancePlan, FINANCE, "mercado 200, uber 30 e recebi 500 de freela"),
    ("Finanças (consulta)", FinanceQueryPlan, FINANCE_QUERY, "quanto gastei esse mês com mercado?"),
    ("Notas", NotesPlan, NOTES, "anota: ligar pro dentista amanhã de manhã"),
]


AMBIENTE = (
    "validation error for Settings",
    "API key not valid",
    "API_KEY_INVALID",
    "PERMISSION_DENIED",
    "Name or service not known",
    "Temporary failure in name resolution",
    "ConnectError",
    "quota",
    "RESOURCE_EXHAUSTED",
)


def _erro_de_ambiente(texto: str) -> bool:
    """Chave errada, rede fora, cota estourada: nada disso é o schema."""
    return any(marca.lower() in texto.lower() for marca in AMBIENTE)


MAX_PRODUTO = 198  # maior configuração observada como aceita


def conta_propriedades(modelo: type[BaseModel]) -> tuple[int, int]:
    """(propriedades da AÇÃO, valores do enum) — o par que forma o orçamento.

    O limite do Gemini é o PRODUTO dos dois, não cada um. Ver o cabeçalho de
    `app/graph/schemas.py` para as medições.
    """
    schema = modelo.model_json_schema()
    defs = schema.get("$defs", {})

    # Plan é uma casca com `actions`; o que interessa é a AÇÃO
    props = schema.get("properties", {})
    alvo = props
    for nome, corpo in props.items():
        if nome == "actions" and defs:
            ref = corpo.get("items", {}).get("$ref", "")
            chave = ref.rsplit("/", 1)[-1]
            if chave in defs:
                alvo = defs[chave].get("properties", {})
    valores = max((len(d["enum"]) for d in defs.values() if "enum" in d), default=0)
    return len(alvo), valores


async def testa(nome: str, modelo: type[BaseModel], prompt: str, mensagem: str) -> bool:
    props, valores = conta_propriedades(modelo)
    orcamento = props * valores
    marca = "" if orcamento <= MAX_PRODUTO else f"  {AMARELO}(acima de {MAX_PRODUTO}!){FIM}"
    print(f"\n{nome}: {props} props × {valores} valores de enum = {orcamento}{marca}", flush=True)

    try:
        chain = gemini.structured(modelo, gemini.GEMINI_PARSE)
        resposta = await chain.ainvoke([("system", prompt), ("human", mensagem)])
    except Exception as err:  # noqa: BLE001
        texto = str(err)
        # Distinguir isto importa: um erro de config reportado como "schema
        # recusado" faria alguém sair cortando campo à toa.
        if _erro_de_ambiente(texto):
            print(f"  {AMARELO}⚠ NÃO TESTADO — problema de ambiente, não de schema{FIM}")
            print(f"    {texto[:300]}")
            return False
        print(f"  {VERMELHO}✗ SCHEMA RECUSADO{FIM}")
        print(f"    {texto[:400]}")
        if "INVALID_ARGUMENT" in texto or "400" in texto:
            print(f"    {AMARELO}→ é o teto do schema. Tire um campo antes de somar outro.{FIM}")
        return False

    print(f"  {VERDE}✓ aceito{FIM}")
    # o modelo respondeu algo utilizável?
    resumo = resposta.model_dump()
    acoes = resumo.get("actions")
    if acoes is not None:
        print(f"    devolveu {len(acoes)} ação(ões): {[a.get('type') for a in acoes]}")
    else:
        print(f"    devolveu: {resumo}")
    return True


async def probe() -> None:
    """Busca binária pelo teto REAL no caminho do with_structured_output.

    Custa chamadas (cota do Flash-Lite: 500/dia), então só roda quando pedido.
    """
    print("\n--- procurando o teto de propriedades ---")
    baixo, alto, ultimo_ok = 1, 64, 0
    while baixo <= alto:
        meio = (baixo + alto) // 2
        campos = {f"campo_{i}": (str | None, Field(None, description=f"campo {i}")) for i in range(meio)}
        Sonda = create_model("Sonda", **campos)  # type: ignore[call-overload]
        try:
            await gemini.structured(Sonda, gemini.GEMINI_PARSE).ainvoke(
                [("system", "Devolva o objeto vazio."), ("human", "oi")]
            )
            ultimo_ok, baixo = meio, meio + 1
            print(f"  {meio:>3} propriedades: {VERDE}ok{FIM}")
        except Exception as err:  # noqa: BLE001
            # a MESMA armadilha da função acima: chave ruim devolve 400
            # INVALID_ARGUMENT, que é exatamente o código de "schema grande
            # demais". Sem esta parada, a busca binária concluiria "teto = 0".
            if _erro_de_ambiente(str(err)):
                print(f"  {AMARELO}⚠ abortando a sonda: {str(err)[:120]}{FIM}")
                return
            alto = meio - 1
            print(f"  {meio:>3} propriedades: {VERMELHO}recusado{FIM} ({str(err)[:80]})")
    print(f"\n  teto medido: {ultimo_ok} propriedades")
    print(f"  o código assume 15 — {'folga' if ultimo_ok >= 15 else 'PROBLEMA: menor que o assumido'}")


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--probe", action="store_true", help="busca binária pelo teto real (gasta cota)")
    args = p.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print(f"{VERMELHO}GEMINI_API_KEY não definida.{FIM} Este script fala com a API de verdade —")
        print("é o único jeito de saber se o schema passa. Exporte a chave e rode de novo.")
        return 1

    print(f"modelo: {gemini.GEMINI_PARSE}")
    # Sequencial de propósito. Com `gather` os quatro cabeçalhos saíam juntos e
    # os resultados chegavam fora de ordem — num diagnóstico, ler o resultado de
    # um schema debaixo do cabeçalho de outro é pior do que esperar 40 segundos.
    # De quebra, respeita o limite de 15 RPM do Flash-Lite.
    resultados = [await testa(*caso) for caso in CASOS]
    ok = all(resultados)

    if args.probe:
        await probe()

    if ok:
        print(f"\n{VERDE}Todos os schemas passaram no caminho do with_structured_output.{FIM}")
        return 0
    print(f"\n{VERMELHO}Nem todos passaram. Leia o rótulo de cada um:{FIM}")
    print("  ⚠ NÃO TESTADO  -> conserte o ambiente e rode de novo; o schema não foi julgado")
    print("  ✗ SCHEMA RECUSADO -> aí sim é o teto: tire um campo antes de somar outro")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
