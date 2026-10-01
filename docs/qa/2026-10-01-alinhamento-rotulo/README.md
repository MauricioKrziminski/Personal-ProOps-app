# Alinhamento do rótulo — 01/10/2026

Ajuste na branch `gabriel/entrada-filtros`, app de desenvolvimento `com.proops.personal.dev`. Reprodução iniciada em 30/09, validação encerrada em 01/10, no iPhone 17 Pro/iOS 26.5. Capturas nativas originais, sem edição.

O rótulo “Lançamento a partir de” estava 9 pontos acima do centro do reset: texto y312/h18, ação y312/h36. O `Field` centralizava o envelope animado na linha, mas a camada interna com `flex: 1` ocupava a altura da ação e deixava seu texto no topo.

`justifyContent: 'center'` centraliza o conteúdo dessa camada quando o campo tem uma ação ao lado do rótulo. Na mesma tela, texto y321/h18 e ação y312/h36 agora compartilham o centro y330. Input y357/h48 e segundo rótulo y422/h18 permanecem iguais. A correção usa layout natural e conserva quebra de linha, animação e alvo do botão.

| Evidência | Cenário |
|---|---|
| [before.png](before.png), [before-ax.json](before-ax.json) | Reprodução: diferença de 9 pontos entre os centros |
| [normal-selected.png](normal-selected.png), [normal-selected-ax.json](normal-selected-ax.json) | Correção: centros coincidem; input na mesma posição |
| [normal-empty.png](normal-empty.png), [normal-reset.png](normal-reset.png) | Sem data e após redefinir: geometria permanece estável |
| [maximum-font-selected.png](maximum-font-selected.png), [maximum-font-reset.png](maximum-font-reset.png) | Fonte máxima: rótulo de duas linhas e reset centralizados |
| [metrics.json](metrics.json), [native-qa.log](native-qa.log) | Medições dos cinco estados, hash do código e resultado da execução |
| [verification.json](verification.json), [tests-summary.log](tests-summary.log) | Verificações e estado restaurado |

QA nativo validou data inicial aberta, Aplicar, reset do rascunho, cancelar preservando o filtro aplicado, fonte normal e máxima. A diferença dos centros foi 0 na fonte normal e aproximadamente 0,00001 ponto na máxima. O desaparecimento do ícone não desloca rótulo/input. Todos os 1.364 testes passaram, sem falhas/cancelados/skips/todos; TypeScript, lint e diff sem erro.

Fonte `large`, filtros limpos e tela Notas restaurados e conferidos: duas notas ativas, três arquivadas. Nenhum registro financeiro ou pasta criado/alterado. O hash de `field.tsx` permaneceu estável durante a execução nativa. Este ajuste visual foi executado diretamente no iPhone; não houve nova execução Android ou iPad. As evidências e hashes das etapas anteriores foram preservados.
