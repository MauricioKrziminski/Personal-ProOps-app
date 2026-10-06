"""Cache da avaliação: reaproveita o que passou e invalida quando prompt, schema ou modelo mudam."""

from app.graph import prompts
from scripts import eval_cache
from scripts.eval_cache import CacheDeAvaliacao


def test_guarda_reaproveita_e_invalida(tmp_path, monkeypatch):
    monkeypatch.setattr(eval_cache, "PASTA", tmp_path)
    c = CacheDeAvaliacao("t")
    assert c.get("caso") is None
    c.put("caso", {"obtido": "ok"})
    c.salvar()

    outro = CacheDeAvaliacao("t")
    assert outro.get("caso") == {"obtido": "ok"} and outro.hits == 1

    # prompt mudou -> chave nova, o caso roda de novo
    monkeypatch.setattr(prompts, "ROUTER", prompts.ROUTER + " mudou")
    assert CacheDeAvaliacao("t").get("caso") is None

    # modelo do papel mudou -> idem
    monkeypatch.undo()
    monkeypatch.setattr(eval_cache, "PASTA", tmp_path)
    monkeypatch.setenv("GEMINI_MODEL_GATE", "outro-modelo")
    assert CacheDeAvaliacao("t").get("caso") is None


def test_sem_cache_nao_le_nem_grava(tmp_path, monkeypatch):
    monkeypatch.setattr(eval_cache, "PASTA", tmp_path)
    c = CacheDeAvaliacao("t", ativo=False)
    c.put("caso", {"obtido": "ok"})
    c.salvar()
    assert not list(tmp_path.iterdir())
    assert c.get("caso") is None


def test_v1_e_v2_tem_chaves_diferentes_e_convivem(tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(eval_cache, "PASTA", tmp_path)
    v1 = CacheDeAvaliacao("t")
    v1.put("caso", {"obtido": "do-v1"})
    v1.salvar()

    monkeypatch.setattr(get_settings(), "agent_prompt_v2", True)
    v2 = CacheDeAvaliacao("t")
    assert v2.get("caso") is None, "resultado do v1 não pode valer para o v2"
    v2.put("caso", {"obtido": "do-v2"})
    v2.salvar()
    assert CacheDeAvaliacao("t").get("caso") == {"obtido": "do-v2"}

    monkeypatch.setattr(get_settings(), "agent_prompt_v2", False)
    assert CacheDeAvaliacao("t").get("caso") == {"obtido": "do-v1"}


def test_editar_o_banco_de_exemplos_invalida_so_o_v2(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.graph import exemplos

    arquivo = tmp_path / "exemplos.json"
    arquivo.write_text(exemplos.ARQUIVO.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(exemplos, "ARQUIVO", arquivo)
    antes_v1 = eval_cache.hash_prompts_e_schemas()
    monkeypatch.setattr(get_settings(), "agent_prompt_v2", True)
    antes_v2 = eval_cache.hash_prompts_e_schemas()

    arquivo.write_text(arquivo.read_text(encoding="utf-8") + " ", encoding="utf-8")
    assert eval_cache.hash_prompts_e_schemas() != antes_v2
    monkeypatch.setattr(get_settings(), "agent_prompt_v2", False)
    assert eval_cache.hash_prompts_e_schemas() == antes_v1


def test_orcamento_soma_toda_chamada_e_para_no_teto(monkeypatch):
    import atexit

    import pytest

    from app.services import consumo
    from scripts.eval_cache import Orcamento

    monkeypatch.setattr(consumo.ConsumoDoTurno, "somar", consumo.ConsumoDoTurno.somar)  # restaura
    monkeypatch.setattr(atexit, "register", lambda *_a, **_k: None)
    orc = Orcamento(teto_usd=0.01)
    consumo.atual().somar({"custo_usd": 0.004, "input_tokens": 10})
    consumo.abrir().somar({"custo_usd": 0.004, "input_tokens": 10})  # outro turno: a rodada soma igual
    orc.checar()  # 0,008 < 0,01
    consumo.atual().somar({"custo_usd": None, "input_tokens": 10})  # sem preço: não chuta
    consumo.atual().somar({"custo_usd": 0.004, "input_tokens": 10})
    assert orc.gasto() == pytest.approx(0.012)
    with pytest.raises(SystemExit):
        orc.checar()
