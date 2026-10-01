# Android — intervalos abertos e rótulos contextualizados

Alvo: branch `gabriel/entrada-filtros`, AVD `s26`, `emulator-5554` dedicado, Android 16/API 36, app `com.proops.personal.dev` 1.3.52, Metro do checkout. O usuário desbloqueou o sistema; a limitação inicial por PIN foi resolvida, sem reset de dados ou tentativa de adivinhar credenciais.

| Verificação executada | Resultado | Evidência |
|---|---|---|
| Inicial sozinha | PASS | `android-inicial.png`, `android-ano.png`; registros de 2027 além do mês |
| Final sozinha | PASS | `android-final.png`, `android-ate-lista.png` |
| Datas invertidas e cancelar | PASS em fonte normal | `android-invertido.png/.xml`, `android-datas.log` |
| Duas datas e mesmo dia | PASS | `android-fechado.png`, `android-mesmo-dia.png` |
| Escuro + Gastos + inicial, reset só das datas, cancelar e aplicar | PASS funcional | `android-combinados.log`, `android-combinados.png`, `android-reset-tipo.png` |
| Fonte 2,0: inicial/final/reset/cancelar/aplicar/limpar | PASS, execução final saída 0 | `android-fonte.log`, capturas `android-fonte-*` |
| Ano em cabeçalho e transação acessível | PASS, execução final saída 0 | `android-anos.log`, `android-ano.xml` |
| Cabeçalho e linha com título/valor dentro da largura útil | PASS | `android-cabecalho.log`, `android-linha-fonte.png` |
| Preferências/filtros restaurados | PASS | `android-padrao.png/.xml`, `limpeza.txt` |

UIAutomator apresentou root nulo/timeout de idle em parte das leituras. O driver rejeita esses snapshots e repete a captura; não aceita XML anterior. Mudar font_scale recria a Activity; a navegação espera a tela carregar e reenvia o intent. Os cenários normais e de tema foram comprovados antes da interrupção durante sua limpeza; os estados finais foram restaurados e conferidos separadamente. Esses dois logs não equivalem a scripts integrais com saída 0. Os scripts finais de fonte, anos e layout concluíram as verificações indicadas acima.

O primeiro ensaio com fonte 2,0 falhou na automação da data invertida de outubro. Não foi contado como defeito do app nem como aprovação desse caso na fonte ampliada. Ordem invertida foi testada no Android normal e no iPhone.

Uma captura antes de assentar a transição sugeriu contraste incorreto do botão. A instrumentação temporária demonstrou o alvo e a conclusão da cor, e o teste com o hook original, sem instrumentação, confirmou a cor final. O AVD usa renderização por software lavapipe e apresentou demora nas animações; não se reivindica desempenho em Android físico. O hook de cores permaneceu idêntico ao HEAD.

O teste usou o acesso de desenvolvimento já disponível e não criou lançamentos nem alterou dados financeiros. Tema original Sistema, font_scale 1,0 e night mode no foram preservados/restaurados. Apenas o AVD read-only iniciado pelo primário foi encerrado, sem salvar snapshot; ver `limpeza.txt`.
