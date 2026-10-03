# F06 — pacote de revisão visual

Direção: **Operate**, extensão de **Suave / Papel e Tinta**. Pedido autorizado:
implementar os 22 pontos sequencialmente, com código robusto, componentes reutilizados,
tipografia/espaçamento/movimento do app e validação real iOS/Android antes do próximo.
F06 acrescenta duas dimensões opcionais do gasto, defaults de categoria e recortes;
nenhuma classificação significa uma obrigação moral ou é inferida pela repetição.

Ground truth: PRODUCT.md, DESIGN.md, src/design/tokens.ts, Row/Field/SelectField,
Sheet/FormularioEmTela/Presenca e as superfícies existentes. O contrato e os registros
deste diretório delimitam comportamento e prova. Extensão local segue new-work.md:
sem concept roll, seed ou comp aprovado. Referência visual é o próprio app construído.

## Cinco blocos da direção

- **THESIS:** escolher previsibilidade e necessidade separadamente, preservando história
  e decisão manual; classificar não muda dinheiro.
- **OWN-WORLD:** Papel e Tinta, materiais nativos e tokens incumbentes; Row, Field,
  SelectField e Sheet compartilhados, sem paleta ou motor paralelo.
- **STORY:** conferir resumo → expandir → escolher cada dimensão → salvar ou cancelar;
  categoria sugere, usuário decide; filtros explicam o recorte.
- **FIRST VIEWPORT:** composição do formulário e Salvar preservados; Classificação junto
  da categoria por revelação progressiva; lista mantém busca/período/filtros.
- **FORM:** extensão dos formulários/folhas/lista atuais; controles compartilhados e
  geometria natural disponíveis mesmo após resize ou mudança de fonte.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## QUALITY BAR

Controles independentes, desconhecido explícito, ajudas curtas sem julgamento, estado
selecionado legível, ação alcançável por rolagem/fonte de acessibilidade. Mesmos tokens,
ritmos e componentes dos fluxos incumbentes. Defaults não substituem decisão manual;
cancelar não grava; recortes não exibem resumo global enganoso; máscara preservada no
visual e nomes acessíveis. Movimento não impede disponibilidade/gestos/reversão.
Fonte grande e classes de telefone/tablet verificadas no alcance declarado; nenhum
benchmark/FPS ou sessão falada de leitor de tela é inferido de captura estática.

## Artifact e limites

ExpenseClassificationField/ExpenseClassificationControls, categoria-sheet.tsx,
formulários de lançamento/série/compra/dívida, transactions.tsx, [txId].tsx e
installments.tsx. O hook controla origem/defaults; funções puras e RPCs controlam escrita.
Detector HTML/CSS **não aplicável** a React Native: revisão manual do craft floor.
Não há raster novo de produto; capturas são evidência nativa sem edição.

Capturas canônicas e manifesto com SHA-256/dimensões/origem em
/private/tmp/proops-f06-final-review/captures.json. Os bytes completos permanecem
privados fora do Git; todos os arquivos enviados ao reviewer foram abertos pelo agente
principal, com nomes/estado conferidos. Essa localização explícita substitui o diretório
de fallback .impeccable/review para manter a evidência financeira privada.

Classes requeridas: iPhone17Pro/iOS26.5 (Escuro, fonte normal e accessibility-large),
iPadA16/iOS26.5 (Claro, accessibility-large, retrato após rotação real),
Android/API36 (Claro/Escuro, fonte1,3; telefone e layout tablet800dp no mesmo AVD).
Android é bloqueado em retrato pelo projeto; não alegar teste de paisagem suportada.
Inclui formulário/default/NULL, editor de categoria, lista AND/Não informado,
privacidade e recuperação de link inválido. Capturas roladas são contextuais, não
primeiro viewport completo. O manifesto final acrescenta o telefone384dp/fonte1,3.

## Revisão e fechamento

O revisor independente abriu as 17 capturas canônicas, conferiu manifesto e fonte
das superfícies amostradas. Disposição inicial **fix**: o link de classificação inválido
usava texto genérico de erro de carregamento e “Tentar de novo”, embora a ação já abrisse
os filtros. O problema era a identificação da ação, sem falha comprovada do handler.

A correção reutiliza EmptyState com “Classificação de gasto inválida no link”, orientação
curta e **Ajustar filtros**. A mesma captura Android foi refeita sem edição; manifesto,
dimensões e SHA atualizados. O revisor reabriu esses bytes e conferiu o ramo da fonte:
**ship, correção material 1 resolvida**. Esse veredito final cobre a correção pontuada;
mantém o alcance e os limites da revisão original, não constitui uma nova revisão integral
de toda a superfície. Relatórios privados: /private/tmp/proops-f06-finish-review.md e
/private/tmp/proops-f06-finish-verdict.md.

O agente principal executou separadamente os fluxos finais de aviso/abrir/cancelar/aplicar
e recuperação da lista no iOS e Android, ambos exit0. DESIGN.md e seu sidecar receberam
merge das regras duráveis do F06, preservando tokens e decisões incumbentes. Não houve
novo raster de produto. O resultado visual não substitui os testes funcionais, oráculos
de staging e limites registrados separadamente no [aceite](aceite.md).
