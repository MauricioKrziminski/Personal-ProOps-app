# F08 — evidência nativa Android, staging QA

Dispositivo validado: emulator-5574, com.proops.personal.dev, 1344 × 2992 px, densidade 480, largura 448 dp e fontScale 1. Nenhuma edição no repositório, SQL, instalação, limpeza de armazenamento ou alteração de tamanho. O emulator-5576 não tinha o pacote ProOps e permaneceu no TudoAzul; tablet e resize ficam pendentes.

## Draft e estabilidade

`android-phone-open-goals-result.json`, exit 0: Finanças → menu compartilhado → Metas → Simular juntas. Capturas inspecionadas do contexto Pessoal, gráfico/legenda e números. A tabela civil e a seleção Mês/Ciclo também foram capturadas e inspecionadas.

`android-phone-stable-retest-result.json`, exit 0, 15:19:47–15:24:35 BRT: sessão nova, expansão da tabela, aporte 543,21, calendário com seleção 31/10, exclusão/restauração da reserva, cancelamento e reabertura. As assertions e a captura final confirmam retorno a 2.500,00 e 03/10/2026, com o cenário original (aportes 36.600,00 e disponível final −52.319,36). Nenhum Save nessa etapa. Após a correção do frame feita pelo root, a captura mostra o campo inteiro no viewport e a tabela ainda expandida, com quatro períodos e Ver mais (9). Isso prova o estado final capturado, não cada frame intermediário.

Antes dessa correção, o recálculo desmontava o resultado e a captura mostrava o campo abaixo do viewport; o toque na data também foi seguido por retorno ao topo. O root identificou e corrigiu a montagem/altura da sessão.

## Persistência entre aparelhos

O root confirmou revisão 1/recibo 1 após Save iOS: reserva 70000 cents em 31/10/2026, notebook sem mudança. A nova sessão Android exibiu e passou assertions de 700,00 e 31/10/2026; capturas mostram Pessoal, aportes 14.300,00, caixa final −12.719,36 e disponível −30.019,36.

O único Save Android autorizado mudou apenas a intenção da reserva para 800,00, mantendo 31/10/2026. Flow iniciou às 15:39:24.544; tap Salvar às 15:42:37.614 e conclusão às 15:42:51.758. A captura anterior mostra 800,00/31-10 e notebook 1.320,00. A lista retornou mostrando 800,00/mês e resumo −31.119,36. O flow original terminou exit 1 porque a assertion de ausência de “Plano de metas” também encontrou esse título na seção da lista. A verificação posterior, somente leitura, `android-phone-save-readback-result.json`, terminou exit 0 às 15:44:21: subtítulo da folha ausente, Simular juntas e 800,00/mês presentes. Nenhum segundo Save. O root confirmou revisão 2/recibos 2 e hashes das nove fontes financeiras iguais ao baseline; limpeza dos dados de teste pertence ao root.

## Projeção e ocultação

`android-phone-final-reading-result.json`, exit 0, 15:49:19.590–15:52:43.836 BRT. Projeção → Ajustar plano abriu no contexto Pessoal de 90 dias, com série diária, aportes 6.360,00 e disponível mínimo/final 7.448,24. Captura inspecionada.

Ao ocultar valores em Finanças e abrir o plano pelas Metas, a assertion confirmou `goal-plan-result` visível e nenhuma string BRL descendente. Assertions confirmaram ausência da data de pressão e do rótulo acessível da comparação do gráfico. Capturas inspecionadas mostram números mascarados, gráfico/legenda removidos e os quatro períodos da tabela mascarados. O campo próprio de edição 800,00/31-10 continua visível, conforme a regra de formulário.

Observação entregue ao root para interpretação do contrato: o aviso derivado “1 meta não alcança o prazo com este plano” permanece visível quando oculto, sem valores monetários. Nenhuma classificação de vazamento ou aceite final foi inferida.

Ao terminar, a folha estava fechada, a tela era Finanças e Mostrar valor havia sido acionado; assertion de Ocultar valor e captura confirmam preferência restaurada. O primeiro flow final parou antes de navegar porque o rótulo Android real do botão voltar é Navigate up, não Finanças; uma hierarchy corrigiu o segundo e último flow.

## Automação e limites

O Android apresentou a ferramenta de escrita stylus, sem teclado numérico convencional. A primeira exclusão padrão (eraseAllText) falhou com DeviceServerDiedException/DEADLINE_EXCEEDED de 120 s; isso não foi tratado como ANR do app. As exclusões posteriores foram limitadas a seis caracteres e concluíram. Falhas adicionais foram de seletor da data (accessibilityValue acrescenta o valor ao rótulo), assertion de título compartilhado e Back enviado por hideKeyboard fechando a folha. Não houve reinstalação do driver. Capturas posteriores e assertions corretas distinguem esses casos dos comportamentos reais.

Logcat: 03/10/2026, 14:48:26–15:54:27.415946 BRT, nos dois emuladores. Auditoria final sem matches de ANR, FATAL EXCEPTION, Fatal signal ou Input dispatching timed out. Apenas os dois logcats iniciados pela QA foram encerrados após preservar os arquivos. `android-logcat-audit.json` contém janela, contagens e PIDs. Isso não resolve o incidente histórico F07 nem certifica ausência de ANR fora da janela.

Todos os YAMLs, resultados, logs e screenshots ficam em /private/tmp/proops-f08-native/. Não foram repetidos gates, builds ou consultas SQL nesta QA.
