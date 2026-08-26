/**
 * Expansão de RRULE no calendário do usuário.
 *
 * O rrule.js trabalha com os componentes UTC da Date, então rodamos a regra
 * sobre horas de parede ("naive": a hora local do usuário fingindo ser UTC) e
 * convertemos o resultado de volta para instante. Sem isso, "todo dia 5" cai no
 * dia 5 em UTC — que para quem está em GMT-3 pode ser dia 4 às 21h.
 */

import { RRule } from "https://esm.sh/rrule@2.8.1";

import { fromNaive, toNaive } from "./datetime.ts";

/**
 * Próxima ocorrência depois de `after` (exclusive).
 * `dtstart` ancora a série: passe o `next_run_at` atual para preservar a hora
 * original. Sem âncora, o rrule usa "agora" e a hora do lembrete passa a ser o
 * minuto em que o cron rodou.
 */
export function nextOccurrence(
  recurrence: string | null,
  after: Date,
  timezone: string,
  dtstart?: Date,
): Date | null {
  if (!recurrence) return null;
  try {
    const options = RRule.parseString(
      recurrence.startsWith("RRULE:") ? recurrence : `RRULE:${recurrence}`,
    );
    options.dtstart = toNaive(dtstart ?? after, timezone);
    const next = new RRule(options).after(toNaive(after, timezone), false);
    return next ? fromNaive(next, timezone) : null;
  } catch (err) {
    console.error("RRULE inválida:", recurrence, err);
    return null;
  }
}
