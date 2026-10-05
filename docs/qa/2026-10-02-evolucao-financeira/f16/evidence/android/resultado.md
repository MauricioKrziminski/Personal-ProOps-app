# F16 lançar por voz: QA nativo Android (emulator-5574, pacote com.proops.personal.dev)

Data: 05/10/2026. Staging, usuário dev@proops.local. Caminho de fala: o microfone do emulador é mudo. Gravar e parar sempre devolveu "O microfone não captou som..." e abriu o campo "O que você falou", onde a frase foi digitada. Nenhuma transcrição real (Groq) foi exercitada; o rascunho (`/internal/finance/draft`) foi real.

| # | Caso | Resultado | Evidência |
|---|------|-----------|-----------|
| 0 | Menu "Lançar" tem "Por voz" (bundle novo) | PASSA | 01-menu.png |
| 1 | Permissão negada: diálogo do sistema, "Não permitir" -> frase "Permita o microfone nos ajustes do aparelho para gravar." + "Abrir ajustes" (abre Configurações do app); concedida de volta, Gravar passa a gravar | PASSA | 02a-dialogo.png, 02-perm-negada.png, 02b-ajustes.png, 03-gravando.png |
| 1b | Áudio sem som -> frase de erro + campo aparece | PASSA | 04-sem-som.png |
| 2 | "gastei 45 no mercado ontem" -> /finance/lancar Uma vez, Gasto, 45,00, título "mercado", data 04/10/2026 (ontem), pago; cancelado pelo X sem salvar | PASSA | 05-frase-digitada.png, 06-caso2-form.png, 07-caso2-form-baixo.png, 08-caso2-cancelado.png |
| 3 | "comprei um fone de 300 em 3x no nubank" -> Gasto 300,00, título "fone", conta "Nubank Cartão" (única que casa), Parcelas 3, "Total da compra" (3x de R$ 100,00, fatura vence 10/11). Sem Note de pergunta (nada ambíguo) | PASSA | 09-caso3-frase.png, 09-caso3-form.png, 10-caso3-baixo.png |
| 4 | "netflix 55 todo dia 5" -> Recorrente, Gasto, "Netflix", 55,00, Mensal a cada 1 mês, "Repete todo dia 5", início 05/10/2026 | PASSA | 11-caso4-frase.png, 11-caso4-form.png, 11-caso4-baixo.png |
| 5 | "gastei 12,34 com QA F16 Android cafe" -> Gasto 12,34, título "QA F16 Android cafe", Sem conta (não perguntou conta), Salvar. Exatamente um lançamento | PASSA | 12-caso5-form.png, 13-caso5-antes-de-salvar.png, 14-caso5-salvo.png, 16-lista-qa-duas-linhas.png |
| 6 | Cancelar em cada etapa: folha ociosa (X), gravando (X: o microfone para, `dumpsys audio` mostra `rec stop`), formulário dos casos 2, 3 e 4 (X). Nenhum lançamento criado (busca "QA F16" lista só 1 Android; Hoje manteve o total) | PASSA | 17-gravando.png, 08-caso2-cancelado.png |
| 7 | HOME durante a gravação e volta: gravação parou (rec stop no `dumpsys audio`), Note "A gravação parou porque o app saiu da tela. Grave de novo.", campo visível; Gravar de novo funciona | PASSA | 18-caso7-voltou.png |
| 8 | Escuro + fonte 1,3 + animações 0: menu, folha (gravando, erro, frase, montando) e formulário prefilled sem corte; com animações 0 o nível é estático (5 barras em altura mínima, mic mudo) | PASSA | 20-menu-escuro-fonte.png, 21-folha-escuro-fonte.png, 22-gravando-anim0.png, 23-erro-sem-som-escuro.png, 24-frase-escuro.png, 25-form-escuro-fonte.png |

## Lançamento salvo (caso 5)

Um, no staging: despesa "QA F16 Android cafe", R$ 12,34, 05/10/2026, sem conta, pago. Apagar depois. A lista também tem "QA F16 iOS cafe" R$ 12,34, que é do outro agente (o total de hoje, 24,68, é a soma dos dois).

## Defeitos e observações

- Nenhum defeito bloqueante do F16.
- Latência de "Montar lançamento": 14 a 30 s no staging (maior com Gemini frio). O botão fica em carregando (dois pontos); sem timeout visível. Vale conferir se é aceitável.
- Mudar o tema (`cmd uimode night`) com a folha aberta fecha a folha (a atividade recria e o estado de `useLancarPorVoz` se perde). Raro em uso real; sem perda de dado.
- A Note "A gravação parou..." e "Permita o microfone..." permanecem até a próxima ação; depois de conceder a permissão e tocar Gravar, a Note do microfone some. OK.
- No escuro, alguns chips de categoria ("eletrônicos", "qa f06...") aparecem sem ícone (25-form-escuro-fonte.png); não é do F16 (seletor de categorias).

## Problemas do runner

- `input text` e swipes: o formulário abre com o Título focado e o teclado aberto; um swipe que começa na área do teclado digita letras no título (vi "fone to"/"QA F16 Android cafe to l", corrigidos antes de salvar; artefato do teste, não bug do app).
- `pm revoke` mata o processo do app. Depois de reabrir o app, esperar ~25 s antes de tocar.
- A Metro/emulador lentos: Gravar demora ~8 a 12 s para virar Parar; tocar Parar antes disso não faz nada.
- `uiautomator dump` falha com "could not get idle state" logo depois de tocar Salvar (animação); repetir.

## Restaurado

night no, font_scale 1.0, animator/transition/window_animation_scale 1, RECORD_AUDIO revogada (estado inicial era granted=false), stayon false.
