"""Lembrete: o canal e o lançamento a que ele se liga (16/10/2026). Puro, sem banco.

Canal não dito vale o do Perfil (`canal_do_perfil`), e o dito vence. Lembrete que cita uma conta que existe
pergunta "ligado ou solto?": quem acha os candidatos é `tools.notes.lancamentos_do_lembrete`, e quem diz se um
nome casa com o pedido é `casa_com_lembrete`.
"""

from __future__ import annotations

import re

from app.domain.atributos import _negado, _tem_pista
from app.domain.matching import normalize

CANAIS = ("push", "whatsapp", "both")
ROTULO_DO_CANAL = {"push": "notificação no app", "whatsapp": "WhatsApp", "both": "notificação no app e WhatsApp"}
ROTULO_CURTO_DO_CANAL = {"push": "app", "whatsapp": "WhatsApp", "both": "app e WhatsApp"}  # linha de lista

# Só no casamento pelo TEXTO do lembrete: "lembrar das crianças" não é a conta "DAS". Pelo nome que o modelo
# tirou da frase (`search_term`), "o DAS" casa.
_PALAVRAS_SOLTAS = {"a", "o", "as", "os", "de", "da", "do", "das", "dos", "na", "no", "nas", "nos", "em", "um",
                    "uma", "e", "pra", "para", "com", "por", "que", "conta", "pagar", "lembrete"}


def canal_dito(canal: str | None) -> str | None:
    c = (canal or "").strip().lower()
    return c if c in CANAIS else None


def canal_do_perfil(push: bool, whatsapp: bool) -> str:
    """Só um ligado vale ele; os dois, ou nenhum, valem os dois (pedido do dono do produto, 16/10/2026)."""
    if push and not whatsapp:
        return "push"
    if whatsapp and not push:
        return "whatsapp"
    return "both"


def _contem(texto: str, nome: str) -> bool:
    return bool(re.search(rf"(^| ){re.escape(nome)}( |$)", texto))


def casa_com_lembrete(nome: str | None, termo: str | None, conteudo: str | None) -> bool:
    """O nome do lançamento é o que o lembrete cita? Pelo termo dito, contido nos dois sentidos (palavra
    inteira); sem termo, o nome inteiro dentro do texto do lembrete, nunca uma palavra solta."""
    n = normalize(nome)
    if not n:
        return False
    t = normalize(termo)
    if t:
        return n == t or _contem(n, t) or _contem(t, n)
    if n in _PALAVRAS_SOLTAS:
        # "pagar o DAS": a sigla escrita como no cadastro (com maiúscula) é a conta; "das crianças" não
        cru = (nome or "").strip()
        return cru != cru.lower() and bool(re.search(rf"(?<!\w){re.escape(cru)}(?!\w)", conteudo or ""))
    return _contem(normalize(conteudo), n)


def vinculo_ancorado(vinculo: str | None, texto: str | None) -> str | None:
    """O "ligado"/"solto" que o modelo propôs só vale se a frase o sustenta (a ancoragem da forma de pagamento): o
    Lite deduzia "ligado" de "me lembra de pagar o DAS" e a pergunta que a pessoa quer sumia. Sem pista, None, e o
    sistema PERGUNTA — o erro possível é perguntar a mais, nunca ligar ou soltar por ela."""
    texto = texto or ""
    negado = _negado(texto, ("vincul", "lig"))
    if vinculo == "solto":
        return vinculo if negado or _tem_pista(texto, ("solt", "avuls", "separad", "independ")) else None
    if vinculo == "lancamento":
        return vinculo if not negado and _tem_pista(texto, ("vincul", "ligad", "lancamento", "associ", "atrel")) else None
    return None


def frase_dos_dias(dias: int) -> str:
    """Quando o lembrete ligado toca, relativo ao vencimento."""
    if dias <= 0:
        return "no dia do vencimento"
    return "1 dia antes do vencimento" if dias == 1 else f"{dias} dias antes do vencimento"
