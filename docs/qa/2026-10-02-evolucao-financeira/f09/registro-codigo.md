# F09 — evidência de código

Branch `gabriel/financas-22-melhorias`; validação em 03/10/2026. Aceite funcional em
[aceite.md](aceite.md). As verificações abaixo descrevem a integração de subcategorias; a correção adicional
de coerência histórica do scheduler passou nos testes Python e em cinco provas SQL reais.

- `node --test`: 2.103 testes passaram, zero falhas/skip/cancelamentos. Log preservado.
- `npx tsc --noEmit`: exit 0 depois de regenerar os tipos do staging real.
- `EXPO_NO_DOTENV=1 npx expo lint`: exit 0, nenhum diagnóstico na rodada final.
- Seletor após ajuste de compilação: seus seis testes JSX passaram, incluindo resposta
  tardia ao trocar pai, registro, visita de presença e unmount.
- Integração Python após o ajuste histórico: 99 testes passaram; um aviso preexistente
  de depreciação do pacote google/genai. RED histórico e CAS de erro preservados.
- Ficha de lançamento agora mostra o nome resolvido do detalhe junto ao pai; os 11 testes
  de leitura JSX passaram, inclusive legado null sem UUID/undefined na metadata.
- React Doctor com base HEAD e arquivos novos: zero erros, 18 avisos, sem supressões.
  Score API indisponível; nenhum score inventado ou reutilizado.

O erro confirmado de React Compiler era um throw dentro de try/catch no preflight do
seletor inline. A validação foi movida para antes do try, preservando erro/draft e execução
somente dentro da sessão atual. Os testes focados passaram após a alteração.

Dos avisos do Doctor, dois marcam `foldCategory(item.name).includes(searching)` como busca
em array dentro de loop. Ambos são busca de substring em string, confirmada nos componentes
`subcategory-field` e `subcategory-manager`; não foi feita mudança superficial para silenciar
a regra. Os demais são heurísticas de complexidade (15) e tamanho do componente de regras (1).
Não constituem prova de defeito de execução. A separação já realizada mantém DTO/controlador,
hooks, campo, gerenciador e breakdown independentes; refatoração ampla fica fora deste gate.

A confirmação de subcategoria também invalida `categories-used`, que antes dependia do
realtime ou de um novo foco. Os três testes de regressão executam hooks/controlador e uma
QueryObserver real: confirmação direta, resposta resolvida e cancelamento selado atualizam
a consulta montada uma única vez; resposta ambígua não afirma contagem atual. Os 43 testes
de consistência passaram antes da rodada global final.

Os controles negativos e RED/GREEN preservados em `evidence/code` verificam perda de dono
da sessão e protocolo selado. Os testes de domínio/draft cobrem omitido versus null explícito,
clear ao trocar pai, alias, outro workspace, referências incompatíveis, soma exata, envelope
fechado, CAS/retry/cancelamento e imutabilidade da intenção. JSX real cobre gerenciamento,
importação/regras, dívida, breakdown e filtro sem consulta ampla quando o filho é inválido.

Nenhum destes passes substitui execução em iOS/Android, persistência ou estabilidade nativa.
Artefatos preservados em [manifesto](evidence/manifest.json).

O passe visual final em fonte 1,3 revelou o rótulo do total encostado no valor. O breakdown
passou a usar `Row.inlineValue`, layout já existente no kit, sem mudar o cálculo ou a Row
global. Depois desse ajuste: 11 testes de leitura JSX, TypeScript e lint passaram; composição
conferida no iOS e Android escuro/fonte 1,3. O gate global de 2.103 precede apenas esse prop
de apresentação. Logs adicionais `row-presentation.log`, `row-types.log`, `row-lint.log`.

Nos logs portáteis foram removidos apenas espaços finais, mantendo conteúdo/resultados. Os
originais permanecem em `/private/tmp/proops-f09-*`; SHA-256 identifica os artefatos copiados.
