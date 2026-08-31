"""Casamento de nome de conta/cartão — normalizado, tolerante e determinístico.

Três buscas por nome de conta conviviam com três matchers diferentes: substring
bidirecional em Python (validação do rascunho), `ilike '%x%' limit 1` **sem
`order by`** (execução) e `in` de string minúscula (consulta de fatura). Um nome
que o usuário confirmava como cartão podia resolver para outra conta, e o
desempate era o que o Postgres devolvesse primeiro.

Pior: nenhum dos três removia acento. `"itau"` não achava `"Itaú"` em lugar
nenhum do sistema.

**Empate nunca vira escolha nossa.** A função devolve a LISTA, e quem chama
decide se pergunta (rascunho, que tem como perguntar) ou se desiste
(`resolve_account`, que não tem). É a mesma regra de `resolve.veredito`.
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Acima disto, dois nomes são "a mesma coisa digitada errado" ("nubamk"/"nubank"
# = 0,83). Abaixo, começam a entrar cartões diferentes de banco parecido.
SIMILARIDADE_MINIMA = 0.82

# Nome curto ("Nu", "C6") está contido em quase qualquer frase, então a direção
# "nome dentro do termo" precisa de piso — senão "usei o cartão novo" casaria
# com uma conta chamada "Nu". A direção oposta (termo dentro do nome) não tem o
# problema: quem digita o termo é o usuário.
MIN_NOME_EM_TERMO = 3

_NAO_ALFANUM = re.compile(r"[^a-z0-9]+")


def normalize(texto: str | None) -> str:
    """Sem acento, minúsculo, sem pontuação, sem espaço sobrando.

    NFKD separa a letra do acento e o `encode('ASCII', 'ignore')` joga o acento
    fora — é o que faz "Itaú" e "itau" virarem a mesma string.
    """
    if not texto:
        return ""
    decomposto = unicodedata.normalize("NFKD", texto)
    sem_acento = decomposto.encode("ASCII", "ignore").decode("utf-8")
    return _NAO_ALFANUM.sub(" ", sem_acento.lower()).strip()


def match_accounts(
    termo: str | None,
    linhas: list[dict],
    *,
    key: str = "name",
    semelhanca: bool = True,
) -> list[dict]:
    """As contas que casam com o termo, em ordem de confiança. `[]` se nenhuma.

    Três camadas, e a primeira que produzir resultado ganha — não se misturam:
    um acerto exato não pode ficar atrás de três parciais.

    1. igualdade normalizada  — "itau" == "Itaú"
    2. substring bidirecional — "nubank" dentro de "Nubank Cartão", e
       "Nubank Cartão" dentro de "acabei de criar um pelo app, chama nubank cartao"
    3. semelhança             — typo de digitação

    `semelhanca=False` desliga a camada 3. Existe para quem resolve em SILÊNCIO
    (`resolve_account`) poder tratá-la separado: acertar um typo é ótimo quando
    há como perguntar, e é um jeito novo de escolher a conta errada quando não há.
    """
    alvo = normalize(termo)
    if not alvo or not linhas:
        return []

    exatos = [l for l in linhas if normalize(l.get(key)) == alvo]
    if exatos:
        return exatos

    parciais = []
    for linha in linhas:
        nome = normalize(linha.get(key))
        if not nome:
            continue
        if nome in alvo and len(nome) >= MIN_NOME_EM_TERMO:
            parciais.append(linha)
        elif alvo in nome:
            parciais.append(linha)
    if parciais:
        return parciais

    if not semelhanca:
        return []

    # Semelhança é a última tentativa e vem ORDENADA: quem chama pode olhar só o
    # primeiro, mas continua enxergando que houve mais de um quase-acerto.
    acima = sorted(
        ((_semelhanca(alvo, normalize(l.get(key))), l) for l in linhas),
        key=lambda p: p[0],
        reverse=True,
    )
    return [linha for razao, linha in acima if razao >= SIMILARIDADE_MINIMA]


def _semelhanca(alvo: str, nome: str) -> float:
    """O melhor casamento entre o termo e o nome INTEIRO ou uma palavra dele.

    Comparar só com o nome inteiro não acha typo em cartão de nome composto:
    "nubamk" contra "nubank cartao" dá 0,53 (o sufixo pesa), e contra a palavra
    "nubank" dá 0,83. Sem a comparação por palavra este tier era decorativo.
    """
    if not nome:
        return 0.0
    candidatos = [nome, *(p for p in nome.split() if len(p) >= MIN_NOME_EM_TERMO)]
    return max(SequenceMatcher(None, alvo, c).ratio() for c in candidatos)
