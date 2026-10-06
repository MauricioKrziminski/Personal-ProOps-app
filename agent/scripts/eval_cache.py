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
        # `GEMINI_THINKING_<PAPEL>` muda a resposta do modelo sem mudar prompt nem modelo: sem ele
        # na chave, medir o portão em `low` devolvia o resultado do padrão, do cache (06/10/2026).
        from app.services import gemini

        niveis = {p: n for p in gemini.MODELOS if (n := gemini.raciocinio(p))}
        if niveis:
            extra.append({"raciocinio": niveis})
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


class Orcamento:
    """Mede o gasto de uma rodada de avaliação e para no teto (`--teto-usd`).

    Toda chamada ao Gemini passa pelo coletor de `consumo`; aqui cada uma também é somada numa
    lista da RODADA (os scripts abrem turnos por caso, e o turno sozinho perderia a soma). O resumo
    sai no fim — inclusive quando o teto interrompe —, para a chave paga nunca rodar no escuro.
    Modelo sem preço na tabela (`gemini.PRECOS_USD_POR_MILHAO`) é contado à parte, nunca chutado.
    """

    def __init__(self, teto_usd: float | None = None):
        import atexit

        from app.services import consumo

        self.teto = teto_usd
        self.chamadas: list[dict] = []
        original = consumo.ConsumoDoTurno.somar
        rodada = self

        def somar(turno, chamada):
            rodada.chamadas.append(chamada)
            original(turno, chamada)

        consumo.ConsumoDoTurno.somar = somar
        consumo.abrir()  # sem turno aberto o coletor não registra nada
        atexit.register(self.resumo)

    def gasto(self) -> float:
        return sum(c.get("custo_usd") or 0 for c in self.chamadas)

    def checar(self) -> None:
        if self.teto is not None and self.gasto() > self.teto:
            raise SystemExit(f"teto de US$ {self.teto:.2f} atingido (gasto US$ {self.gasto():.4f})")

    def resumo(self) -> None:
        sem_preco = [c for c in self.chamadas if c.get("custo_usd") is None and c.get("input_tokens")]
        entrada = sum(c.get("input_tokens") or 0 for c in self.chamadas)
        saida = sum(c.get("output_tokens") or 0 for c in self.chamadas)
        print(f"\nGasto da rodada: {len(self.chamadas)} chamadas, {entrada} tokens de entrada, "
              f"{saida} de saída, US$ {self.gasto():.4f}"
              + (f" (+{len(sem_preco)} chamadas de modelo sem preço na tabela)" if sem_preco else ""),
              flush=True)
