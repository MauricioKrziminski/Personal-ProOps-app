# F17 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`, agente de staging `agente-staging-00209`. [Contrato](contrato.md).

**Como é calculado:** um (i) ao lado do título de cada indicador (`Explica`) abre uma folha com O
que conta, Período (as datas da própria resposta), Fonte e, quando há, Qualidade. Cobertos: saúde
financeira, reserva de emergência, investimentos, orçamentos, projeção, resultado do ciclo (com
"Ver o que fecha o ciclo", que abre o detalhe do mesmo período), plano de orçamento (F14) e "Por
que mudou?" (F15). Cada texto sai de uma função de `src/lib/explicacoes.ts`, com teste, a partir do
payload que desenhou o número; sem número, sem (i).

**Avisos que abrem o item:** alvos novos `invoice` e `transaction` nos dois lados do contrato de
push (`push.py` `TARGETS` e `push-routes.ts` `ALLOWED`, presos por teste), com `ref` uuid;
`invoice_due` e `bill_due` passam a abrir a fatura e o lançamento. `ref` que não é uuid cai na
lista de antes. A fatura e o lançamento que não existem mostram "Isto não existe mais" com o
caminho para a lista. O histórico de alertas do Perfil abre o mesmo destino.

## Banco e agente

- `20261005150000_explicacoes.sql` — `financial_health()` devolve `window_from`/`window_to` no
  fim (drop + create, porque o tipo de retorno muda; cabeçalho com `set timezone`, grants de
  volta). Só o app chama. Teste `explicacoes.sql`; suíte SQL inteira depois do push: 107/110, as
  três de fora são as de banco vazio/data fixa.
- Agente: `target_for`/`send` com os alvos novos e validação do uuid; pytest (1255) e ruff verdes;
  deployado no staging.

## Código

Na integração entraram as explicações do F14 e do F15, que não existiam na base em que o F17 foi
feito. Correção achada no QA: a nota de mês incompleto da Projeção dizia o fim um dia antes do
fim real (a série vai de hoje até hoje + N dias, inclusive); agora lê a mesma data do rótulo
"de hoje até". `npx tsc --noEmit`, `npx expo lint` e `npm test` com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | (i) de saúde, reserva, orçamentos, projeção, ciclo e "Por que mudou?" com os períodos da tela; fatura e lançamento reais e inexistentes por link, com o app aberto e fechado; escuro + fonte grande + ocultar valores. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | Os mesmos (i) e períodos; inexistentes por link mostram "Isto não existe mais"; escuro + fonte 1,3 + ocultar valores. [Resultado e capturas](evidence/android/) |

Só leitura (dois alertas marcados como lidos pelo toque).

## Limites

- O (i) de Investimentos e o do plano de orçamento não foram vistos no aparelho: o staging não
  tem conta de investimento nem plano salvo, e criar seria escrita. Estão cobertos pelos testes
  do catálogo.
- O toque num push real não foi exercitado: o simulador não registra push e o `simctl push` não
  mostrou o banner. O destino foi provado por link direto e pelo histórico de alertas (que no
  staging só tem `ref` antigo, então exercitou a volta para a lista).
- No Android, o item inexistente ficou 20–35 s em esqueleto antes da frase (sem nova tentativa
  na consulta; o emulador estava lento). No iPhone não houve espera.
- O botão do ciclo se chama "Ver o que fecha o ciclo", o rótulo que a tela já usava.
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push ou tag; agente só no staging.
