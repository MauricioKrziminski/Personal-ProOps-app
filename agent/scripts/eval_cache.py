"""Cache dos resultados das suítes de avaliação (Gemini real custa dinheiro e cota).

Chave de cada caso = (id do caso, hash dos prompts e schemas, modelo de cada papel). O hash é o
`gemini.versao_do_prompt` sobre os textos de `graph/prompts.py` (e os prompts de `domain/confirm.py`,
`domain/draft.py` e `tools/atributos.py`) mais o JSON schema de todo modelo Pydantic desses módulos.
Só caso que PASSOU entra: o que falhou roda de novo, sempre.

⚠️ O hash NÃO enxerga código determinístico (`guards`, `policy`, `resolve`, catálogo): mexeu nele,
rode com `--sem-cache`. O cache serve para iterar sem repagar o que prompt e schema não tocaram.
Arquivos em `agent/.eval-cache/` (ignorado pelo git).
"""

from __future__ import annotations

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / ".eval-cache"


def hash_prompts_e_schemas() -> str:
    from pydantic import BaseModel

    from app.domain import confirm, draft
    from app.graph import prompts, schemas
    from app.services import gemini
    from app.tools import atributos

    partes: list[str] = []
    for modulo in (prompts, confirm, draft, atributos, schemas):
        for nome, valor in sorted(vars(modulo).items()):
            if isinstance(valor, str) and len(valor) > 40 and not nome.startswith("__"):
                partes.append(f"{modulo.__name__}.{nome}={valor}")
            elif (isinstance(valor, type) and issubclass(valor, BaseModel)
                  and valor.__module__ == modulo.__name__):
                partes.append(f"{modulo.__name__}.{nome}="
                              + json.dumps(valor.model_json_schema(), sort_keys=True))
    return gemini.versao_do_prompt("\n".join(partes))


def modelos() -> dict[str, str]:
    """Lido DEPOIS de qualquer `GEMINI_MODEL_<PAPEL>` ser definido (ex.: `--barato`)."""
    from app.services import gemini

    return {papel: gemini.modelo(papel) for papel in gemini.MODELOS}


class CacheDeAvaliacao:
    def __init__(self, nome: str, ativo: bool = True):
        self.ativo = ativo
        self.arquivo = PASTA / f"{nome}.json"
        self.hits = 0
        self._sufixo = json.dumps([hash_prompts_e_schemas(), modelos()], sort_keys=True)
        self._dados: dict = {}
        if ativo and self.arquivo.exists():
            try:
                self._dados = json.loads(self.arquivo.read_text())
            except ValueError:
                self._dados = {}  # cache corrompido = cache vazio

    def _chave(self, caso: str) -> str:
        return f"{caso}|{self._sufixo}"

    def tem(self, caso: str) -> bool:
        return self.ativo and self._chave(caso) in self._dados

    def get(self, caso: str) -> dict | None:
        achado = self._dados.get(self._chave(caso)) if self.ativo else None
        self.hits += achado is not None
        return achado

    def put(self, caso: str, valor: dict) -> None:
        """Só chamar com caso que passou."""
        if self.ativo:
            self._dados[self._chave(caso)] = valor

    def salvar(self) -> None:
        if not self.ativo:
            return
        PASTA.mkdir(exist_ok=True)
        # `--barato` e a rodada que aprova têm chaves diferentes e convivem; só se corta o mais
        # antigo quando passa de 5000 (prompt velho não se acumula para sempre).
        dados = dict(list(self._dados.items())[-5000:])
        self.arquivo.write_text(json.dumps(dados, ensure_ascii=False, indent=1, default=str))
