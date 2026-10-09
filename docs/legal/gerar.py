#!/usr/bin/env python3
"""Gera agent/app/static/legal/*.html a partir de docs/legal/*.md (md mínimo: #, ##, -, tabela, **, links).

Uso: python3 docs/legal/gerar.py   (rode depois de editar um .md e commite o HTML)
"""
import html
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
SAIDA = RAIZ.parent.parent / "agent/app/static/legal"
CSS = (
    ":root{color-scheme:light dark}body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:46rem;"
    "margin:0 auto;padding:1.25rem;background:#fff;color:#1c1c1e}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:2rem}"
    "a{color:#0a58ca}table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{border:1px solid #8884;padding:.4rem;text-align:left;vertical-align:top}"
    "@media(prefers-color-scheme:dark){body{background:#111;color:#f2f2f7}a{color:#6ea8fe}}"
)


def inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    return re.sub(r"\[([^\]]+)\]\((/[a-z-]+)\)", r'<a href="\2">\1</a>', t)


def converte(md: str) -> tuple[str, str]:
    out, titulo, lista, tab = [], "", False, False
    for ln in md.splitlines() + [""]:
        if lista and not ln.startswith("- "):
            out.append("</ul>"); lista = False
        if tab and not ln.startswith("|"):
            out.append("</table>"); tab = False
        if ln.startswith("# "):
            titulo = ln[2:]; out.append(f"<h1>{inline(titulo)}</h1>")
        elif ln.startswith("## "):
            out.append(f"<h2>{inline(ln[3:])}</h2>")
        elif ln.startswith("- "):
            if not lista:
                out.append("<ul>"); lista = True
            out.append(f"<li>{inline(ln[2:])}</li>")
        elif ln.startswith("|"):
            cel = [c.strip() for c in ln.strip("|").split("|")]
            if set("".join(cel)) <= set("-"):
                continue
            if not tab:
                out.append("<table>"); tab = True; tag = "th"
            else:
                tag = "td"
            out.append("<tr>" + "".join(f"<{tag}>{inline(c)}</{tag}>" for c in cel) + "</tr>")
        elif re.match(r"\d+\. ", ln):
            out.append(f"<p>{inline(ln)}</p>")
        elif ln.strip():
            out.append(f"<p>{inline(ln)}</p>")
    return titulo, "\n".join(out)


for md in RAIZ.glob("*.md"):
    titulo, corpo = converte(md.read_text(encoding="utf-8"))
    pagina = (
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(titulo)}</title><style>{CSS}</style></head><body>\n{corpo}\n</body></html>\n"
    )
    (SAIDA / f"{md.stem}.html").write_text(pagina, encoding="utf-8")
    print(md.stem)
