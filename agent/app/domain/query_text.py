"""O texto da resposta de consulta — **template Python, sem modelo nenhum.**

⚠️ **Isto já foi uma SEGUNDA chamada de LLM, e era proibido desde sempre.** `ai-gemini.md`:
*"Sem segunda chamada de LLM para formatar resposta de consulta — a saída do WhatsApp é template
Python puro. Um modelo escrevendo 'você gastou aproximadamente' em cima de um valor exato é
alucinação com custo extra."* O código pedia ao Gemini para redigir o texto por cima de números
que o banco já tinha dado prontos, e o template abaixo existia só como rede para quando o modelo
falhava — ou seja, a versão correta estava lá o tempo todo, atrás de um `try`.

Mora em `domain/` e não em `services/gemini.py` de propósito: dentro do cliente do modelo, a
próxima pessoa que precisar de "um texto melhor" acrescenta uma chamada de novo. Aqui não há o
que chamar.

Efeito colateral bom: **nada deste caminho chega a um modelo.** A descrição de um lançamento vem
por importação de extrato, ou seja, é texto escolhido por TERCEIRO (quem manda o Pix escreve a
mensagem) — e enquanto ele ia para o prompt precisava de envelope e de limpeza folha a folha
para não virar injeção. Sem modelo no caminho, a superfície some em vez de ser defendida.
"""

def format_query_response(data: dict) -> str:
    lancamentos = data.get("lancamentos") or []
    periodo = data.get("periodo") or {}
    de = periodo.get("de_br") or periodo.get("de") or ""
    ate = periodo.get("ate_br") or periodo.get("ate") or ""
    conta = data.get("filtro_conta")
    conta_txt = f" no *{conta}*" if conta else ""

    if not lancamentos:
        return f"📊 Nenhum lançamento encontrado{conta_txt} no período ({de} a {ate})."

    total_gasto = data.get("total_gastos_centavos") or 0
    total_receita = data.get("total_receitas_centavos") or 0

    from app.domain.money import cents_to_brl
    header_parts = []
    if total_gasto:
        header_parts.append(f"Gastos: *{cents_to_brl(total_gasto)}*")
    if total_receita:
        header_parts.append(f"Receitas: *{cents_to_brl(total_receita)}*")
    header = " | ".join(header_parts) or f"Total: *{cents_to_brl(total_gasto)}*"

    linhas = []
    for l in lancamentos:
        desc = l.get("description") or l.get("category_name") or "Lançamento"
        val = l.get("amount_brl") or cents_to_brl(l.get("amount_cents") or 0)
        parc = f" ({l['installment_label']})" if l.get("installment_label") else ""
        emoji = "💸" if l.get("kind") == "expense" else "💰"
        data_str = f"{l['occurred_at']} - " if l.get("occurred_at") else ""
        linhas.append(f"  • {emoji} {data_str}{desc}: *{val}*{parc}")

    resumo = data.get("resumo_ocultos")
    if resumo and resumo.get("quantidade_oculta", 0) > 0:
        qtd = resumo["quantidade_oculta"]
        val_oculto = cents_to_brl(resumo.get("total_gastos_ocultos_centavos", 0))
        linhas.append(f"\n📌 *Além dessas, você tem outras {qtd} compras neste período que totalizam {val_oculto}.*")

    if data.get("is_expanded_view"):
        titulo = f"💳 Lançamentos - {conta} (Lista Expandida)" if conta else "💳 Lançamentos (Lista Expandida)"
    else:
        titulo = "📊"
    return f"{titulo} {de} a {ate}{conta_txt} — {header}\n" + "\n".join(linhas)
