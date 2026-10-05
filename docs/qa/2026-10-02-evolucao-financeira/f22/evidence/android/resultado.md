# F22 Android (emulator-5574) — resultado

Staging, usuario dev@. Originais em /private/tmp/proops-f22-native/android/. Emulador muito lento (Salvar levou 10-40 s; menu "..." ~6 s).
Bundle recarregado (force-stop) apos o aviso de bundle velho; casos 6 e Gerenciar reconferidos depois dele.

| # | Caso | Resultado | Captura |
|---|---|---|---|
| 1 | Menu do detalhe tem Duplicar e Virar favorito | PASSA | c1.png |
| 2 | Duplicar avulso antigo (31/08): abre formulario Uma vez, data 05/10 (hoje), titulo digitado, Salvar cria 1 novo em 05/10 | PASSA | c2d.png, c2e.png |
| 2b | Duplo toque no Salvar: 1 so lancamento | PASSA (1 linha) | — |
| 2c | "2 no total com o mesmo titulo" | NAO VERIFICADO: o adb input text perdeu caracteres e o 2o saiu como "QA F22 Andro" (ver strays) | — |
| 3 | Duplicar parcela 7/8: topo "Cópia da parcela 7/8 — vira um lançamento à vista", valor 900,00, sem parcelas; fechado pelo X sem salvar | PASSA | case3-menu.png, case3-form.png |
| 4 | Duplicar transferencia | NAO VERIFICADO: so existem transferencias de pagamento de fatura no staging; nao criei outra | — |
| 5 | Pagamento de fatura sem Duplicar (menu: Mudar categoria, Apagar, Cancelar) | PASSA | case5-fatura.png |
| 5b | Pagamento de divida com lancamento | NAO VERIFICADO: a "Parcela Compra Casa" de agosto e so contada (sem lancamento, tela de parcela) | — |
| 6 | Toque longo em lancamento salvo na lista tem Duplicar -> mesmo formulario preenchido (fechado sem salvar) | PASSA apos reload (ANTES do reload FALHOU: bundle velho, menu sem Duplicar). "Aluguel" prevista tem menu proprio | case6-menu.png, case6-form.png |
| 7 | Salvar como favorito (nome padrao = titulo, 15,00, conta Nubank, categoria) -> toast "virou favorito"; fileira Favoritos no novo lancamento; tocar preenche titulo/valor/categoria/conta com data de hoje, nada gravado | PASSA | case7-nome.png, case7-usar.png |
| 7b | "Virar favorito" no detalhe | PASSA (abre Nome do favorito; repetido recusado) | — |
| 8 | Nome repetido recusado: toast "Já existe um favorito com esse nome." | PASSA | case8.png |
| 9 | Gerenciar tem "Favoritos" com estrela (reload) | PASSA | manage2.png |
| 9b | Renomear para "QA F22 Android Cafe2", Arquivar (swipe, toast Desfazer), "Arquivados · 1", Desarquivar (swipe), Apagar (confirma "Os lançamentos que você já fez com ele continuam como estão.") | PASSA; lancamentos "QA F22 Android dup" seguem na lista | case9-*.png |
| 10 | Escuro + fonte 1.3 + densidade 560: lista Favoritos e formulario com fileira de favoritos sem corte | PASSA (so o favorito iOS visivel na hora) | case10-lista.png, case10-form.png |
| 10b | Ocultar valores | NAO VERIFICADO | — |

Restaurado: densidade 480, font_scale 1.0, noturno off (originais: 480 / 1.0 / no). App logado como dev@ (Hoje).

## Observacoes / defeitos
- Media: toque longo em item de lista via adb as vezes navega em vez de abrir o menu (uso do Link + onLongPress); parece artefato do adb, nao reproduzido por usuario real. Nao classificado como defeito do F22.
- Baixa: Salvar do formulario leva 10-40 s neste emulador (spinner "Salvando"); sem erro. Provavelmente carga do ambiente (iPhone em paralelo).
- Nenhum defeito funcional do F22 encontrado depois do reload.

## Residuos criados por mim (para sua limpeza por ID)
- "QA F22 Android dup" R$ 45,00, 05/10 (1 linha) — copia de "mercado" 31/08.
- "QA F22 Andro" R$ 45,00, 05/10 (titulo truncado pelo adb).
- "QA F22 Android Cafe" R$ 150,09, 05/10, Nubank — SALVO SEM QUERER (um toque errado no Salvar apos o teclado numerico; caso 7 dizia para nao salvar).
- Favoritos Android: todos apagados (Cafe2 apagado no caso 9). Nada tocado com prefixo "QA F22 iOS".
