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
