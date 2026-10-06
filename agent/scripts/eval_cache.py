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

import asyncio
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / ".eval-cache"


def hash_prompts_e_schemas() -> str:
    from pydantic import BaseModel

    from app.domain import confirm, draft
    from app.graph import exemplos, prompts, prompts_v2, schemas
    from app.services import gemini
    from app.tools import atributos

    partes: list[str] = []
    modulos = (prompts, confirm, draft, atributos, schemas)
    if prompt_v2_ligado():
        # v2: os módulos de prompt e o banco de exemplos também decidem o resultado
        modulos += (prompts_v2,)
        partes.append("exemplos=" + exemplos.ARQUIVO.read_text(encoding="utf-8"))
    for modulo in modulos:
        for nome, valor in sorted(vars(modulo).items()):
            if isinstance(valor, str) and len(valor) > 40 and not nome.startswith("__"):
                partes.append(f"{modulo.__name__}.{nome}={valor}")
            elif (isinstance(valor, type) and issubclass(valor, BaseModel)
                  and valor.__module__ == modulo.__name__):
                partes.append(f"{modulo.__name__}.{nome}="
                              + json.dumps(valor.model_json_schema(), sort_keys=True))
    return gemini.versao_do_prompt("\n".join(partes))


def prompt_v2_ligado() -> bool:
    from app.graph import prompts_v2

    return prompts_v2.ligado()


def ligar_prompt_v2() -> None:
    """`--prompt-v2`: liga a flag SÓ nesta execução (o `Settings` é cacheado: limpa e relê o env)."""
    import os

    from app.config import get_settings

    os.environ["AGENT_PROMPT_V2"] = "1"
    get_settings.cache_clear()


def modelos() -> dict[str, str]:
    """Lido DEPOIS de qualquer `GEMINI_MODEL_<PAPEL>` ser definido (ex.: `--barato`)."""
    from app.services import gemini

    return {papel: gemini.modelo(papel) for papel in gemini.MODELOS}


class CacheDeAvaliacao:
    def __init__(self, nome: str, ativo: bool = True):
        self.ativo = ativo
        self.arquivo = PASTA / f"{nome}.json"
        self.hits = 0
        # v1 e v2 têm chaves DIFERENTES e convivem no mesmo arquivo; com a flag desligada a chave
        # é a de antes do v2 existir.
        extra = [{"prompt_v2": True}] if prompt_v2_ligado() else []
        self._sufixo = json.dumps([hash_prompts_e_schemas(), modelos(), *extra], sort_keys=True)
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


TRANSITORIOS = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "DEADLINE")


async def com_paciencia(chamar, tentativas: int = 4, espera_s: float = 30.0):
    """Roda `chamar()` de novo quando o Gemini do nível gratuito está ocupado (503/429).

    Sem isso um pico de demanda vira "falhou" e a suíte mede a fila do Google, não o prompt.
    Só nos SCRIPTS: no app a reserva e a fila já cuidam disso.
    """
    for tentativa in range(tentativas):
        try:
            return await chamar()
        except Exception as erro:  # noqa: BLE001
            if tentativa == tentativas - 1 or not any(t in str(erro) for t in TRANSITORIOS):
                raise
            print(f"    (Gemini ocupado: {str(erro)[:40]}… nova tentativa em {espera_s:.0f}s)", flush=True)
            await asyncio.sleep(espera_s * (tentativa + 1))
