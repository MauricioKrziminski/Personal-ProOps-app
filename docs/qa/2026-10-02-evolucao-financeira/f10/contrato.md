# F10 — meta por prazo ou contribuição

Estado: implementação em andamento em `gabriel/financas-22-melhorias`, após o
aceite funcional F09 (`365890f3`). Ambiente autorizado: staging
`utkqoiigimqzeenxkxdl`. Este documento fixa o incremento; não declara testes
nativos nem aplicação de schema já realizados.

## Comportamento

O editor de plano existente permite escolher **Por prazo** ou **Por mês**.
Por prazo, a pessoa informa uma data e recebe o aporte mensal necessário.
Por mês, informa quanto consegue guardar e recebe a previsão de conclusão.
O outro valor é uma leitura calculada, sem dois campos disputando a mesma regra.
Trocar de modo conserva os rascunhos dos campos inativos durante a sessão.

Alvo e dinheiro guardado vêm da meta real. Um aporte inicial opcional, com data
explícita, é intenção futura do plano: salvar não cria depósito, transação,
reserva ou rendimento. A simulação conjunta F08 inclui esse aporte na data
escolhida e os mensais no calendário calculado. Dinheiro já guardado nunca é
somado uma segunda vez. Intenções passadas não são consideradas pagas.

O prazo da meta permanece uma referência real. **Prazo do plano** é a escolha
do cenário e não edita silenciosamente o cadastro da meta. Quando a previsão
ultrapassar o prazo da meta, a interface informa o desvio. Planos F08 existentes
mantêm o modo **Atual**, inclusive o corte no prazo da meta, até uma escolha
explícita de Por prazo/Por mês. Esse modo de compatibilidade só aparece para
planos legados; novos planos oferecem os dois modos de cálculo.

Resultado: data estimada, quantidades de contribuições, restante antes do
plano, mensal calculado e último aporte. Calendário resumido mostra primeiro,
segundo e último eventos com suas datas reais, sem enumerar milhões de meses.
Meta já atingida tem estado próprio, sem sugerir outro aporte. Zero, data
ausente, prazo sem nenhuma oportunidade e ano além de 9999 são explicados;
não produzem infinito, dinheiro fictício ou data inválida.

## Regras exatas

- Centavos inteiros seguros (0..9007199254740991), alvo positivo. Cálculo puro
  usa BigInt para divisão/teto/resto; servidor usa numeric/bigint.
- Datas civis estritas 0001..9999; dia da âncora preservado: 31/01 → último
  dia de fevereiro → 31/03. Não somar 30 dias nem ancorar no dia já encurtado.
- Contribuições mensais futuras incluem hoje; passadas são ignoradas, sem
  diminuir o guardado. O aporte inicial passado é ignorado e sinalizado.
- Inicial futuro aplica no máximo o restante, deve preceder ou coincidir com
  o primeiro mensal efetivo; em Por prazo também deve caber no prazo escolhido.
- Se inicial cobrir tudo, não exigir primeiro mensal; Por prazo ainda exige
  prazo. Contagem inclui inicial, mesmo quando coincide com um mensal.
- Por prazo: mensal = teto(restante após inicial / oportunidades inclusivas).
  Último = restante após inicial − mensal × (quantidade mensal − 1).
- Por mês: quantidade = teto(restante após inicial / mensal). O calendário
  determina a data; quantidade e datas não dependem do horizonte visível F08.
- Não impedir salvar um plano mensal válido porque o caixa fica negativo: a
  prévia mostra a pressão. Não salvar fontes incompletas ou fora do calendário.

## Contratos e compatibilidade

Domínio puro em `src/lib/goal-contribution.ts`: `calculateGoalContribution`,
`goalMonthOn` e `goalContributionAt`, com entrada fechada alvo/guardado/as_of,
modo monthly/deadline, monthly_cents/first_on/deadline_on e initial_cents/on.
Resultado fechado ready/reached/incomplete/unreachable/out_of_range, motivo,
restante/inicial aplicado/mensal/contagens/último/datas/âncora/offset e flags.
Zero e null têm papéis distintos; fonte inativa é null no contrato transportado.

Nova versão de RPC mantém os contratos F08 publicados:

```ts
type HorizonItem = {
  goal_id: string; included: boolean;
  mode: 'legacy' | 'monthly' | 'deadline';
  monthly_cents: number | null; first_on: string | null;
  deadline_on: string | null; initial_cents: number; initial_on: string | null;
};
// preview: { goals_fingerprint, items: HorizonItem[] }
// save: { workspace_id, expected_revision, goals_fingerprint, items }
// goal_planning_state_v2(...): { state: GoalPlanningStateDTO,
//   horizons: { item: HorizonItemDTO, result: GoalContributionResultDTO }[] }
// Dinheiro de resposta é string decimal, inclusive no item/result.
```

RPCs `save_goal_plan_v2` e `resolve_goal_plan_attempt_v2` usam o protocolo
selado F08, identidade UUID, locks por tentativa/espaço, CAS de revisão,
fingerprint dos alvos/guardados/prazos, lista exata de metas abertas e
conferência de membership. Repetição devolve o mesmo recibo antes do CAS;
mesma identidade com intenção diferente é recusada. Encerrar uma tentativa
sela cancelamento antes de uma escrita atrasada. Membership é exigido também
no replay. Nenhuma confirmação vem de recibo genérico gravável pelo cliente.

`goal_plan_items` recebe modo, prazo do plano e inicial/data; linhas existentes
ficam legacy/zero/null. Escrita antiga preserva campos omitidos se a fonte
mensal/data não mudou; alteração explícita da fonte antiga volta ao cálculo
legacy, conservando o inicial (omissão não limpa). Exclusão explícita limpa
todo o cenário daquela meta. Leituras antigas conservam seu DTO e passam a
refletir os valores do cenário novo; não fingem que um inicial não existe.

A projeção reutiliza a leitura F08 de caixa/reservas sem intenções e sobrepõe
somente o calendário do plano. Usa a régua civil/ciclo já existente. Não
reescreve faturas, receita, dívida ou patrimônio. Helper legado mantém
assinatura e comportamento para testes/clientes antigos.

## Interface e referências

Reutilizar GoalPlanSheet, TaskHeader, SheetScroll, Field/MoneyField,
DatePickerField, Segmented, Row/Section, Money, Presenca e tokens existentes.
Extrair os campos e o resultado por meta em componente próprio. O estado
permanece no editor acima dos painéis responsivos; render não reinicia MoneyField
nem força foco. Movimento costura troca de modo/resultado, respeita Reduce
Motion e nunca interpola números financeiros. Privacidade cobre valores,
datas de conclusão e cronograma sensível. Texto grande deve quebrar linhas.

Referências funcionais: [YNAB — metas](https://www.ynab.com/features/goal-tracking)
para contribuição por período/data e progresso; [Monzo — Pots](https://monzo.com/help/budgeting-overdrafts-savings/what-is-a-pot)
para separar dinheiro por intenção. Composição, tipografia e animação seguem
`PRODUCT.md`/`DESIGN.md` Papel e Tinta; não copiar identidade desses produtos.

## Aceite e limites

Antes de F11: domínio e DTOs, controlador selado, hooks e JSX reais; SQL
calendário/compatibilidade/isolamento/replay/resolução/conflito; comparação
TS↔SQL; typecheck/lint e suite global tocada; migration nova revisada/aplicada
só no staging e tipos regenerados. Matriz real iOS e Android: dois modos,
zero/resto, inicial, calendário 31, cancelamento, persistência/leitura cruzada,
privacidade e fonte grande/temas/movimento reduzido. Conferir saldos e ledgers
sem mutação financeira, restaurar somente fixtures identificadas e registrar
evidências/limites. ANR F07 continua aberta; nenhum aceite F10 declara sua cura.
