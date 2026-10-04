import { normalizeGoalHorizonInput, type GoalHorizonInput } from './goal-horizon.ts';
import { createGoalPlanCommandController } from './goal-plan-save.ts';

export function createGoalHorizonSaveController(
  send: (input: GoalHorizonInput, requestId: string) => Promise<unknown>, newId: () => string,
  publish?: (input: GoalHorizonInput | null) => void,
  resolveAttempt?: (input: GoalHorizonInput, requestId: string) => Promise<unknown>,
) {
  return createGoalPlanCommandController(send, newId, normalizeGoalHorizonInput, publish, resolveAttempt);
}
