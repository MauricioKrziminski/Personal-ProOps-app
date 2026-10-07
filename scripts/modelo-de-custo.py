"""Modelo de custo por usuário e margem por plano — `docs/CUSTOS-E-PRECOS.md`.

Rodar: `python3 scripts/modelo-de-custo.py`. Todo número de preço é premissa escrita aqui;
mudou o preço de um fornecedor, muda a linha e roda de novo.
"""

FX = 6.20                    # R$/US$ pessimista: a fatura do GCP converteu a 5,93 + IOF 3,5%
WA = 0.0068 * FX             # mensagem entregue no Brasil (service = utility = authentication), Meta 01/10/2026
RUN = 0.0002 * FX            # Cloud Run por turno (estimado; o fixo do cron é outra linha)
AUDIO = 0.3 * (60 / 3600 * 0.04) * FX   # 30% dos turnos com 1 min de áudio no whisper-large-v3-turbo
LOJA = 0.15                  # Google 15% em assinatura; Apple Brasil 10% (SBP) + 5% do IAP


def ia(modelo: str, pior: bool) -> float:
    """R$ de IA por turno."""
    if modelo == "haiku":
        # router + parse: ~2.700 tokens de entrada cada (+30% do tokenizer novo), ~250 de saída
        # com raciocínio; o portão (gate) em 30% dos turnos. US$ 0,10 / 0,50 por 1M.
        base = (2 * 2700 * 1.3 * 0.10 + 2 * 250 * 0.50) / 1e6 + 0.3 * (2600 * 0.10 + 400 * 0.50) / 1e6
        return (base * 1.2 if pior else base * 0.55) * FX   # pior: imagem/retentativa; real: cache
    # gemini: US$ 0,00113 medido em produção; pior: gate no Flash ao preço de 01/01/2027
    return ((0.00113 + 0.3 * 0.0045) * 1.2 if pior else 0.00113) * FX


def turno(canal: str, modelo: str = "haiku", pior: bool = True) -> float:
    c = ia(modelo, pior) + RUN + AUDIO
    if canal == "wa":
        c += (1.5 if pior else 1.2) * WA   # respostas entregues por turno (pergunta + resultado do SIM)
    return c


# O limite do WhatsApp conta RESPOSTAS ENVIADAS, não turnos: é a unidade que a Meta cobra, e
# inclui o que não vira turno de IA (clique no SIM, saudação, "limite acabou").
TIPICO_TURNOS, TIPICO_RESPOSTAS_WA = 150, 108   # 90 turnos pelo WhatsApp × 1,2 resposta


def uso_real() -> float:
    """Usuário típico: 150 turnos/mês, 108 respostas pelo WhatsApp, 4 templates (OTP, avisos)."""
    return TIPICO_TURNOS * turno("app", pior=False) + (TIPICO_RESPOSTAS_WA + 4) * WA


def plano(nome, mensal, anual, total, respostas_wa, templates, membros_ativos=1.0):
    teto = total * turno("app") + (respostas_wa + templates) * WA
    real = membros_ativos * uso_real()
    for imposto in (0.06, 0.155):
        for rotulo, preco in (("mensal", mensal), ("anual", anual / 12)):
            liq = preco * (1 - LOJA - imposto)
            print(f"{nome:8} imposto {imposto:5.1%} {rotulo:6} R$ {preco:6.2f} líquido {liq:6.2f}"
                  f" | no TETO {teto:6.2f} margem {(liq - teto) / liq:4.0%}"
                  f" | uso real {real:5.2f} margem {(liq - real) / liq:4.0%}")


if __name__ == "__main__":
    print(f"mensagem WhatsApp R$ {WA:.4f}")
    for canal in ("app", "wa"):
        print(f"turno {canal}: pior R$ {turno(canal):.4f} · real R$ {turno(canal, pior=False):.4f}")
    print(f"IA/turno haiku pior {ia('haiku', True):.4f} real {ia('haiku', False):.4f}"
          f" | gemini pior {ia('gemini', True):.4f} real {ia('gemini', False):.4f}")
    plano("pro", 24.90, 239.90, total=400, respostas_wa=150, templates=30)
    plano("familia", 49.90, 479.90, total=1000, respostas_wa=300, templates=60, membros_ativos=2.5)
    print(f"trial de 7 dias no teto (60 turnos, 40 respostas no WhatsApp): R$ {60 * turno('app') + 43 * WA:.2f}")
    print(f"créditos Claude US$ 200 = turnos de IA: pior {200 * FX / ia('haiku', True):,.0f} · real {200 * FX / ia('haiku', False):,.0f}")

    # escala: imposto 15,5%, mix 60% pro mensal / 30% pro anual / 10% família mensal, uso real
    liq = (0.6 * 24.90 + 0.3 * 239.90 / 12 + 0.1 * 49.90) * (1 - LOJA - 0.155)
    var = 0.9 * uso_real() + 0.1 * 2.5 * uso_real()
    fixo = {  # GCP R$17 + Supabase + Apple + Langfuse + Expo (ver a tabela do doc)
        10: 17 + (25 + 99 / 12) * FX,
        100: 17 + (25 + 99 / 12 + 29) * FX,
        1000: 17 + (40 + 99 / 12 + 129 + 19) * FX,
        10000: 17 + (250 + 99 / 12 + 760 + 54) * FX,
    }
    print(f"por assinante: líquido {liq:.2f} · variável {var:.2f} · contribuição {liq - var:.2f}"
          f" · equilíbrio com o fixo de 10: {fixo[10] / (liq - var):.0f} assinantes")
    for n, f in fixo.items():
        receita_bruta = n * liq / (1 - LOJA - 0.155)
        f += 0 if receita_bruta / FX < 2500 else 0.01 * receita_bruta   # RevenueCat 1% acima de US$ 2,5k
        res = n * (liq - var) - f
        print(f"N={n:6} líquido {n * liq:9.0f} variável {n * var:8.0f} fixo {f:7.0f} resultado {res:9.0f} ({res / (n * liq):4.0%})")
