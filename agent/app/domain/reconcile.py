"""Conciliação do extrato com o que já está no app — pura, sem I/O.

Pedido do dono do produto (22/09/2026): *"comparar de forma bem robusta, com várias camadas
comparativas... se uma camada falar que não, comparar com a outra e assim por diante, até ter
certeza que realmente não tem no app"*. Plano: `docs/superpowers/plans/2026-09-22-importacao-inteligente.md`.

## A cascata

Cada camada só olha o que as anteriores NÃO resolveram, e cada lançamento do app é reivindicado
por UM item só — dois cafés de R$ 12 no mesmo dia no extrato precisam de dois cafés no app para
serem "já lançados"; havendo um, o segundo é novo.

| camada | casa quando |
|---|---|
| `arquivo` | o id do banco (FITID) já foi importado antes e o lançamento ainda existe |
| `identico` | mesmo sentido, valor, dia e nome |
| `parcela` | "Parcela k/N" ↔ a parcela k de uma compra de N no app |
| `saldo_anterior` | a linha é o saldo que o app já adiou para esta fatura (`roll_invoice`) |
| `transferencia` | pagamento de fatura / transferência que o app já registrou entre as contas |
| `perto` | mesmo valor e sentido, até 3 dias — um só candidato, ou um claramente mais parecido |
| `nome` | nome parecido, valor igual (ou 1%), até 10 dias |
| `talvez` | sobrou candidato de mesmo valor em 10 dias, ou empate: NÃO decide, pergunta |

⚠️ **Na dúvida, pergunta** (`agent.md`): empate nunca vira escolha nossa. `talvez` sai desmarcado
com o candidato ao lado, e quem decide é a pessoa.

⚠️ O nome é PISTA, nunca veto: o extrato escreve "Openai *Chatgpt Subscr" e o app "ChatGPT". A
semelhança por palavra (contida / Dice) cobre isso; o valor igual é o que sustenta o casamento.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher

from app.domain.matching import normalize

JANELA_PERTO = 3
JANELA_NOME = 10
JANELA_PARCELA = 62
JANELA_TRANSFERENCIA = 5
JANELA_SALDO = 40
JANELA_ADOCAO = 10
NOME_PARECIDO = 0.72
NOME_DESEMPATE = 0.5
MARGEM_DESEMPATE = 0.2

# Palavras que QUALQUER extrato repete — pesam zero na semelhança de nome (não decidem nada: o
# valor igual continua obrigatório). Sem isto, "Pix no Crédito - X" e "Pix no Crédito - Y"
# pareciam o mesmo lançamento.
_VAZIAS = {
    "pix", "no", "na", "de", "do", "da", "dos", "das", "em", "e", "o", "a", "com", "credito",
    "debito", "compra", "pagamento", "transferencia", "enviada", "enviado", "recebida",
    "recebido", "pelo", "pela", "parcela", "ltda", "sa", "me", "eireli", "br",
}

_PARCELA = [
    re.compile(r"(?:^|[\s\-–(])parc(?:ela)?\.?\s*(\d{1,2})\s*(?:/|de)\s*(\d{1,2})\)?\s*$", re.I),
    re.compile(r"\((\d{1,2})\s*/\s*(\d{1,2})\)\s*$"),
    re.compile(r"(?:^|\s)(\d{1,2})\s*/\s*(\d{1,2})\s*$"),
    re.compile(r"(?:^|\s)(\d{1,2})\s+de\s+(\d{1,2})\s*$", re.I),
]


def parse_parcela(descricao: str | None) -> tuple[str, int, int] | None:
    """`"Luizroberto - Parcela 2/12"` → `("Luizroberto", 2, 12)`. ESTRUTURA, não sentido.

    Só aceita o número no FIM do nome e `1 ≤ k ≤ N`, `2 ≤ N ≤ 72` (a régua de
    `installment_plans`): "Mercado 24/7" não é parcela porque 24 > 7, e "Pagamento 1/1" não é
    compra parcelada.
    """
    texto = (descricao or "").strip()
    for padrao in _PARCELA:
        m = padrao.search(texto)
        if not m:
            continue
        k, n = int(m.group(1)), int(m.group(2))
        if not (1 <= k <= n and 2 <= n <= 72):
            return None
        nome = texto[: m.start()].strip(" -–:(")
        return (nome or texto, k, n)
    return None


def add_months(d: date, meses: int) -> date:
    """Mesma régua de `private.add_months`: dia 31 em mês curto cai no último dia."""
    total = d.year * 12 + (d.month - 1) + meses
    ano, mes = divmod(total, 12)
    mes += 1
    for dia in (d.day, 30, 29, 28):
        try:
            return date(ano, mes, dia)
        except ValueError:
            continue
    raise ValueError(d)


def _palavras(texto: str | None) -> list[str]:
    """As palavras que distinguem um lançamento, na ordem, sem o sufixo de parcela."""
    base = parse_parcela(texto)
    limpo = normalize(base[0] if base else texto)
    return [p for p in limpo.split() if len(p) >= 3 and p not in _VAZIAS]


def semelhanca(a: str | None, b: str | None) -> float:
    """0..1. O maior de três olhares, porque extrato e pessoa escrevem o mesmo nome diferente.

    - texto inteiro (typo, pontuação);
    - Dice das palavras que importam;
    - CONTIDO: todas as palavras do nome mais curto aparecem no mais longo ("ChatGPT" dentro de
      "Openai *Chatgpt Subscr") — exige 5+ letras somadas, senão "Uber" casaria "Uber Eats".
    """
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    la, lb = _palavras(a), _palavras(b)
    pa, pb = set(la), set(lb)
    # O texto inteiro compara só as palavras que importam: com "Pix no Crédito - " na frente dos
    # dois, a razão pelo texto cru dava 0,72 para duas pessoas diferentes.
    notas = [SequenceMatcher(None, " ".join(la) or na, " ".join(lb) or nb).ratio()]
    if pa and pb:
        notas.append(2 * len(pa & pb) / (len(pa) + len(pb)))
        menor, maior = (pa, pb) if len(pa) <= len(pb) else (pb, pa)
        if menor <= maior and sum(len(p) for p in menor) >= 5:
            notas.append(0.9)
    return max(notas)


@dataclass
class Item:
    idx: int
    kind: str  # expense | income (do ponto de vista da conta do lote)
    amount_cents: int
    occurred_at: date
    description: str
    external_id: str | None = None


@dataclass
class Existente:
    id: str
    kind: str  # expense | income | transfer
    amount_cents: int
    occurred_at: date
    description: str | None = None
    merchant: str | None = None
    account_id: str | None = None
    counterparty_account_id: str | None = None
    installment_plan_id: str | None = None
    installment_no: int | None = None
    plan_installments: int | None = None
    rollover: bool = False


@dataclass
class Veredito:
    idx: int
    status: str  # novo | duplicate | near_match | uncertain
    camada: str | None = None
    transaction_id: str | None = None
    nota: str | None = None
    parcela: tuple[int, int] | None = None
    # Parcelas ANTERIORES à do arquivo que já existem no app como linha solta: a posição j-1 tem
    # o id da parcela j, ou None (será criada). Só em item novo e parcelado.
    adotar: list[str | None] = field(default_factory=list)


def _dias(a: date, b: date) -> int:
    return abs((a - b).days)


def _brl(cents: int) -> str:
    inteiro, centavos = divmod(abs(cents), 100)
    return f"R$ {inteiro:,}".replace(",", ".") + f",{centavos:02d}"


def _data(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def conciliar(
    itens: list[Item],
    existentes: list[Existente],
    *,
    conta_id: str,
    cartao: bool,
    ja_importados: dict[str, str] | None = None,
    reservadas: set[str] | None = None,
) -> list[Veredito]:
    """Um veredito por item, na ordem dos itens.

    `ja_importados`: `external_id` → id do lançamento que um lote ANTERIOR criou (e que ainda
    existe). `reservadas`: lançamentos que outro lote em revisão já oferece como "data diferente"
    — o índice parcial `import_items_near_match_unico` recusaria o segundo.
    """
    ja_importados = ja_importados or {}
    reservadas = reservadas or set()
    vereditos: dict[int, Veredito] = {}
    tomados: set[str] = set()
    parcelas = {i.idx: parse_parcela(i.description) for i in itens}

    def nome(i: Item, t: Existente) -> float:
        return max(semelhanca(i.description, t.description), semelhanca(i.description, t.merchant))

    def compativel(i: Item, t: Existente) -> bool:
        if t.id in tomados:
            return False
        if t.kind == "transfer":
            return False  # transferência só pela camada própria
        if t.kind != i.kind:
            return False
        if t.account_id not in (None, conta_id):
            return False
        p = parcelas[i.idx]
        if p and t.installment_plan_id and (t.installment_no, t.plan_installments) != (p[1], p[2]):
            return False  # parcela de OUTRO número não é esta, por mais parecido que seja o nome
        return True

    def decide(i: Item, t: Existente, camada: str, nota: str) -> None:
        tomados.add(t.id)
        mesmo_dia = t.occurred_at == i.occurred_at
        status = "duplicate" if mesmo_dia or t.id in reservadas else "near_match"
        p = parcelas[i.idx]
        vereditos[i.idx] = Veredito(
            i.idx, status, camada, t.id, nota, parcela=(p[1], p[2]) if p else None
        )

    def camada(nome_camada: str, candidatos, nota) -> None:
        """Aplica uma camada: pares ordenados pelo mais perto; empate sem desempate fica aberto."""
        abertos = [i for i in itens if i.idx not in vereditos]
        pares = []
        for i in abertos:
            cs = [t for t in existentes if candidatos(i, t)]
            if not cs:
                continue
            if len(cs) > 1:
                notas = sorted(((nome(i, t), t) for t in cs), key=lambda p: p[0], reverse=True)
                if notas[0][0] >= NOME_DESEMPATE and notas[0][0] - notas[1][0] >= MARGEM_DESEMPATE:
                    cs = [notas[0][1]]
                else:
                    continue  # empate: segue para as próximas camadas, e no fim vira `talvez`
            pares.append((_dias(i.occurred_at, cs[0].occurred_at), i, cs[0]))
        for _, i, t in sorted(pares, key=lambda p: (p[0], p[1].idx)):
            if i.idx in vereditos or t.id in tomados:
                continue
            decide(i, t, nome_camada, nota(i, t))

    # 0. o mesmo arquivo (ou a mesma linha num arquivo novo do mesmo período)
    for i in itens:
        tx = ja_importados.get(i.external_id or "")
        if tx and tx not in tomados:
            tomados.add(tx)
            p = parcelas[i.idx]
            vereditos[i.idx] = Veredito(
                i.idx, "duplicate", "arquivo", tx, "já veio num extrato importado antes",
                parcela=(p[1], p[2]) if p else None,
            )

    # 1. idêntico
    camada(
        "identico",
        lambda i, t: compativel(i, t) and t.amount_cents == i.amount_cents
        and t.occurred_at == i.occurred_at and nome(i, t) >= 0.999,
        lambda i, t: "igual no app",
    )

    # 2. parcela k/N da mesma compra
    def e_parcela(i: Item, t: Existente) -> bool:
        p = parcelas[i.idx]
        if not p or not compativel(i, t) or _dias(i.occurred_at, t.occurred_at) > JANELA_PARCELA:
            return False
        _, k, n = p
        if abs(t.amount_cents - i.amount_cents) > n:
            return False
        if t.installment_plan_id:
            return (t.installment_no, t.plan_installments) == (k, n)
        pt = parse_parcela(t.description)
        return bool(pt and (pt[1], pt[2]) == (k, n))

    camada(
        "parcela",
        e_parcela,
        lambda i, t: f"parcela {parcelas[i.idx][1]}/{parcelas[i.idx][2]} da compra no app",
    )

    # 2b. o saldo que o app já adiou para esta fatura (`roll_invoice`)
    camada(
        "saldo_anterior",
        lambda i, t: cartao and i.kind == "expense" and t.rollover and compativel(i, t)
        and t.amount_cents == i.amount_cents and _dias(i.occurred_at, t.occurred_at) <= JANELA_SALDO,
        lambda i, t: "saldo adiado da fatura anterior, já no app",
    )

    # 3. transferência / pagamento de fatura entre as contas
    def e_transferencia(i: Item, t: Existente) -> bool:
        if t.kind != "transfer" or t.id in tomados or t.amount_cents != i.amount_cents:
            return False
        if _dias(i.occurred_at, t.occurred_at) > JANELA_TRANSFERENCIA:
            return False
        # saiu desta conta = débito aqui; entrou nesta conta = crédito aqui
        return (i.kind == "expense" and t.account_id == conta_id) or (
            i.kind == "income" and t.counterparty_account_id == conta_id
        )

    camada(
        "transferencia",
        e_transferencia,
        lambda i, t: "pagamento da fatura já registrado" if cartao else "transferência já registrada",
    )

    # 4. mesmo valor, perto
    camada(
        "perto",
        lambda i, t: compativel(i, t) and t.amount_cents == i.amount_cents
        and _dias(i.occurred_at, t.occurred_at) <= JANELA_PERTO,
        lambda i, t: "mesmo valor"
        + ("" if t.occurred_at == i.occurred_at else f", no app em {_data(t.occurred_at)}"),
    )

    # 5. nome parecido
    def valor_proximo(i: Item, t: Existente) -> bool:
        return abs(t.amount_cents - i.amount_cents) <= max(1, i.amount_cents // 100)

    camada(
        "nome",
        lambda i, t: compativel(i, t) and valor_proximo(i, t)
        and _dias(i.occurred_at, t.occurred_at) <= JANELA_NOME and nome(i, t) >= NOME_PARECIDO,
        lambda i, t: "nome parecido"
        + ("" if t.amount_cents == i.amount_cents else f", no app {_brl(t.amount_cents)}")
        + ("" if t.occurred_at == i.occurred_at else f", em {_data(t.occurred_at)}"),
    )

    # 6. talvez — NÃO reivindica: só aponta o candidato mais provável para a pessoa decidir
    for i in itens:
        if i.idx in vereditos:
            continue
        cs = [
            t for t in existentes
            if compativel(i, t) and valor_proximo(i, t)
            and _dias(i.occurred_at, t.occurred_at) <= JANELA_NOME
        ]
        p = parcelas[i.idx]
        if cs:
            t = min(cs, key=lambda t: (-nome(i, t), _dias(i.occurred_at, t.occurred_at)))
            nota = (
                f"{len(cs)} parecidos no app" if len(cs) > 1
                else f"parecido com {t.description or t.merchant or 'um lançamento'} em {_data(t.occurred_at)}"
            )
            vereditos[i.idx] = Veredito(
                i.idx, "uncertain", "talvez", t.id, nota, parcela=(p[1], p[2]) if p else None
            )
            continue
        vereditos[i.idx] = Veredito(i.idx, "novo", parcela=(p[1], p[2]) if p else None)

    # Parcelas anteriores de uma compra NOVA que já existem soltas no app: adotar, não duplicar.
    for i in itens:
        v = vereditos[i.idx]
        p = parcelas[i.idx]
        if v.status != "novo" or not p or not cartao or i.kind != "expense":
            continue
        _, k, n = p
        for j in range(1, k):
            alvo = add_months(i.occurred_at, -(k - j))
            cs = [
                t for t in existentes
                if compativel(i, t) and not t.installment_plan_id
                and abs(t.amount_cents - i.amount_cents) <= n
                and _dias(alvo, t.occurred_at) <= JANELA_ADOCAO
                and (nome(i, t) >= NOME_DESEMPATE
                     or (parse_parcela(t.description) or ("", 0, 0))[1:] == (j, n))
            ]
            if cs:
                t = min(cs, key=lambda t: (_dias(alvo, t.occurred_at), -nome(i, t)))
                tomados.add(t.id)
                v.adotar.append(t.id)
            else:
                v.adotar.append(None)

    return [vereditos[i.idx] for i in itens]


def natureza_estrutural(
    linhas: list[tuple[str, int, date, str]], *, cartao: bool, titular: str | None
) -> list[str | None]:
    """A rede de quando a IA não responde: só ESTRUTURA, nunca palavra decorada.

    `linhas` = `(kind, cents, dia, descrição)`. Duas regras, ambas só no extrato de CONTA:

    - **entrou e saiu o mesmo valor no mesmo dia** — o "Pix no crédito" do Nubank põe +25 e −25
      na conta; lançados, viram uma receita e um gasto que não existiram. Casamento 1-para-1.
    - **o nome do titular na linha** — transferência para si mesmo. O nome vem do PERFIL (dado da
      pessoa), exige 2+ palavras e todas presentes: "Gabriel" sozinho casaria com qualquer Gabriel.

    Só desmarca por padrão (natureza `transferencia_propria`); a pessoa vê e marca se quiser.
    """
    saida: list[str | None] = [None] * len(linhas)
    if cartao:
        return saida
    abertas: dict[tuple[int, date, str], list[int]] = {}
    for i, (kind, cents, dia, _) in enumerate(linhas):
        oposto = "income" if kind == "expense" else "expense"
        par = abertas.get((cents, dia, oposto))
        if par:
            j = par.pop(0)
            saida[i] = saida[j] = "transferencia_propria"
        else:
            abertas.setdefault((cents, dia, kind), []).append(i)
    nome = [p for p in normalize(titular).split() if len(p) >= 2]
    if len(nome) >= 2:
        for i, (_, _, _, descricao) in enumerate(linhas):
            palavras = set(normalize(descricao).split())
            if saida[i] is None and all(p in palavras for p in nome):
                saida[i] = "transferencia_propria"
    return saida
