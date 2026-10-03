# F07 — pacote de revisão visual

Direção: **Operate**, extensão de **Suave / Papel e Tinta**. Pedido: implementar os
22 incrementos sequencialmente, com arquitetura robusta, componentes reutilizados,
tipografia/espaçamento/movimento incumbentes e validação real iOS/Android antes do próximo.
F07 identifica a reserva sem somar dinheiro novamente ao patrimônio.

Ground truth: PRODUCT.md, DESIGN.md, src/design/tokens.ts, Row, Field/MoneyField,
SelectField, SwitchRow, QuantityField, Sheet/TaskHeader e Presenca. Extensão local;
sem nova identidade, concept roll ou comp aprovado. A referência visual é o app existente.

## Direção

- **THESIS:** separar a intenção de reserva do caixa total, mostrando cobertura, base
  explicável e fontes com liquidez; configurar a reserva não movimenta dinheiro.
- **OWN-WORLD:** Papel e Tinta, fontes/tokens e materiais nativos incumbentes; uma seção
  integrada a Patrimônio e folha de edição compartilhada, sem kit paralelo.
- **STORY:** conferir cobertura → expandir base/fontes → editar valor ou base observada,
  horizonte e fontes → confirmar disponibilidades → salvar ou cancelar.
- **FIRST VIEWPORT:** Patrimônio preserva composição e saúde existente; a seção Reserva
  vem depois da saúde, com montante, cobertura, alvo, falta e ação Editar/Configurar;
  a folha abre com título, fechar, salvar e escolha da base.
- **FORM:** seção agrupada e folha nativa estável fora dos ramos adaptativos; campos e
  controles existentes, movimento de presença e dígitos do kit. O rascunho sobrevive
  à mudança de orientação/tamanho no alcance exercitado.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## QUALITY BAR

Base e cobertura distintas do caixa; ausência de base não equivale a zero. Disponibilidade
não inferida do nome do investimento. Fontes, saldo e liquidez compreensíveis; confirmação
separada de metas antigas sem origem. Erro junto do campo; conflito/resultado incerto
acima da rolagem com ação de recuperação. Valores legíveis, inclusive teto de centavos
seguros e fonte de acessibilidade; ações alcançáveis. Cancelar conserva o persistido;
privacidade oculta os derivados e nomes acessíveis. Campo em edição mostra seu próprio
valor. Tema, fontes e resize seguem o kit. Animações não limitadas nem suprimidas para QA.

## Artefatos e captura

Artefatos: src/app/finance/net-worth.tsx,
src/components/finance/emergency-reserve-section.tsx, src/hooks/use-emergency-reserve.ts,
src/lib/emergency-reserve.ts e mudanças compartilhadas em src/components/ui/field.tsx
com src/lib/money-field-fit.ts e src/components/ui/sheet.tsx. Não há raster novo de produto.
O fix final de contraste usa src/components/ui/switch-row.tsx, com cores somente Android.

Detector HTML/CSS **não aplicável** a React Native; revisão nativa do craft floor.
Manifesto privado `/private/tmp/proops-f07-final-review/captures.json`: 38 capturas nativas
sem edição, origem, dimensões e SHA-256. Os bytes ficam fora do Git por serem evidência
financeira. O caminho explícito substitui o fallback `.impeccable/review`.

Classes requeridas: iPhone 17 Pro/iOS26.5 Claro/Escuro, privacidade, accessibility-large
com teclado e teto monetário; iPad A16 retrato/paisagem/accessibility-large após correção
do MoneyField; Android/API36 telefone 448dp em Claro/Escuro, privacidade, gates/erros/
cancelamento, telefone384dp/fonte1,3 e teto monetário, resize448→800→448dp com draft.
Android é fixado em retrato pelo projeto: layout800dp no mesmo AVD não é aparelho físico
nem prova de paisagem Android. Paisagem iPad conserva EXIF8 no PNG de 1640×2360.
Capturas roladas são contextuais, não viewport inicial completo. Capturas anteriores
à correção XL não integram o manifesto final. Três imagens adicionais exercitam o Sheet
atual no iPhone e no iPad em retrato/paisagem. No Android, capturas imediatamente após
`wm size` ainda mostraram frames transitórios: as imagens válidas são as estabilizadas,
e o pacote não certifica duração ou fluidez dessa transição.

## Revisão e limites

A primeira revisão pediu recaptura de três PNGs; nenhuma aprovação dessa rodada foi usada.
A nova revisão completa abriu 38 imagens válidas e pediu um fix: SwitchRow Android Escuro.
O Verdict Pass abriu quatro recapturas ON/OFF nos dois temas e marcou o fix `resolved`,
com `disposition: ship` limitado à correção pontuada. Os relatórios privados são
`proops-f07-finish-review-valid.md` e `proops-f07-switch-verdict-review.md`.
O manifesto adicional `switch-verdict-captures.json` fica junto do pacote privado;
o [manifesto portátil](captures.json) distingue as duas fases e registra 42 imagens.
Não há raster de produto criado/substituído neste incremento. O veredito não
certifica FPS, sessão falada de leitor de tela, protocolo SQL ou causa da ANR.
Resultados funcionais e limite do incidente estão no [registro nativo](registro-nativo.md).
