# Datas de filtros sem rótulos repetidos

Pedido: colocar o significado da data no próprio rótulo do input e permitir um intervalo aberto ao preencher somente uma das datas.

Reprodução: no iPhone 17 Pro, a folha exibia `Data do lançamento`, `Data inicial` e `Data final`. Selecionar apenas 01/09/2026 desabilitava Aplicar. A tela só reconhecia um período personalizado com duas datas; o hook emitia `lte.undefined` ao receber apenas a inicial.

Decisão confirmada pelo usuário: uma data busca todos os lançamentos registrados nessa direção, com borda inclusiva. Previsões calculadas são incluídas com as duas datas; o mês/ciclo padrão conserva suas previsões. A tela explica essa diferença. Nenhum teto implícito será imposto à consulta dos registrados.

- [x] Reproduzir bloqueio e registrar evidência antes da alteração.
- [x] Criar regressões que falham para consulta aberta e rótulos contextualizados.
- [x] Remover o título repetido em todas as folhas; mover reset ao rótulo inicial, com alvo independente e acessível.
- [x] Corrigir estado, consultas, prontidão, cache, erros e refresh de Lançamentos para limites opcionais.
- [x] Validar início, fim, ambos, mesmo dia, ordem invertida, cancelamento, limpeza, filtros combinados e paginação.
- [x] Validar diretamente no iOS e Android, incluindo fonte de acessibilidade, tema e transições.
- [x] Executar testes, tipos, lint e revisão; documentar evidências atuais separadamente das anteriores.

Preservar o trabalho local na branch `gabriel/entrada-filtros`. Sem alteração de dados financeiros, migration, publicação ou commit.

Resultados adicionais de QA: erro de ordem passou ao campo final; período e cabeçalho do dia quebram linha na fonte máxima; TextField acompanha a altura escalada; histórico personalizado identifica o ano; Row mede a largura real para não cortar título/valor. Suspeita de cor final incorreta no Android foi descartada por diagnóstico e teste do hook original; instrumentação removida.

Aceitação: 1.364/1.364, TypeScript/lint/diff saída0; iPhone e Android validados diretamente, fontes/temas/filtros restaurados e pasta vazia autorizada removida. Evidências atuais, matriz e limites em [QA das datas abertas](../../qa/2026-09-30-filtros-visuais/datas-abertas/README.md). React Doctor: zero erros; avisos de manutenção discriminados no relatório. Sem commit, push ou publicação.
