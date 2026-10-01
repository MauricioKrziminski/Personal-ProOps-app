# Filtros visuais — evidência de 30/09/2026

Ajuste na branch `gabriel/entrada-filtros`, preservando a implementação anterior de entrada e filtros. App `com.proops.personal.dev`, iPhone 17 Pro, iOS 26.5, Metro deste checkout. Capturas nativas originais, sem edição.

Problema reproduzido: o cabeçalho exibia filtros/limpeza, retorno ao mês, abas de tipo, chips de situação e pílulas de seleção; conta e origem também eram editadas no menu. A área de datas tinha três botões adicionais.

A lista agora mostra período, um único botão com contagem e resumo textual. Tipo, situação, categoria, conta, origem e valores permanecem na folha. Até dois critérios aparecem no resumo, com indicação de quantos outros estão escolhidos; nomes quebram linha e o rótulo acessível contém o recorte completo. Busca fixa e navegação mês/ciclo foram preservadas. Datas usam um único ícone de redefinição junto ao título, com alvo de toque e descrição acessíveis.

A redefinição remove as duas datas no rascunho; fechar cancela e Aplicar confirma. Nas listas que aceitam apenas uma borda, o mesmo ícone limpa as datas sem afetar os demais critérios. Zero permanece um filtro válido.

Movimento usa as primitivas existentes: pressão/háptico, folha nativa e crossfade de textos. Controles de vidro e layout flex ficam fora do envelope de crossfade. Ocultar valores remonta o resumo imediatamente para evitar que a camada anterior preserve dinheiro visível. O rótulo do retorno usa a régua efetiva, inclusive mês civil nas ocorrências.

A QA de fonte máxima reproduziu corte vertical no Button compartilhado. A raiz era a altura rígida do Pressable e do conteúdo. Altura mínima com conteúdo natural e medição da geometria real corrigem texto, superfície e loader, inclusive caixa mais alta que larga. A fonte não foi limitada. No simulador, Aplicar cresceu de 36 para 73,33 pontos; o texto ficou inteiro.

## Evidências

| Arquivo | Cenário |
|---|---|
| [antes.png](antes.png) | Cabeçalho com controles repetidos; Nubank Cartão e 01/09–30/09 |
| [depois.png](depois.png), [multiplos.png](multiplos.png) | Mesmo cartão/período; filtro combinado e resumo acessível completo |
| [datas-icone.png](datas-icone.png) | Área de datas com ícone único, sem os três botões anteriores |
| [padrao.png](padrao.png), [reset-aplicado.png](reset-aplicado.png) | Navegação mês/ciclo preservada e reset confirmado depois de fechar a folha |
| [escuro.png](escuro.png) | Composição em tema Escuro selecionado no app; Claro restaurado |
| [transicoes.mp4](transicoes.mp4) | Vídeo nativo de 8,21s, 1206×2622: reset do rascunho, cancelar, reabrir e aplicar |
| [sem-resultados.png](sem-resultados.png) | Busca sem resultado mantém filtro e ação contextual de limpeza |
| [fonte-grande-antes.png](fonte-grande-antes.png), [fonte-grande-depois.png](fonte-grande-depois.png) | Reprodução e correção do corte vertical com fonte máxima |

## Verificação

- `npm test`: **1.338/1.338**, zero falhas ou testes ignorados.
- `npx tsc --noEmit`, `npx expo lint`, `git diff --check`: saída 0.
- Testes novos observaram falhas antes de contagem/reset e crescimento do Button; depois passaram.
- Revisão independente confirmou a correção dos riscos de layout, privacidade e régua de retorno.
- React Doctor: zero erros, 18 avisos no conjunto de alterações da branch (complexidade em funções que já eram complexas, incluindo trechos alterados, e o falso positivo já documentado na revisão anterior); sem supressões.

As primeiras tentativas de automação foram descartadas quando o classificador AX do iOS alternou Button/Link/GenericElement e o teste leu outra célula. As verificações finais usam rótulos únicos e valores reais; uma tentativa de entrada com acento também foi descartada porque `idb ui text` rejeitou o caractere. Esses resultados não foram contados como defeitos do aplicativo.

Validação visual direta no iPhone nesta primeira etapa; testes de movimento/material cobrem vidro/opaco e redução de movimento. O harness financeiro também executou a mesma integração do editor nas composições de telefone e tablet. Nesta etapa inicial não houve execução nativa nova em Android ou iPad. Nenhum dado financeiro foi criado ou alterado nesta revisão.

A mesma comparação de conta e intervalo adiantou a primeira transação de y≈563 para y≈407 (156 pontos). A captura final das datas e o teste de fonte são posteriores ao ajuste do Button; a altura visual normal permanece 36 pontos. O vídeo mostra a transição da folha; o estado publicado depois do fechamento nativo é comprovado separadamente por `reset-aplicado.png`.

## Continuação nas outras listas

O pedido de continuar levou o mesmo padrão a Lembretes, Importações, Dívidas, Parceladas, Recorrentes e Notas (aba, pasta, Arquivadas e Lixeira). A busca de Notas e o crescimento do resumo após a animação receberam correções adicionais pela raiz. Comparações, testes e validações desta etapa são independentes das evidências acima: [QA das outras listas](outras-listas/README.md).

## Datas contextualizadas e intervalos abertos

A continuação remove o título repetido, permite uma única borda em Lançamentos e respeita a regra de registros/previsões escolhida pelo usuário. Inclui as correções de fonte, identificação do ano e largura real da linha, com 1.364 testes e QA direta iPhone/Android. Reprodução, RED/GREEN, capturas atuais, vídeo, limpeza e limites: [QA das datas abertas](datas-abertas/README.md).

## Alinhamento do primeiro rótulo

A correção de 01/10 centraliza o texto junto ao reset na camada interna do campo, mantendo o input na mesma posição. Comparação nativa antes/depois, fonte máxima e reset/cancelar/aplicar: [QA do alinhamento](../2026-10-01-alinhamento-rotulo/README.md).

## Gap consistente entre rótulo e input

A continuação de 01/10 corrige a distância diferente nos dois campos de data, descontando a altura já ocupada pelo reset. Comparação antes/depois, oito estados nativos e rótulos longos: [QA do gap](../2026-10-01-gap-rotulo/README.md).
