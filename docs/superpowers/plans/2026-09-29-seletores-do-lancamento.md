# Seletores do lançamento

## Revisão atual — 30/09/2026

O usuário recusou a animação serial e pediu movimento contínuo, curto, semelhante à navbar Android, com um leve rebote. Esta revisão substitui o mecanismo descrito no registro histórico abaixo: a nova escolha é aplicada imediatamente; entrada e saída acompanham uma mola partindo do progresso atual, com altura contínua. Cores interpolam sem salto. Digitação e callbacks financeiros permanecem síncronos.

Verificação desta etapa: TypeScript e lint exit 0, 1218/1218 testes. Formatos, retenção de valores, categorias, calendário e cobrança conferidos em gravações nativas. Evidências locais em `docs/verification/2026-09-30-motion-continuo/README.md`; o [relatório publicável](../../releases/2026-09-30-v1.5.0.md) registra os resultados e limites finais sem dados financeiros pessoais. A seta foi esclarecida como convenção de saída/envio, sem símbolo universal para gasto; nenhum ícone foi alterado.

## Registro histórico — direção e correção

O usuário pediu remover a repetição de controles segmentados empilhados no formulário único. A prévia com três cartões quadrados foi recusada em 29/09/2026. A implementação segue a correção: uma composição fluida, moderna e refinada, com movimento integrado à escolha, sem o grid de cartões.

O formato (Uma vez, Recorrente, Financiamento) aparece como uma única escolha tipográfica: ícone circular, nome em destaque, descrição curta e affordance circular para abrir. Sem moldura de card ao redor do valor fechado. Ao tocar, aparecem três linhas com ícones e descrições em uma única superfície arredondada. A seleção coordena a saída da lista e do corpo antes de recolher o espaço e aplicar a escolha; a entrada do novo corpo começa após o commit. Tipo, Repete e Cobrança são campos colapsados com ícones, usando SelectField. A unidade do valor mantém o controle compacto junto do dinheiro.

Em 29/09 o usuário ampliou o pedido: toda mudança de estado deste formulário deve ser suave, clean e fluida. A dúvida sobre ↗ em Gasto foi respondida pela convenção já usada no app (saída da conta); não houve pedido de alterar o ícone. O complemento de motion cobre abertura/fechamento das listas e calendário, seleção, rótulos, campos condicionais, quantidade e mensagens, preservando a digitação e as animações existentes de valor, foco e interruptor.

## Restrições

- Manter os três formatos e os campos digitados ao alternar, inclusive os específicos de cada formato.
- Manter criação, edição, conversão, confirmações, dados, ordem dos campos e Categoria.
- Usar tokens existentes, temas claro/escuro e ícones com correspondência Android.
- Usar movimento de pressão, abertura e fechamento com Reduce Motion respeitado; não aplicar animação de layout no Android.
- Sem largura/altura fixa para texto, corte, diminuição de fonte ou desativação do tamanho acessível.
- Não alterar dados de produção, schema ou dependências. Sem push/tag.
- Preservar as alterações e os artefatos das verificações anteriores.

## Execução

1. Criar o seletor de formato e substituir os segmentados Tipo e Repete. Ajustar os testes comportamentais existentes e acrescentar cobertura de abertura/escolha/fechamento do novo controle.
2. Revisar a integração; executar TypeScript, lint e testes. Verificar diretamente iOS e Android, temas, fonte grande, alternância e retenção de dados. Registrar evidências e limites.
3. Completar e revisar o motion dos estados internos, com Reduce Motion, preservação do foco e callbacks corretos. Conferir vídeo nos dois sistemas após a última mudança.
4. Retomar a verificação pendente do formulário único da sessão anterior, sem confundir os resultados atuais com evidências históricas.

## Estado

- Base: main, 6599e837; alterações prévias de código já commitadas.
- Sessão anterior: implementação do formulário e das categorias entregue; verificação do formulário interrompida no iOS antes de salvar financiamento. Android e demais cenários ainda pendentes. Migração de categorias documentada como local, não aplicada remotamente.
- Antes desta mudança: TypeScript e lint passaram; 1175 testes passaram. Os dois registros de teste deixados pela sessão anterior foram removidos por ID e a ausência foi confirmada no staging.

- Complemento de motion implementado: presença com saída reservada, troca exclusiva de Cobrança, rótulos/seleções, contadores, calendário, campos condicionais e mensagens. Inputs e callbacks financeiros preservados; Reduce Motion com conclusão imediata.
- Portão final: TypeScript e lint exit 0, 1203/1203 testes, diff check limpo. Revisão final sem Critical/Important.
- Vídeos finais iOS conferidos para formato/retenção, repetição/calendário, cobrança e categorias. Android funcional passou estados, foco, claro/escuro, fonte e área segura; formato/retenção/noop e primeira aparição dos erros repetidos na fonte final sem debug. O intervalo aplicar→efeito de entrada no Android dev caiu de 896 para 218 ms; desempenho de release não medido. Provas e limites em `docs/verification/2026-09-29-lancar-categorias/README.md`.

- Pedido visual atual concluído e evidenciado. A verificação de conversões e integração de categorias dos planos anteriores permanece pendente, com escopo separado no registro de QA.
