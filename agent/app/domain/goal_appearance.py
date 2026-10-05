"""Ícone e cor de uma meta: a lista FECHADA que o app aceita.

O ícone da meta vem da MESMA grade da categoria (`ICONES_DE_CATEGORIA` e `ROTULO_DO_ICONE`, em
`src/lib/categorias.ts`) e a cor é a paleta das notas (o CHECK de `goals.color`). Existe UMA cópia
literal aqui porque o Python não importa de `src/`; `tests/test_goal_appearance.py` lê o arquivo
TypeScript e quebra se as listas divergirem.
"""

ICONES = (
    "cart", "fork.knife", "cup.and.saucer", "car", "fuelpump", "bus", "airplane", "house",
    "bolt", "drop", "wifi", "phone", "heart", "cross.case", "pills", "graduationcap",
    "book", "tshirt", "bag", "gift", "gamecontroller", "film", "music.note", "pawprint",
    "figure.run", "wrench.and.screwdriver", "briefcase", "banknote", "creditcard", "tag",
)

ROTULO_DO_ICONE = {
    "cart": "Carrinho", "fork.knife": "Talheres", "cup.and.saucer": "Café", "car": "Carro",
    "fuelpump": "Combustível", "bus": "Ônibus", "airplane": "Avião", "house": "Casa", "bolt": "Energia",
    "drop": "Água", "wifi": "Internet", "phone": "Telefone", "heart": "Coração", "cross.case": "Saúde",
    "pills": "Remédios", "graduationcap": "Educação", "book": "Livro", "tshirt": "Roupa", "bag": "Sacola",
    "gift": "Presente", "gamecontroller": "Jogos", "film": "Filme", "music.note": "Música",
    "pawprint": "Pet", "figure.run": "Esporte", "wrench.and.screwdriver": "Manutenção",
    "briefcase": "Trabalho", "banknote": "Dinheiro", "creditcard": "Cartão", "tag": "Etiqueta",
}

CORES = ("grafite", "oceano", "violeta", "magenta", "terra", "mostarda", "musgo", "turquesa")
