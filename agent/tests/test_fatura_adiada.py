"""Fatura `rolled` não é fatura aberta — verificado mecanicamente.

A migration `20260911040000` criou o status `rolled`: a fatura vencida cujo saldo
foi para a próxima (o rotativo). Ela não foi paga, mas o dinheiro já mudou de
fatura, e o cron `_roll_overdue_invoices` cria essas linhas sozinho de hora em
hora para todo cartão com `rotativo_auto`.

O cabeçalho daquela migration conta o erro que isso causa e diz "São 15
ocorrências em 9 funções, e as 15 estão abaixo". A conta foi feita **só no SQL**.
O agente tinha quatro queries próprias em `card_invoices`, todas com
`status <> 'paid'`, e nenhuma entrou nessa conta:

* `pay_invoice` escolhia a fatura adiada como alvo e a RPC devolvia
  "fatura já paga em <null>" — exceção crua na cara do usuário;
* `_quitar_fatura` respondia "✅ quitados sem sair do caixa" para uma fatura que
  ninguém pagou, porque `settle_invoice` é idempotente e volta cedo;
* `verificar_limite_disponivel` somava a origem E o principal já migrado —
  o mesmo dinheiro duas vezes, comendo limite que existe;
* o resolver `faturas` oferecia fatura já adiada na pergunta "qual delas?".

Este teste varre o DIRETÓRIO, não uma lista dos quatro: o defeito não é as
quatro linhas, é a facilidade de escrever a quinta.
"""

import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parents[1] / "app"

# Qualquer comparação com o status de uma fatura, em SQL nosso.
_STATUS = re.compile(r"(?:ci|card_invoices|inv)\.status\s*(<>|!=|=|not\s+in|in)\s*([^\n]*)", re.IGNORECASE)


def _arquivos():
    return sorted(p for p in RAIZ.rglob("*.py") if "__pycache__" not in str(p))


def test_nenhum_filtro_de_fatura_trata_rolled_como_aberta():
    suspeitos = []
    for arquivo in _arquivos():
        texto = arquivo.read_text()
        for n, linha in enumerate(texto.splitlines(), 1):
            m = _STATUS.search(linha)
            if not m:
                continue
            operador, alvo = m.group(1).lower(), m.group(2)
            # `<> 'paid'` e `!= 'paid'` incluem 'rolled' — é exatamente o defeito.
            if operador in {"<>", "!="} and "paid" in alvo and "rolled" not in alvo:
                suspeitos.append(f"{arquivo.relative_to(RAIZ.parent)}:{n}: {linha.strip()[:100]}")
            # `in ('open','closed')` está certo; `not in (...)` precisa citar rolled.
            elif operador.replace(" ", "") == "notin" and "paid" in alvo and "rolled" not in alvo:
                suspeitos.append(f"{arquivo.relative_to(RAIZ.parent)}:{n}: {linha.strip()[:100]}")

    assert not suspeitos, (
        "fatura adiada ('rolled') sendo tratada como aberta — use FATURA_ABERTA de app.tools.base:\n  "
        + "\n  ".join(suspeitos)
    )


def test_a_constante_existe_e_exclui_os_dois_status():
    from app.tools.base import FATURA_ABERTA

    assert "paid" in FATURA_ABERTA and "rolled" in FATURA_ABERTA
    # Ela é interpolada em f-string de SQL: precisa ser um predicado, não um valor.
    assert FATURA_ABERTA.strip().lower().startswith("status")


def test_as_quatro_queries_de_fatura_usam_a_constante():
    """As quatro que o rotativo pegou desprevenidas continuam lendo da constante.

    O teste de varredura acima não as veria se alguém trocasse a interpolação por
    um literal correto — este prende a fonte única, que é o que impede a quinta
    cópia de nascer com o filtro de novo escrito à mão.
    """
    usos = 0
    for arquivo in _arquivos():
        usos += arquivo.read_text().count("{FATURA_ABERTA}")
    assert usos >= 2, f"esperava as queries de fatura interpolando FATURA_ABERTA, achei {usos}"
