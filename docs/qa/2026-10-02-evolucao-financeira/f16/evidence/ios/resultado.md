# F16 "lançar por voz" — QA nativo iOS (iPhone 17 Pro, iOS 26.5, `com.proops.personal.dev`, staging, dev@)

Entrada de fala: o caminho por VOZ funcionou (`say -v Luciana` captado pelo microfone do Mac, transcrição Groq: "Gastei 45 no mercado ontem."). Os casos 3 a 6 foram feitos pelo campo de texto (digitado), porque a voz leu "300 em 3x" como "300E3X" (ver defeitos/runner).

| # | Caso | Resultado | Evidência |
|---|------|-----------|-----------|
| 0 | Bundle novo provado: "Por voz" nos menus Lançar da Hoje (e Finanças, só após reiniciar o app) | PASSA | 04-menu-hoje.png (02-menu.png = bundle velho, sem "Por voz") |
| 1 | Microfone negado: frase "Permita o microfone nos ajustes do aparelho para gravar." + botão "Abrir ajustes" (grant depois) | PASSA | 05-sem-microfone.png |
| 2 | "gastei 45 no mercado ontem" (voz) -> Montar -> Uma vez, Gasto, título/categoria mercado, R$ 45,00, data 04/10/2026 (ontem), Sem conta; cancelado com ✕, nada gravado | PASSA | 06-gravando.png, 07-pos-parar.png, 08b-form-mercado.png |
| 3 | "comprei um fone de 300 em 3x no nubank" (texto) -> Uma vez, título fone, 3x de R$ 100,00 (total 300), conta Nubank Cartão (única que casa) já preenchida; Note de "qual conta" não aparece (só com ambiguidade, não exercitada) | PASSA (Note não testada) | c3b-transcricao.png, c3b-form.png |
| 3b | Mesma frase por voz: STT devolveu "300E3X"; formulário abre com Notes "Parcelas: o valor é o total ou o de cada parcela?" e "Não ouvi o valor: informe." e valor 0,00 (degradação correta) | PASSA (comportamento), ver defeito 1 | c3-voz-erro-300E3X.png |
| 4 | "netflix 55 todo dia 5" -> abre em Recorrente, título netflix, R$ 55,00, Repete Mensal, a cada 1 mês, começa 05/10/2026 | PASSA | c4-form.png |
| 5 | "recebi 500 de freela e gastei 30 de uber" -> só a 1a: Receita, freela, R$ 500,00; Note "Você disse 2 coisas: montei só a primeira. As outras 1 ficaram de fora" | PASSA (texto com concordância errada, defeito 2) | c5-form.png |
| 6 | Salvar um: "gastei 12,34 com QA F16 iOS cafe" -> Gasto, título "QA F16 iOS cafe", R$ 12,34, 05/10/2026, Sem conta (não pediu conta). Exatamente 1 lançamento na busca "QA F16" | PASSA | c6-form.png, c6-busca.png, c6-detalhe.png, c6-pos-salvar.png |
| 7 | Cancelar em cada etapa: gravando (✕), após transcrição (✕), no formulário (✕, casos 2 a 5). Buscas por netflix/freela/fone/mercado: só registros antigos (fone 24/12, freela 31/08, mercado 31/08); nada de 04/10 nem netflix | PASSA | 10-sem-som-erro.png (+ buscas, sem print) |
| 7b | Gravação sem som: Note "O microfone não captou som. Confira a entrada de áudio e tente novamente." e campo de texto liberado | PASSA | 10-sem-som-erro.png |
| 8 | App para segundo plano (Ajustes) durante gravação e volta: gravação parada, Note "A gravação parou porque o app saiu da tela. Grave de novo.", botão Gravar ativo, folha utilizável (regravou e transcreveu em seguida) | PASSA | 09-voltou-do-background.png |
| 9 | Escuro + accessibility-large + Reduzir movimento: durante a gravação, barra de nível estática (sem onda); folha e formulário legíveis, título "Novo lançamento" quebra em 2 linhas, Salvar desce para a linha de baixo sem corte | PASSA | 11 (claro+large+reduzir), 14-dark-large-reduce-gravando.png, 15-dark-large-form.png, 12-large-form.png |

## Transação salva
- Título: `QA F16 iOS cafe`, valor R$ 12,34, despesa, data 05/10/2026, sem conta, staging (dev@proops.local). Única criada; fica no staging (não apaguei, a tarefa não pediu).

## Defeitos
1. (menor, STT/ambiente) Voz leu "300 em 3x" como "300E3X" (Luciana TTS + Groq): valor não reconhecido. A degradação é correta (Notes pedindo o valor), mas o usuário real que falar "3x" pode cair nisso.
2. (texto) Note do caso 5: "As outras 1 ficaram de fora" — falta concordar singular ("A outra ficou de fora").
3. (observação) Nota de "qual conta/cartão" do caso 3 não foi verificada: só havia um cartão Nubank, então o preenchimento foi automático (como o contrato prevê).
4. (observação) No caso 2 o título do lançamento ficou "mercado" (sem verbo) e o foco/teclado abre no Título ao chegar no formulário, escondendo Valor/Categoria até dispensar o teclado — comportamento do formulário único, não da folha.
5. Onda de áudio animada com som não conferida em imagem estática: os prints mostram 5 pontos (silêncio ou entre sílabas) no modo normal; com Reduzir movimento a barra de nível aparece preenchida (~70%).

## Problemas do runner
- Após o primeiro `terminate`/`launch` o app só mostrou "Por voz" na Hoje; a Finanças aberta antes do reload mostrava o bundle velho (sem "Por voz"). Conferido depois do relaunch.
- `simctl privacy revoke/grant microphone` encerra o app; é preciso relançar (e esperar o Metro reconectar, ~14 s).
- `idb ui text` sem campo focado dispara o menu de desenvolvedor (Reload etc.); sempre tocar o TextArea antes.
- Não foi possível apagar o campo de busca por `ui key 42`; reabrir a busca para cada consulta.
- Aviso amarelo do LogBox ("Open debugger to view warnings") aparece nos prints grandes (dev apenas).

## Restaurado
Aparência do sistema light, content size large, Reduzir movimento 0, permissão de microfone concedida, tema do app Claro (valor inicial), app relançado em Hoje.
