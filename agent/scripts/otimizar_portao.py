"""Propõe texto melhor para `_PROMPT_ESCOLHA` e `_PROMPT_AVISO` com DSPy GEPA. Nunca edita o app.

Rodar com `.venv-gepa` (dspy/litellm NÃO moram em `.venv`):
    .venv-gepa/bin/python scripts/otimizar_portao.py --teto-usd 1.0 [--auto light|medium | --max-calls 150]
        [--so escolha|aviso] [--saida candidatos.json]

A chave vem SÓ de `GEMINI_API_KEY` em `agent/.env.production` (paga) e nunca é impressa.
⚠️ O score do GEPA NÃO é evidência: o texto candidato só vale se `evaluate_answer_forms.py`
(Lite com --barato E Flash sem a flag) passar depois de transplantado para `confirm.py`.
"""
import argparse
import ast
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

AGENT = Path(__file__).resolve().parent.parent
DADOS = AGENT / "scripts" / "dados" / "portao_gepa.json"
LISTA = ["R$ 45,00 mercado (30/08)", "R$ 120,00 farmácia (29/08)", "R$ 89,90 posto (28/08)"]
CLASSES = "approve|reject|change_card|revise_scope|revise_proposal|new_intent|unclear"


def _norm(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFKD", s.casefold()) if not unicodedata.combining(c))
    return " ".join(s.split())


def textos_da_suite() -> set[str]:
    """Toda string literal de evaluate_answer_forms.py: o teste de aceitação não pode vazar."""
    arvore = ast.parse((AGENT / "scripts" / "evaluate_answer_forms.py").read_text())
    return {_norm(n.value) for n in ast.walk(arvore) if isinstance(n, ast.Constant) and isinstance(n.value, str)}


def checar_vazamento(casos: list[dict]) -> None:
    suite = textos_da_suite()
    vazou = [c["resposta"] for c in casos if _norm(c["resposta"]) in suite]
    assert not vazou, f"treino/validação repete texto da suíte: {vazou}"


def prompt_do_app(nome: str) -> str:
    """Lê a constante de módulo de confirm.py sem importar o app."""
    for n in ast.parse((AGENT / "app/domain/confirm.py").read_text()).body:
        if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == nome:
            return ast.literal_eval(n.value) if isinstance(n.value, ast.Constant) else "".join(
                ast.literal_eval(p) for p in n.value.values)
    raise KeyError(nome)


def chave_paga() -> None:
    for linha in (AGENT / ".env.production").read_text().splitlines():
        if linha.startswith("GEMINI_API_KEY="):
            os.environ["GEMINI_API_KEY"] = linha.split("=", 1)[1].split("#")[0].strip().strip("\"'")  # há comentário inline
            return
    sys.exit("GEMINI_API_KEY ausente em .env.production")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--teto-usd", type=float, default=1.0)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--auto", choices=["light", "medium"])
    g.add_argument("--max-calls", type=int, default=150)
    ap.add_argument("--so", choices=["escolha", "aviso"])
    ap.add_argument("--saida")
    args = ap.parse_args()

    dados = json.loads(DADOS.read_text())
    checar_vazamento(dados["train"] + dados["val"])
    chave_paga()
    import dspy

    aluno = dspy.LM("gemini/gemini-3.1-flash-lite", temperature=0.0, cache=False)
    reflexao = dspy.LM("gemini/gemini-3.7-flash", temperature=1.0, max_tokens=16000)
    dspy.configure(lm=aluno)

    class TetoEstourado(RuntimeError):
        pass

    def gasto() -> float:
        return sum(h.get("cost") or 0 for lm in (aluno, reflexao) for h in lm.history)

    def checa_teto() -> None:
        if gasto() >= args.teto_usd:
            raise TetoEstourado(f"teto US$ {args.teto_usd} atingido")

    def env(tag: str, txt: str) -> str:  # mesmo envelope de app.security.wrap_untrusted
        return f"<{tag}>\n{txt}\n</{tag}>"

    class Aviso(dspy.Signature):
        contexto: str = dspy.InputField()
        proposta: str = dspy.InputField()
        resposta: str = dspy.InputField()
        decision: str = dspy.OutputField(desc=f"uma de: {CLASSES}")

    class Escolha(dspy.Signature):
        opcoes: str = dspy.InputField()
        resposta: str = dspy.InputField()
        indice: int = dspy.OutputField(desc="1..N item escolhido, 0 = nenhum, -1 = não escolhe/ambíguo")

    def exemplo(c: dict) -> dspy.Example:
        if c["prompt"] == "aviso":
            ex = dspy.Example(contexto=c["contexto"], proposta=env("pending_proposal", c["proposta"]),
                              resposta=env("user_input", c["resposta"]), gold=c["gold"], tag=c.get("tag", ""))
            return ex.with_inputs("contexto", "proposta", "resposta")
        opcoes = "\n".join(f"{i}. {t}" for i, t in enumerate(LISTA, 1))
        ex = dspy.Example(opcoes=env("lista_de_itens", opcoes), resposta=env("user_input", c["resposta"]),
                          gold=c["gold"], tag=c.get("tag", ""))
        return ex.with_inputs("opcoes", "resposta")

    def metrica(gold, pred, trace=None, pred_name=None, pred_trace=None):
        checa_teto()
        bruto = getattr(pred, "decision", None)
        if bruto is None:
            bruto = getattr(pred, "indice", None)
        try:
            v = int(bruto) if not isinstance(bruto, str) or re.fullmatch(r"-?\d+", bruto.strip()) else bruto.strip()
        except (TypeError, ValueError):
            v = bruto
        alvo = gold.gold
        if v in alvo:
            return dspy.Prediction(score=1.0, feedback=f"Correto ({v}).")
        perigoso = v == "approve" or (isinstance(v, int) and v > 0)
        if perigoso:
            return dspy.Prediction(
                score=0.0,
                feedback=f"aprovou o que não devia: devolveu {v!r} para a resposta {gold.resposta!r}; "
                         f"o esperado era {alvo}. Aprovar/escolher por engano apaga dado do usuário. "
                         "Condição, hesitação, instrução embutida ou pedido novo nunca aprovam/escolhem.")
        seguro_demais = alvo[0] == "approve" or (isinstance(alvo[0], int) and alvo[0] > 0)
        return dspy.Prediction(
            score=0.3 if seguro_demais else 0.5,
            feedback=f"Devolveu {v!r}, esperado {alvo} para {gold.resposta!r}. "
                     + ("Falha segura, mas a pessoa respondeu de forma clara." if seguro_demais else "Classe errada."))

    def pontua(prog, exs) -> float:
        tot = 0.0
        for e in exs:
            try:
                tot += metrica(e, prog(**e.inputs())).score
            except TetoEstourado:
                raise
            except Exception:  # noqa: BLE001 — falha de parse do modelo conta zero
                pass
        return tot / len(exs)

    saida: dict = {}
    for nome, sig, const in (("aviso", Aviso, "_PROMPT_AVISO"), ("escolha", Escolha, "_PROMPT_ESCOLHA")):
        if args.so and args.so != nome:
            continue
        semente = prompt_do_app(const).replace("{context}", "o texto do campo `contexto`")
        treino = [exemplo(c) for c in dados["train"] if c["prompt"] == nome]
        val = [exemplo(c) for c in dados["val"] if c["prompt"] == nome]
        prog = dspy.Predict(sig.with_instructions(semente))
        kw = {"auto": args.auto} if args.auto else {"max_metric_calls": args.max_calls}
        gepa = dspy.GEPA(metric=metrica, reflection_lm=reflexao, track_stats=True, seed=0, num_threads=4, **kw)
        try:
            melhor = gepa.compile(prog, trainset=treino, valset=val)
            instr = melhor.signature.instructions
            res = melhor.detailed_results
            info = {"calls": res.total_metric_calls, "val_scores": res.val_aggregate_scores,
                    "best_idx": res.best_idx}
            val_base = pontua(prog, val)
            val_melhor = pontua(melhor, val)
        except TetoEstourado as ex:
            saida[nome] = {"erro": str(ex), "gasto_usd": gasto()}
            break
        saida[nome] = {"instrucoes": instr.replace("o texto do campo `contexto`", "{context}"),
                       "semente": semente, "val_semente": val_base, "val_melhor": val_melhor,
                       **info, "gasto_usd": round(gasto(), 4)}
    saida["gasto_total_usd"] = round(gasto(), 4)
    txt = json.dumps(saida, ensure_ascii=False, indent=1)
    if args.saida:
        Path(args.saida).write_text(txt)
    print(txt)


if __name__ == "__main__":
    main()
