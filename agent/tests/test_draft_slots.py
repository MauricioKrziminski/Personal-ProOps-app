"""O slot que o código pergunta tem que caber no CHECK do banco.

⚠️ **Este defeito já aconteceu duas vezes, e as duas em silêncio.**
`draft_actions.slot` nasceu na `0045` com lista fechada — decisão certa: slot
novo exige código novo para preenchê-lo. O que falha é o outro lado: o código
ganha um slot, ninguém abre a lista, e o turno morre ao GRAVAR a pergunta,
depois de o agente ter entendido a frase. O usuário lê "não consegui processar
essa mensagem" e perde o lançamento.

- `20260911120000` abriu para `description` ("do que se trata?").
- `20260915230000` abriu para `already_paid_count` (compra parcelada retroativa).

Nenhum teste de unidade pegava: o repositório é dublê e dublê aceita qualquer
string. Este compara as duas listas direto na FONTE — o `ast` de `required.py`
contra o CHECK da última migration que o define.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
REQUIRED = RAIZ / "agent" / "app" / "domain" / "required.py"
MIGRATIONS = RAIZ / "supabase" / "migrations"

_CHECK = re.compile(
    r"draft_actions_slot_check\s*\n?\s*check\s*\(\s*slot\s+in\s*\(([^)]*)\)",
    re.I,
)


def slots_do_codigo() -> set[str]:
    """Todo primeiro elemento literal de uma tupla que `faltando` devolve."""
    arvore = ast.parse(REQUIRED.read_text())
    funcao = next(
        n for n in ast.walk(arvore)
        if isinstance(n, ast.FunctionDef) and n.name == "faltando"
    )
    achados = set()
    for no in ast.walk(funcao):
        if isinstance(no, ast.Return) and isinstance(no.value, ast.Tuple):
            primeiro = no.value.elts[0]
            if isinstance(primeiro, ast.Constant) and isinstance(primeiro.value, str):
                achados.add(primeiro.value)
    return achados


def slots_do_banco() -> set[str]:
    """A lista da ÚLTIMA migration que define o CHECK — é ela que vale."""
    for arquivo in sorted(MIGRATIONS.glob("*.sql"), reverse=True):
        achado = _CHECK.search(arquivo.read_text())
        if achado:
            return set(re.findall(r"'([^']+)'", achado.group(1)))
    raise AssertionError("nenhuma migration define draft_actions_slot_check")


def test_todo_slot_perguntado_cabe_no_check_do_banco():
    faltam = slots_do_codigo() - slots_do_banco()
    assert not faltam, (
        f"`faltando()` devolve {sorted(faltam)} e o CHECK não aceita: o turno "
        "morre ao gravar o rascunho, com a frase já entendida. Abra a lista numa "
        "migration nova, como a 20260911120000 e a 20260915230000 fizeram."
    )


def test_o_codigo_sabe_preencher_todo_slot_que_o_banco_aceita():
    """O outro lado: valor no CHECK que ninguém pergunta é lista fechada frouxa.

    Não é crash, é erosão — a lista existe para que um slot novo EXIJA código
    novo, e sobra ali quer dizer que alguém abriu por precaução.
    """
    sobrando = slots_do_banco() - slots_do_codigo()
    assert not sobrando, (
        f"o CHECK aceita {sorted(sobrando)} e `faltando()` nunca devolve: ou o "
        "código sumiu, ou a lista foi aberta sem uso."
    )
