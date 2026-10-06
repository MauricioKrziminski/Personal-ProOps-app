"""Calibra `exemplos.SIMILARIDADE_MINIMA` com o Gemini real (o mesmo método da busca semântica).

Vetoriza o banco de exemplos e frases de FORA dele: do domínio (gasto, consulta, parcela, fatura…
escritas de outro jeito) e de fora do domínio de finanças (nota, lembrete, conversa). Imprime o
top-1 de cada frase no grupo dela e o pior/melhor de cada lado — o piso fica entre os dois.

    cd agent && PYTHONPATH=. .venv/bin/python scripts/probe_exemplos.py
"""

from __future__ import annotations

import asyncio

from app.graph import exemplos
from app.services import embeddings

# (grupo, frase): finanças escritas de outro jeito — devem achar exemplo do mesmo tipo
DOMINIO = [
    ("parse", "paguei 32,90 de uber agora"),
    ("parse", "comprei um tênis de 600 em 4x no cartão do itaú"),
    ("parse", "caiu meu salário de 4.200"),
    ("parse", "passa 200 da poupança pra corrente"),
    ("parse", "a conta de luz de setembro já foi paga"),
    ("parse", "muda o valor do último gasto pra 58"),
    ("parse", "apaga aquele lançamento do ifood"),
    ("parse", "guarda 150 na meta da viagem"),
    ("parse", "paguei a fatura do nubank inteira"),
    ("parse", "almocei 27 reais no pix"),
    ("parse", "netflix 55,90 todo mês"),
    ("parse", "farmácia 89 no débito"),
    ("consulta", "quanto saiu de mercado em agosto?"),
    ("consulta", "qual o saldo da minha conta do inter"),
    ("consulta", "quanto tá a fatura do cartão?"),
    ("consulta", "o que vence essa semana"),
    ("consulta", "me mostra os gastos com restaurante"),
    ("consulta", "se eu comprar uma geladeira de 3 mil em 10x dá?"),
    ("consulta", "quanto falta pra minha meta"),
    ("consulta", "quais minhas assinaturas"),
]
# frases que não são do tipo de nenhum exemplo — o piso tem que cortar
FORA = [
    ("parse", "oi, tudo bem?"),
    ("parse", "anota que a senha do wifi é casa123"),
    ("parse", "me lembra de ligar pro dentista amanhã"),
    ("parse", "qual a capital da austrália"),
    ("parse", "obrigado!"),
    ("consulta", "o que você consegue fazer?"),
    ("consulta", "quais são minhas notas da pasta trabalho"),
    ("consulta", "me conta uma piada"),
    ("consulta", "que horas são"),
    ("consulta", "boa noite"),
]


async def main() -> None:
    banco = exemplos.carregar()
    gravados = exemplos.vetores_gravados()
    assert all(e["frase"] in gravados for e in banco), "rode scripts/vetorizar_exemplos.py antes"
    indice = [(e, gravados[e["frase"]]) for e in banco]
    lados: dict[str, list[float]] = {"dominio": [], "fora": []}
    for lado, frases in (("dominio", DOMINIO), ("fora", FORA)):
        print(f"== {lado}")
        for grupo, frase in frases:
            v = await embeddings.embed_consulta(frase)
            assert v, f"embedding falhou em {frase!r}"
            s, e = max(
                ((exemplos._cosseno(v, ve), ex) for ex, ve in indice if ex["grupo"] == grupo),
                key=lambda p: p[0],
            )
            lados[lado].append(s)
            print(f"  {s:.3f}  {frase!r:55} -> {e['frase']!r}")
    print(f"\ndomínio: min {min(lados['dominio']):.3f}  max {max(lados['dominio']):.3f}")
    print(f"fora:    min {min(lados['fora']):.3f}  max {max(lados['fora']):.3f}")
    print(f"piso atual: {exemplos.SIMILARIDADE_MINIMA}")


if __name__ == "__main__":
    asyncio.run(main())
