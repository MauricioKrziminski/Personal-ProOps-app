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
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / ".eval-cache"


CHAVES_DO_ENV = ("GEMINI_", "ANTHROPIC_API_KEY", "IA_PROVEDOR")


def carregar_env() -> None:
    """Exporta de `agent/.env` só as chaves de IA (sem sobrescrever o ambiente); o resto fica com o `Settings`."""
    arquivo = RAIZ / ".env"
    for linha in arquivo.read_text().splitlines() if arquivo.exists() else []:
        if linha.startswith(CHAVES_DO_ENV) and "=" in linha:
            chave, valor = linha.split("=", 1)
            valor = valor.split("#")[0].strip().strip('"')
            if valor:  # `IA_PROVEDOR=` vazio no .env não pode ganhar do padrão grátis
                os.environ.setdefault(chave, valor)


def usar_gemini_gratis(gate_producao: bool = False) -> None:
    """Suítes e sondas rodam no Gemini GRATUITO por padrão (o crédito do Claude é de produção).

    `IA_PROVEDOR` já definido pela pessoa vence. `gate_producao` põe SÓ o gate no modelo de
    produção (a rodada que aprova a seção de segurança; pede ANTHROPIC_API_KEY). Chamar ANTES de
    construir qualquer cliente de modelo.
    """
    os.environ.setdefault("IA_PROVEDOR", "gemini")
    if gate_producao:
        from app.services import gemini

        os.environ["GEMINI_MODEL_GATE"] = gemini.MODELOS["gate"]


def modelo_barato() -> str:
    """O modelo do `--barato`: o router da tabela GEMINI (grátis), nunca o Claude de produção."""
    from app.services import gemini

    return gemini.MODELOS_GEMINI["router"]


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


TRANSITORIOS = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "DEADLINE",
                "overloaded", "529", "rate_limit")


async def com_paciencia(chamar, tentativas: int = 4, espera_s: float = 30.0):
    """Roda `chamar()` de novo quando o modelo está ocupado (Gemini 503/429; Claude 529/rate_limit).

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


# ---------------------------------------------------------------------------
# validade da rodada e Langfuse Experiments (opt-in: `--langfuse`)
# ---------------------------------------------------------------------------


def rodada_invalida(sem_cache: int, chamadas: int) -> bool:
    """Caso que rodou de verdade e NENHUMA chamada ao modelo concluiu = a rodada não mediu nada.

    Cota esgotada (429) é engolida dentro dos classificadores do app e vira `None`, que a seção de
    segurança lê como "não aprovou" = passou. Vale para a rodada inteira, não por caso: há caso que
    legitimamente não chama o modelo ("sim", "ok").
    """
    return sem_cache > 0 and chamadas == 0


def checar_validade(sem_cache: int, orcamento: Orcamento) -> bool:
    if not rodada_invalida(sem_cache, len(orcamento.chamadas)):
        return True
    print("\n!!! nenhuma chamada ao modelo concluída — cota/erro; resultado NÃO vale", flush=True)
    return False


def id_do_item(dataset: str, caso: str) -> str:
    """Id estável do item no Langfuse: reenviar o mesmo caso atualiza, nunca duplica."""
    import hashlib

    return hashlib.sha256(f"{dataset}|{caso}".encode()).hexdigest()[:16]


def sha_curto() -> str:
    import subprocess

    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=RAIZ, check=True,
                              capture_output=True, text=True, timeout=5).stdout.strip() or "?"
    except Exception:  # noqa: BLE001 — sem git não impede a avaliação
        return "?"


def nome_da_corrida(*, agora: str, v2: bool, gate: str, raciocinio: dict[str, str],
                    filtro: str | None, sha: str) -> str:
    """O nome carrega o que distingue uma rodada da outra na tela de comparação do Langfuse."""
    partes = [agora, "v2" if v2 else "v1", f"gate={gate}"]
    partes += [f"think-{p}={n}" for p, n in sorted(raciocinio.items())]
    if filtro:
        partes.append(f"filtro={filtro}")
    partes.append(sha)
    return " | ".join(partes)


def cliente_langfuse() -> object:
    """O MESMO cliente do app (com a máscara de dado pessoal); sem chaves, sai com 2 antes de rodar."""
    from app.config import get_settings
    from app.services import telemetry

    s = get_settings()
    if not (s.langfuse_public_key and s.langfuse_secret_key) or telemetry.handler() is None:
        print("--langfuse pede LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY (agent/.env).", flush=True)
        raise SystemExit(2)
    from langfuse import get_client

    return get_client()


def rodar_experimento(*, dataset: str, itens: list[dict], tarefa, filtro: str | None, v2: bool) -> None:
    """Registra a rodada como Experiment sobre o Dataset `dataset` (projeto compartilhado com produção).

    `itens`: [{"caso": id do caso, "input": ..., "esperado": rótulo, "secao": ...}]. `tarefa(caso)` é
    async e devolve {"obtido": str, "ok": bool, "do_cache": bool}. Concorrência 1: o harness é
    sequencial (5 RPM do Flash gratuito). Sai com SystemExit do teto de gasto só depois do flush.
    """
    from datetime import datetime

    from langfuse import Evaluation

    from app.services import gemini

    cliente = cliente_langfuse()
    ids = {id_do_item(dataset, i["caso"]): i["caso"] for i in itens}
    parou: list[BaseException] = []
    try:
        try:
            cliente.get_dataset(dataset)
        except Exception:  # noqa: BLE001 — não existe ainda
            cliente.create_dataset(name=dataset, description="Casos das suítes de avaliação do Gemini")
        for i in itens:
            cliente.create_dataset_item(dataset_name=dataset, id=id_do_item(dataset, i["caso"]),
                                        input=i["input"],
                                        expected_output=i["esperado"], metadata={"secao": i["secao"]})
        alvo = cliente.get_dataset(dataset)
        alvo.items = [i for i in alvo.items if i.id in ids]

        niveis = {p: n for p in gemini.MODELOS if (n := gemini.raciocinio(p))}
        meta = {"prompt": "v2" if v2 else "v1", "gate": gemini.modelo("gate"), "raciocinio": niveis,
                "filtro": filtro or "", "git": sha_curto(), "modelos": modelos()}
        nome = nome_da_corrida(agora=datetime.now().strftime("%Y-%m-%d %H:%M"), v2=v2,
                               gate=meta["gate"], raciocinio=niveis, filtro=filtro, sha=meta["git"])

        async def task(*, item, **_):
            if parou:
                raise RuntimeError("teto de gasto atingido")
            try:
                return await tarefa(ids[item.id])
            except SystemExit as fim:  # a thread do SDK só captura Exception
                parou.append(fim)
                raise RuntimeError(str(fim)) from fim

        def passou(*, output, **_):
            return [
                Evaluation(name="passou", value=bool(output["ok"]), data_type="BOOLEAN",
                           comment=str(output["obtido"])[:300]),
                Evaluation(name="do_cache", value=bool(output["do_cache"]), data_type="BOOLEAN"),
            ]

        resultado = alvo.run_experiment(
            name=dataset, run_name=nome, description=f"{dataset} — {nome}", task=task,
            evaluators=[passou], max_concurrency=1, metadata=meta)
        print(f"\nLangfuse: {nome}", flush=True)
        if resultado.dataset_run_url:
            print(f"Langfuse: {resultado.dataset_run_url}", flush=True)
    finally:
        cliente.flush()
    if parou:
        raise parou[0]
