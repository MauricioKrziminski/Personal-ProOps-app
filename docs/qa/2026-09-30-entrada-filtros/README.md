# Evidência — entrada e filtros

Validação direta em iPhone 17 Pro / iOS 26.5, staging `utkqoiigimqzeenxkxdl`. Capturas iniciais no app `.personal`; aceitação no `.personal.dev` conectado ao Metro deste checkout. Os PNGs são capturas originais, sem edição. `capturas.json` registra tamanho e SHA-256.

Diagnóstico, regras e resultados: [entrada-e-filtros](../../bugs/2026-09-30-entrada-e-filtros.md). Plano: [implementação](../../superpowers/plans/2026-09-30-entrada-e-filtros.md).

| Captura | O que comprova |
|---|---|
| [financiamento-antes.png](financiamento-antes.png), [lancamentos-antes.png](lancamentos-antes.png) | Baseline: ausência de entrada e filtros limitados ao mês/chips |
| [financiamento-entrada.png](financiamento-entrada.png), [compra-entrada.png](compra-entrada.png) | Criação com entrada pelo formulário |
| [financiamento-ficha-final.png](financiamento-ficha-final.png) | Entrada separada no cartão, total da compra, saldo de parcelas e zero parcelas pagas |
| [entrada-cada-parcela.png](entrada-cada-parcela.png), [entrada-limite-de-data.png](entrada-limite-de-data.png) | R$ 200 de entrada + 5×R$ 200 = R$ 1.200; entrada aceita 31/08 e calendário bloqueia mês futuro, sem salvar esse ensaio |
| [lancamento-alvo-pagina-56.png](lancamento-alvo-pagina-56.png) | Valor mínimo=máximo encontra alvo depois da primeira página |
| [lancamentos-cinco-meses.png](lancamentos-cinco-meses.png) | Intervalo que ultrapassa a janela de 62 dias da previsão |
| [lancamentos-combinados.png](lancamentos-combinados.png) | Texto + dia + Gastos + Concluído + Sem conta + No app, seleções conferidas antes de aplicar |
| [valor-invertido.png](valor-invertido.png), [valor-inclusivo.png](valor-inclusivo.png) | Intervalo inválido bloqueado e limites iguais aceitos |
| [calendario-seis-semanas.png](calendario-seis-semanas.png), [datas-invertidas.png](datas-invertidas.png) | Agosto exibe 30/31; toque em 31 seleciona e intervalo invertido desabilita Aplicar |
| [notas-texto-e-data.png](notas-texto-e-data.png) | Busca com data inclusiva nas duas bordas, resultado após as primeiras 30 notas |
| [notas-arquivadas.png](notas-arquivadas.png), [notas-lixeira.png](notas-lixeira.png), [notas-na-pasta.png](notas-na-pasta.png) | Busca nos três escopos, preservando a pasta |
| [nota-menu-contextual.png](nota-menu-contextual.png) | Preview/menu nativo preservado após corrigir o alvo acessível |
| [lembretes-rascunho.png](lembretes-rascunho.png), [lembretes-combinados.png](lembretes-combinados.png) | Pausados + Notificação e WhatsApp + 31/10, encontrando alvo após os primeiros 20 |
| [importacoes-rascunho.png](importacoes-rascunho.png), [importacoes-combinadas.png](importacoes-combinadas.png) | CSV + Sem conta + 01/09, encontrando alvo após os primeiros 20 |
| [recorrentes-sem-resultados.png](recorrentes-sem-resultados.png) | Estado vazio acionável durante o recorte |
| [filtros-tema-escuro.png](filtros-tema-escuro.png) | Tema Escuro selecionado no app; preferência Claro restaurada depois |

As importações sintéticas não possuem itens: o rótulo derivado “Falhou” é esperado para essas fixtures e não representa erro da consulta filtrada. Lembretes sintéticos estavam pausados; nenhum aviso foi enviado. Capturas são evidência do cenário observado, não substituem as assertions nativas, de consulta ou SQL descritas no diagnóstico.

## Verificação automatizada

- `npm test`: 1.324/1.324, zero falhas ou testes ignorados.
- `npx tsc --noEmit`, `npx expo lint` e `git diff --check`: saída 0.
- `supabase/tests/down_payment.sql`: execução em staging com rollback, incluindo atomicidade, idempotência, autorização, cascatas, cartão e conversão/simulação.
- React Doctor 0.9.14, `--scope changed --base HEAD --include-untracked --no-score --no-supply-chain --no-cache`: zero erros; análise dos avisos no diagnóstico.

A aceitação visual foi feita no iPhone. Os testes locais também exercitam os materiais opaco/vidro, movimento reduzido, transições e consultas; não equivalem a uma execução nativa em Android ou tablet.

Dados de QA removidos em transação atômica pelos IDs inventariados. Uma conexão nova confirmou ausência de fixtures, contratos, entradas e pedidos próprios, preservando os quatro movimentos originais da fatura existente. Resultados: [verificacao.txt](verificacao.txt).
