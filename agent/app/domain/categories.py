"""Categorias sugeridas — texto livre, minúsculo, curto, sem FK.

Cópia literal de src/lib/categories.ts. A lista aparece nos prompts e nos guards;
divergir dela faria o modelo sugerir categoria que a tela não conhece.
"""

SUGGESTED_CATEGORIES: tuple[str, ...] = (
    "mercado",
    "transporte",
    "lazer",
    "contas",
    "saúde",
    "casa",
    "educação",
    "assinaturas",
    "restaurante",
    "salário",
    "freela",
    "outros",
)


def normalize(category: str | None) -> str | None:
    """Minúscula, sem espaço sobrando, no máximo 40 chars (o check do banco)."""
    if not category:
        return None
    limpo = category.strip().lower()[:40].strip()
    return limpo or None
