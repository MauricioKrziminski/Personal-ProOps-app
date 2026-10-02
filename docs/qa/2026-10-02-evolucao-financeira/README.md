# Execução e evidência — evolução financeira

Baseline `main b7eccc0e`; branch `gabriel/financas-22-melhorias`. Início 02/10/2026.

Contrato: [spec dos 22 pontos](../../superpowers/specs/2026-10-02-evolucao-financeira-22-pontos-design.md) e [plano](../../superpowers/plans/2026-10-02-evolucao-financeira-22-pontos.md).

## Ambiente confirmado

`scripts/supabase-target.sh`: CLI e `.env.local` = staging `utkqoiigimqzeenxkxdl`. `.env` isolado ainda aponta para produção; processos de teste precisam carregar explicitamente `.env.local`/variante development. Não houve escrita de produção.

Android disponível: `emulator-5574`, app dev/staging/produção instalados; usar a variante de teste explícita. iOS disponível: iPhone17Pro, UDID `F0BDF23C-0286-4183-97E3-3BCC61D4267D`, runtime26.5; iniciado para preparar a validação. Esses fatos são preparação, não aceite do app modificado.

## Estado por ponto

| Id | Feature | Estado | iOS | Android |
|---|---|---|---|---|
| F01 | Forma de pagamento | Preparação do incremento | Não validado | Não validado |
| F02 | Criar origem no fluxo | Aguardando F01 | Não validado | Não validado |
| F03 | Saldo/limite no seletor | Aguardando F02 | Não validado | Não validado |
| F04 | Prévia do efeito | Aguardando F03 | Não validado | Não validado |
| F05 | Filtros por pagamento | Aguardando F04 | Não validado | Não validado |
| F06 | Classificações independentes | Aguardando F05 | Não validado | Não validado |
| F07 | Reserva dedicada | Aguardando F06 | Não validado | Não validado |
| F08 | Metas no planejamento | Aguardando F07 | Não validado | Não validado |
| F09 | Subcategorias | Aguardando F08 | Não validado | Não validado |
| F10 | Prazo pela contribuição | Aguardando F09 | Não validado | Não validado |
| F11 | Alocar/transferir | Aguardando F10 | Não validado | Não validado |
| F12 | Aporte/resgate | Aguardando F11 | Não validado | Não validado |
| F13 | Resultado/reavaliação | Aguardando F12 | Não validado | Não validado |
| F14 | Plano percentual | Aguardando F13 | Não validado | Não validado |
| F15 | Explicação de mudanças | Aguardando F14 | Não validado | Não validado |
| F16 | Voz contextual | Aguardando F15 | Não validado | Não validado |
| F17 | Ajuda e avisos | Aguardando F16 | Não validado | Não validado |
| F18 | Transferência recorrente | Aguardando F17 | Não validado | Não validado |
| F19 | Marcos nas metas | Aguardando F18 | Não validado | Não validado |
| F20 | Acumulação/renda futura | Aguardando F19 | Não validado | Não validado |
| F21 | Primeiro cadastro guiado | Aguardando F20 | Não validado | Não validado |
| F22 | Favoritos/duplicação | Aguardando F21 | Não validado | Não validado |

## Registro obrigatório por incremento

Cada entrega acrescenta: arquivos e contrato alterado; testes RED/GREEN e comandos/códigos de saída; migrations/aplicação/tipos; cenários de persistência com dados controlados; aparelho/build/backend; passos e resultado real de cada plataforma; capturas; problemas corrigidos e limites. Sem esses dados, não marcar “aceito”.

## Descoberta inicial

Repositório inicialmente limpo. Foram usadas impeccable, UI/UX Pro Max e skills de planejamento/TDD. Dois trabalhadores fizeram descoberta de contratos e sistema visual, somente leitura. A primary conferiu contratos e consolidou a especificação. Identificados: frontend antigo em docs/design, FinanceAction no teto de schema e lookup ambíguo/edição parcial dos juros do Pix. F01 precisa tratar o caminho tocado antes de aceite.

A pesquisa de UI/UX Pro Max retornou sugestões genéricas de landing/serifas/azul que não correspondem ao produto; a identidade existente prevalece. Sidecar impeccable está mais antigo que DESIGN.md; não foi reparado fora do escopo. Primitivos e regra recente governam o vidro dos controles iOS.
