"""A rotação de segredos não pode destruir a versão mais nova.

Bug de 31/08/2026, que só aparece a partir da DÉCIMA versão: o script listava as
versões com `--sort-by='~name'`, e `name` é STRING — então "9" ordena depois de
"11". O script preservava a 9 e destruía a 11, que era a recém-criada.

O sintoma foi cruel: `gcloud run deploy` saía com código 0, a revisão nova era
criada, e ela NÃO subia ("Secret Version ... is in DESTROYED state"). O tráfego
ficava na revisão antiga e o deploy parecia ter funcionado.
"""

import pathlib
import re

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "setup-gcp.sh"


def test_versoes_de_segredo_sao_ordenadas_por_tempo_e_nao_por_nome():
    texto = SCRIPT.read_text()
    assert "--sort-by='~name'" not in texto, (
        "`~name` ordena versão de segredo como STRING: a partir da 10ª, "
        "'9' vem depois de '11' e o script destrói a versão recém-criada."
    )
    assert "--sort-by='~createTime'" in texto


def test_ordenar_por_nome_realmente_inverte_a_partir_da_decima():
    """Prova o mecanismo, para ninguém 'simplificar' de volta."""
    versoes = [str(n) for n in range(1, 12)]
    por_string = sorted(versoes, reverse=True)
    assert por_string[0] == "9", por_string      # a mais nova NÃO fica em primeiro
    assert "11" in por_string[1:], "a 11 cairia na lista de destruição"
