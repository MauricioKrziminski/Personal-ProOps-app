# Datas contextualizadas e intervalos abertos — QA de 30/09/2026

Checkout `gabriel/entrada-filtros`, HEAD de referência `49468625323401e6cac6e9c378c291da129a59ed`, app de desenvolvimento `com.proops.personal.dev`. Esta pasta registra a continuação solicitada pelo usuário; não substitui as evidências anteriores de entrada, filtros compactos ou outras listas. Capturas nativas originais, sem edição. Datas dos arquivos seguem 30/09 no fuso de São Paulo; parte dos metadados UTC já indica 01/10.

## Comportamento aceito

| Datas no filtro de lançamentos | Consulta e apresentação |
|---|---|
| Nenhuma | Mês/ciclo da régua, com previsões calculadas |
| Apenas inicial | Todos os registros a partir desse dia, inclusive; sem teto de mês e sem previsões calculadas |
| Apenas final | Todos os registros até esse dia, inclusive; sem piso de mês e sem previsões calculadas |
| Ambas | Intervalo inclusivo, incluindo previsões calculadas; sem truncar a janela longa |
| Mesmo dia | Intervalo válido e inclusivo |
| Final anterior à inicial | Aplicar desabilitado; erro junto ao campo final |

A regra de previsões com duas datas foi escolhida expressamente pelo usuário. A lista aberta explica: “Lançamentos registrados. Escolha as duas datas para incluir previsões.” Parcelas futuras já registradas continuam presentes: seu selo `previsto` descreve o estado do registro, não significa que vieram da consulta de previsões calculadas.

Saiu o título repetido `Data do lançamento`. O significado fica no rótulo do input: `Lançamento a partir de` / `Lançamento até`. Importações usam Importação; Dívidas, Primeiro vencimento; Parceladas, Primeira parcela; Recorrentes, Execução (ativas); Lembretes, Próxima execução; Notas, pasta, Arquivadas e Lixeira, Atualização. Os dez consumidores foram conferidos diretamente no iPhone. As regras de domínio das outras listas foram preservadas.

Um ícone junto ao primeiro rótulo redefine as duas datas no rascunho. Mantém os demais critérios. Fechar cancela; Aplicar confirma. O slot de 36 pontos evita deslocar o campo ao aparecer, com hitSlop e descrição acessível. Nenhum botão adicional por data ou título duplicado foi introduzido.

## Reprodução e correções pela raiz

1. A folha bloqueava Aplicar com somente uma data; a tela reconhecia período personalizado somente com duas; o hook enviava `lte.undefined`. Agora os limites são independentes em todas as páginas, e o período personalizado fica pronto sem esperar consultas do mês/ciclo anterior.
2. Desativar uma consulta do React Query não limpa seu cache nem impede `refetch` manual. A tela exclui explicitamente previsões em cache/em trânsito, erros e carregamento de consultas inativas. Refresh/retry fazem somente as consultas pertinentes. Os dois hooks de RPC também guardam seus argumentos dentro de `queryFn`, impedindo chamadas incompletas por refetch.
3. O erro de ordem das datas estava no fim da folha, fora da área do calendário. Agora aparece no campo final como mensagem animada e alerta acessível; corrigir a data remove o erro.
4. Na fonte máxima o período virava uma coluna de 130 pontos. A largura mínima de 180 permite ao resumo ocupar os 370 pontos úteis e manda o botão para a linha seguinte, sem limitar a fonte.
5. O TextField compartilhado tinha altura fixa de 50 pontos e cortava o valor digitado com Dynamic Type. Sua altura acompanha a linha de texto escalada, respeitando `allowFontScaling`, `maxFontSizeMultiplier` e geometria explícita do chamador. No iPhone, o input passou de 50 para 87 pontos com `QA` inteiro e voltou a 50 na fonte normal.
6. O histórico personalizado mostrava dia/mês sem ano, apesar de buscar outros anos. Cabeçalhos e rótulos acessíveis agora identificam o ano em formato compacto; o mês/ciclo mantém sua apresentação anterior. Extrato e ocorrências, telefone/tablet, uma ou duas bordas e retorno ao padrão têm regressão.
7. Na fonte máxima o total diário espremia a data em uma coluna de aproximadamente 110 pontos. O cabeçalho agora permite quebra de linha e mantém largura útil para a data; o total continua alinhado à direita. A captura final comprova data completa no nativo.

8. O piso escalado do título da Row excedia a própria largura do card na fonte máxima, cortando título e valor. A linha mede sua largura real, desconta padding/indentação e limita o piso a esse espaço. O valor fica num bloco limitado que conserva a fonte quando cabe e usa o ajuste existente de Money se exceder a própria linha. Regressão troca larguras 370 → 260 → 600 → 370 em escalas 1,0/1,3/3,12; captura nativa comprova título/parcela e valor inteiros. [RED](red-linha.log), [GREEN](green-linha.log), [iPhone fonte máxima](ios-linha-fonte.png), [Android fonte 2,0](android-linha-fonte.png).

## Gates e regressões

- `npm test`: **1.364/1.364**, zero falhas, cancelados, skips ou todos. [Log completo](tests.log).
- `npx tsc --noEmit`, `npx expo lint`, `git diff --check`: saída 0. [Tipos](tsc.log), [lint](lint.log), [verificação](verificacao.txt).
- React Doctor instalado 0.9.14: zero erros, 20 avisos — 18 funções já complexas, a Row que cruza o limiar com a medição do layout e um falso positivo de lookup sobre `string` em Recorrentes. O aviso novo descreve custo de manutenção; a regressão e a captura nativa comprovam o comportamento corrigido. Sem supressões. [Diagnóstico](react-doctor.log).
- RED observado antes das correções: [datas/rótulos](red-datas.log), [guardas de RPC](red-rpc.log), [erro contextual](red-erro-inline.log), [altura do input](red-textfield.log), [ano](red-anos.log), [largura do cabeçalho](red-cabecalho.log). [GREEN dos anos/cabeçalhos](green-anos.log).
- Testes executam hooks e cliente Supabase reais com transporte simulado: limites opcionais antes da paginação, páginas seguintes e guardas de RPC. O harness executa JSX real, aplica filtros e chama refresh, exercitando cache/em trânsito/erro, prontidão, cancelamento e retorno ao mês/ciclo. Não equivale a um dispositivo tablet nativo.
- A altura do input tem regressões para mudança de fonte na mesma árvore, valor digitado, volta à fonte padrão, escala desativada, limite de escala e geometria explícita multilinha.

Documentação consultada: [filtros condicionais Supabase](https://supabase.com/docs/reference/javascript/using-filters), [gte](https://supabase.com/docs/reference/javascript/using-filters-gte), [lte](https://supabase.com/docs/reference/javascript/using-filters-lte); React Native 0.86 [useWindowDimensions](https://reactnative.dev/docs/0.86/usewindowdimensions) e [TextInput](https://reactnative.dev/docs/0.86/textinput). Não houve mudança de migration, schema, autenticação, pacote ou dado financeiro nesta continuação.

## iPhone — execução direta

iPhone 17 Pro, iOS 26.5, bundle `.dev`, Metro deste checkout. Encerrar/reabrir a frio garantiu a fonte atual; [hashes dos 21 arquivos](source-sha256.json) identificam o código final. Logs: [fluxo completo](ios-fluxo.log), [tema escuro](ios-escuro.log), [reset/cancelar](ios-combinados.log), [largura do período](ios-periodo-fonte.log), [ano](ios-anos.log), [cabeçalho final](ios-cabecalho.log), [rótulos nas listas](ios-rotulos.txt).

| Cenário | Evidência |
|---|---|
| Reprodução: título repetido/data única bloqueada | [antes.png](antes.png), [AX](antes-ax.json) |
| Data inicial sozinha, final vazia e Aplicar habilitado | [ios-inicial.png](ios-inicial.png), [AX](ios-inicial-ax.json) |
| Data final sozinha | [ios-final.png](ios-final.png), [AX](ios-final-ax.json) |
| Intervalo invertido: erro visível e Aplicar bloqueado; cancelar conserva o filtro aplicado | [ios-invertido.png](ios-invertido.png), [AX](ios-invertido-ax.json) |
| Ambas as bordas e mesmo dia | [ios-fechado.png](ios-fechado.png), [ios-mesmo-dia.png](ios-mesmo-dia.png) |
| Histórico aberto com registro de 2027 e rótulo acessível completo | [ios-ano.png](ios-ano.png), [AX](ios-ano-ax.json) |
| Histórico fechado e retorno ao padrão, fonte final | [ios-ano-fechado.png](ios-ano-fechado.png), [ios-padrao.png](ios-padrao.png) |
| Claro/Escuro, folha e resultados | [ios-escuro-folha.png](ios-escuro-folha.png), [ios-escuro-lista.png](ios-escuro-lista.png) |
| Período na fonte máxima antes/depois | [ios-periodo-antes.png](ios-periodo-antes.png), [ios-periodo-depois.png](ios-periodo-depois.png) |
| Input na fonte máxima antes/depois | [ios-input-antes.png](ios-input-antes.png), [ios-input-depois.png](ios-input-depois.png), [AX final](ios-input-depois-ax.json) |
| Data do dia na fonte máxima | [ios-dia-fonte.png](ios-dia-fonte.png), [AX final](ios-dia-fonte-ax.json) |
| Datas dentro da pasta temporária vazia | [ios-pasta-folha.png](ios-pasta-folha.png), [ios-pasta-resultado.png](ios-pasta-resultado.png) |
| Movimento de reset, cancelar, reabrir e aplicar | [Video nativo de 28,47s](transicoes.mp4), [metadados](video.txt) |

O vídeo foi capturado antes dos ajustes finais de fonte/ano; comprova a transição e o rascunho. Capturas posteriores comprovam a geometria final. Não é uma medição de desempenho em aparelho físico.

## Android — execução direta

AVD `s26`, Android 16/API 36, app `.dev` 1.3.52 e Metro do checkout. O usuário desbloqueou o emulador; o bloqueio inicial por PIN foi resolvido. [Relatório](android.md), [datas normais](android-datas.log), [tema/filtros combinados](android-combinados.log), [fonte 2,0](android-fonte.log), [anos](android-anos.log), [cabeçalho final](android-cabecalho.log).

| Cenário | Evidência |
|---|---|
| Apenas inicial | [android-inicial.png](android-inicial.png), [XML](android-inicial.xml) |
| Apenas final | [android-final.png](android-final.png), [android-ate-lista.png](android-ate-lista.png) |
| Ordem invertida/erro contextual/cancelar | [android-invertido.png](android-invertido.png), [XML](android-invertido.xml) |
| Ambas as bordas e mesmo dia | [android-fechado.png](android-fechado.png), [android-mesmo-dia.png](android-mesmo-dia.png) |
| Escuro, data inicial + Gastos e reset preservando tipo | [android-escuro.png](android-escuro.png), [android-combinados.png](android-combinados.png), [android-reset-tipo.png](android-reset-tipo.png) |
| Fonte 2,0: inicial/final/reset/cancelar/aplicar/limpar | [android-fonte-folha.png](android-fonte-folha.png), [android-fonte-inicial.png](android-fonte-inicial.png), [android-fonte-final.png](android-fonte-final.png) |
| Ano no registro e no cabeçalho; fonte ampliada | [android-ano.png](android-ano.png), [XML](android-ano.xml), [android-dia-fonte.png](android-dia-fonte.png) |
| Fonte original e filtros padrão restaurados | [android-padrao.png](android-padrao.png), [XML](android-padrao.xml) |

Uma suspeita de cor incorreta do botão foi descartada: diagnóstico temporário confirmou que a animação chegava à cor final, e o teste sem instrumentação confirmou novamente. O AVD com lavapipe demorava a concluir a transição. [Captura em repouso](android-botao-repouso.png), [log](android-botao.log). Toda instrumentação foi removida; não houve alteração no hook de cores. O QA não mede desempenho em aparelho Android físico.

UIAutomator ocasionalmente não conseguiu obter estado idle/root; esses snapshots foram rejeitados e a leitura repetida, sem aceitar XML antigo. O primeiro teste de fonte 2,0 falhou na automação da data invertida em outubro; esse cenário foi comprovado com fonte normal e no iPhone. O teste final de fonte 2,0 cobre inicial/final/reset/cancelar/aplicar/limpar e conclui com saída 0. Não se reivindica intervalo invertido Android na fonte 2,0.

As primeiras execuções Android de datas normais e tema escuro foram interrompidas durante a limpeza, depois das verificações funcionais documentadas. A limpeza e os estados finais foram executados e verificados separadamente; esses logs não são apresentados como execuções integrais com saída 0. As execuções finais de fonte, anos e cabeçalho têm logs separados.

## Estado final e limites

A única pasta vazia foi criada após autorização expressa para QA. O teclado normalizou seu nome; a pasta exata criada foi apagada pelo app, sem notas. Duas notas ativas e três arquivadas originais foram preservadas. [Limpeza da pasta](ios-pasta-limpeza.log), [conferência final](limpeza.txt). Fonte iPhone `large`/tema Claro e Android 1,0/tema Sistema/night no restaurados. Filtros temporários limpos. Somente o AVD read-only iniciado pelo primário foi encerrado, sem salvar snapshot. Sem commit, push ou publicação.

Árvores AX/XML verificam alvos, valores, estado habilitado e texto acessível; não substituem uma sessão de VoiceOver/TalkBack. Não houve execução nativa em iPad nesta continuação. Testes de material/movimento reduzido existentes continuam passando. Capturas de perfil e conteúdo pessoal de Notas foram excluídas desta pasta. `manifest-sha256.json` cobre os artefatos; `source-sha256.json` cobre a implementação testada.
