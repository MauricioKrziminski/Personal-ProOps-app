# F08 — registro nativo e persistência

03/10/2026, branch `gabriel/financas-22-melhorias`, staging `utkqoiigimqzeenxkxdl`.
Este registro separa interação nativa, confirmação do banco e limites de execução.
Aceite e avanço ficam no [registro final](aceite.md). Nenhuma alteração em produção ou distribuição.

## Aparelhos e dados

iPhone 17 Pro, iOS 26.5, simulador `F0BDF23C-0286-4183-97E3-3BCC61D4267D`;
Android `emulator-5574`, 1344×2992, densidade 480, largura 448 dp, fonte 1.
App `com.proops.personal.dev`, build de desenvolvimento existente com Metro/staging.
Maestro 2.11.0, sem limpar storage, trocar login ou reinstalar drivers nesta rodada.
O outro Android `5576` estava no Tudo Azul e não tinha ProOps; foi preservado.

Conta de QA `7ebb1a7e-5588-41b3-b62f-d8ebea5766a3`, espaço Pessoal
`b94c2f3e-e1f1-450e-b549-bc570b5e8b0e`. Estado inicial: nenhum plano/recibo F08;
reserva sugerida R$ 2.500/mês, notebook R$ 1.320/mês, ambos com primeira data 03/10.
As metas, os aportes reais e a configuração de reserva F07 já existentes foram preservados.

## Matriz executada

| Caso | Evidência e conclusão |
| --- | --- |
| Abrir por Finanças → Metas → Simular juntas | Passou nas duas plataformas; espaço, período, qualificações, comparação caixa/disponível e tabela numérica conferidos |
| Régua Mês/Ciclo | Android mudou a agregação mantendo o contexto do espaço; contrato SQL e teste da Sheet cobrem ciclo de outro workspace |
| Edição, inclusão/exclusão e cancelamento | Android passou 15:19:47–15:24:35 BRT: R$ 543,21, dia 31/10, excluir/reincluir, fechar/reabrir com R$ 2.500 e 03/10; iOS também descartou draft/data antes do salvamento |
| Recálculo com tabela expandida | Falha de geometria reproduzida e corrigida: resultado continua montado e conserva expansão/altura durante fetch; Android confirmou campo inteiro e tabela preservada após a correção |
| Salvar no iOS | `ios-fresh-save` exit 0, 15:37:25–15:38:05; escolheu 31/10 antes do teclado, digitou R$ 700, salvou e voltou à lista; banco confirmou revisão 1 e um recibo |
| Cold launch iOS | `ios-persistence` exit 0, 15:39:20–15:39:51; login/dados mantidos, nova abertura mostrou R$ 700 e 31/10 |
| iOS → Android | Nova sessão Android leu R$ 700/31/10; notebook R$ 1.320 mantido; capturas e asserts conferidos |
| Salvar no Android | Um único toque Save, 15:42:37–15:42:51; reserva R$ 800/31/10; banco confirmou revisão 2 e dois recibos; readback corrigido exit 0 às 15:44:11–15:44:21 |
| Android → iOS e snapshot antigo | A sessão iOS aberta perdeu o cenário antigo, desabilitou Save e exigiu reabrir; `ios-cross-update` exit 0, 15:45:35–15:45:57, reabriu R$ 800/31/10 sem sobrescrever a revisão nova |
| Entrada pela Projeção no iOS | `ios-forecast-open` exit 0, 15:40:54–15:41:14; Ajustar plano herdou horizonte 90 dias e contexto; fechar devolveu à Projeção |
| Privacidade no iOS | `ios-privacy` exit 0; mínimo/efeitos/frases/tabela ocultados, gráfico e data de pressão removidos; hierarchy sem BRL ou label de comparação no resultado visível; preferência original restaurada no `ios-cross-update` |
| Projeção e privacidade Android | `android-phone-final-reading` exit 0, 15:49:19–15:52:43; horizonte 90 dias herdado, resultados/tabela sem BRL com ocultação, gráfico/data de pressão removidos; preferência restaurada |
| Integridade financeira | Após ambos os salvamentos, hashes e contagens de nove fontes iguais ao baseline: contas, ativos, metas, aportes reais, transações, alocações, reserva, patrimônio e saldos de contas |
| Recusa sem loading e baseline final | `ios-baseline-restored` exit 0, 15:53:53–15:54:11; erro e campos editáveis sem skeleton indefinido, reabriu R$ 2.500/03/10 e fechou; snapshot completo do banco idêntico ao inicial |

Os campos de intenção do próprio usuário continuam legíveis ao editar, conforme regra F07;
o modo oculto protege os valores e a data de pressão das leituras derivadas. Contagens de
metas incluídas/incompletas e a ressalva de prazo continuam visíveis, sem valores financeiros.
A tabela tem alternativa textual e os gráficos
distinguem linha contínua/tracejada além da cor. Capturas selecionadas foram inspecionadas
individualmente; não há alegação de revisão de cada frame da animação.

## Falhas reais e falhas do roteiro

A substituição do resultado por um skeleton fixo desmontava a tabela e deslocava campos
durante edição. O componente agora conserva sessão/expansão e a altura medida durante fetch,
sem conservar números anteriores. RED→GREEN e captura Android sustentam essa correção.
Outra correção remove o placeholder indefinido ao receber erro/recusa: conserva espaço apenas
enquanto há consulta em andamento. O teste cobre tanto erro transitório quanto nova revisão.

No iOS, `scrollUntilVisible` tratou o DatePicker sob o teclado como visível; tocar nele digitou
na tecla encobrindo o campo. `hideKeyboard` não conseguiu dispensar o number pad. Os drafts
errados não foram salvos, confirmado pelo banco; cold launch sem limpar storage e escolha
da data antes da digitação passaram. Isso não foi atribuído a um defeito do DatePicker.
No Android, eraseAllText padrão sofreu timeout no driver; erase limitado e regex do valor
acessível passaram. A barra de escrita com stylus foi a entrada observada nesta rodada.

O primeiro roteiro após Save Android falhou porque `assertNotVisible: Plano de metas` também
encontrava o título da seção na lista. O fechamento real foi confirmado por captura, banco
e novo roteiro somente leitura: subtitle da Sheet ausente, Simular juntas e R$ 800/mês presentes.
O primeiro restore de privacidade iOS procurou Ver períodos depois da atualização externa;
o resultado já havia sido retirado corretamente. A reabertura explícita passou, sem novo Save.

## Alcance e pendências

Fluxos financeiros de F08, persistência e concorrência de revisão acima foram executados.
Perda real de resposta/rede neste incremento não foi injetada nos aparelhos: seu protocolo
tem testes determinísticos e corridas de banco, descritos nos registros de código/SQL.
F08 não teve rodada própria em tablet, fonte ampliada, todos os temas ou build sem Metro;
as verificações anteriores do kit F07 e testes de preservação da sessão não substituem isso.

O incidente `QA-ANDROID-20261003-ANR` permanece aberto, sem correção causal alegada.
Logcat desta rodada foi observado de 14:48:26 a 15:54:27 BRT nos dois Androids, com zero
marcadores de ANR/FATAL/Input dispatch timeout; o agente principal conferiu as fontes.
Ausência de novo marcador em uma
janela limitada não certifica estabilidade ou distribuição.

Evidências portáveis: [manifesto](evidence/nativo/artifact-manifest.json), YAMLs, logs,
resultados, capturas e resumos dos oráculos. Os resumos de banco contêm hashes/contagens,
não os registros financeiros completos ou credenciais. O [ensaio com rollback](evidence/nativo/cleanup-rollback.json)
e a [limpeza efetiva](evidence/nativo/cleanup-commit.json) verificaram revisão, itens, autor,
UUID/payload/result dos dois recibos antes de remover exclusivamente plano/itens e recibos
criados nesta rodada. A primeira comparação recusou prosseguir por diferença de fuso na
serialização; alinhar BRT à captura original permitiu igualdade exata, sem relaxar o guard.
O [oráculo final](evidence/nativo/restoration-check.json) confirmou igualdade do snapshot
inteiro com o inicial, incluindo projeção e nove fontes. Nenhum aporte ou lançamento foi apagado.
