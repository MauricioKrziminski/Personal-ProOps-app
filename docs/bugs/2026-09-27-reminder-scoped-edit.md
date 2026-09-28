# Edição de ocorrência de lembrete recorrente

## Reprodução no código anterior

1. Abrir um lembrete com `recurrence = FREQ=DAILY` pelo id.
2. Mudar título, data ou hora e tocar **Salvar**.
3. `reminder-form.tsx` chamava `useSaveReminder` sem escopo. `use-items.ts` fazia `update` da única linha em `reminders`, incluindo `recurrence` e `next_run_at`; nenhum diálogo ou registro de exceção existia.
4. `agent/app/jobs/reminders.py` entregava essa mesma linha e calculava a próxima ocorrência com a regra e o `next_run_at` já alterados. Portanto a edição mudava a série inteira em silêncio.

O teste `test_replaced_occurrence_advances_series_without_delivery` falhou antes da correção: o job entregou `series`, embora essa ocorrência devesse ser substituída. Após a correção, ele avança a regra sem enviar o original; o lembrete único editado segue o fluxo normal de entrega e tentativa.

## Dia numérico em meses curtos

O job usa `app.domain.recurrence.next_occurrence` para avançar tanto lembretes novos quanto séries já gravadas. Uma RRULE isolada `BYMONTHDAY=29`, `30` ou `31` mantém o número no banco e, na expansão, cai no último dia disponível quando o mês é curto. `BYMONTHDAY=-1` continua sendo a escolha explícita de último dia; regras com vários dias preservam a semântica original da lista.

O formulário também grava o dia numérico quando a pessoa escolhe repetição mensal sem marcar um chip de dia e a data escolhida é 29, 30 ou 31. Para séries antigas com `FREQ=MONTHLY` sem `BYMONTHDAY`, o job deduz o número do próximo disparo no fuso do lembrete e grava o dia explícito no primeiro avanço. Assim, depois de ajustar fevereiro para 28/29, março volta ao número escolhido. Se uma série antiga já estiver no fim de um mês curto e não tiver o dia original registrado, esse número anterior não pode ser reconstruído com certeza apenas a partir da linha do lembrete.

`test_reminder_calendar.py` percorre o job entre janeiro, fevereiro e março/abril, incluindo fevereiro bissexto, intervalo de dois meses, `-1` e lista de dias. Com a normalização de RRULE desativada apenas na execução do teste, o caso `BYMONTHDAY=29` falhou: retornou 29/03/2027 em vez de 28/02/2027. Com o código atual, a suíte focada passou. O formulário agora descreve o ajuste dos dias numéricos sem afirmar que fevereiro é ignorado.

Antes do ajuste para regras mensais sem `BYMONTHDAY`, o teste de job com `FREQ=MONTHLY` e próximo envio em 31/01/2027 também falhou: calculou 31/03/2027 em vez de 28/02/2027. O teste atualizado verifica que o job grava `BYMONTHDAY=31` e volta a 31/03 após fevereiro.

## Limites de verificação

A migração e `supabase/tests/reminder_scoped_edits.sql` são verificados no Postgres local em transação descartável. A interação e a apresentação no emulador são verificadas pela validação de dispositivo da tarefa principal. O modelo antigo não guardava histórico individual dos disparos normais da RRULE; a edição futura preserva linhas anteriores de exceções já concluídas.
