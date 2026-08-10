import { DiceRollEvaluationSchema, type DiceRollEvaluation, type DiceRollInput, type GameState } from '@guildmaster/game-protocol';
import type { Ruleset } from './ruleset.js';
import { validateRulesetStateCompatibility } from './ruleset-compatibility.js';

export type DiceRollResult = { status: 'ready'; evaluation: DiceRollEvaluation } | { status: 'failed'; reason: 'INVALID_INPUT' | 'UNKNOWN_MODULE' | 'UNKNOWN_DIE' | 'REGISTRY_VERSION_MISMATCH'; error: string };
export function evaluateDiceRoll(state: GameState, ruleset: Ruleset, input: DiceRollInput): DiceRollResult {
  if (!Number.isFinite(input.randomValue) || input.randomValue < 0 || input.randomValue >= 1) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Dice roll random value must be in [0, 1).' };
  const registry = { rulesetVersion: state.rulesetVersion, modules: ruleset.modules.map(({ id, version }) => ({ id, version })) };
  const compatibility = validateRulesetStateCompatibility(state, ruleset);
  if (compatibility || JSON.stringify(input.registry) !== JSON.stringify(registry)) return { status: 'failed', reason: 'REGISTRY_VERSION_MISMATCH', error: compatibility ?? 'Dice registry fingerprint mismatch.' };
  const module = ruleset.modules.find(({ id }) => id === input.moduleId);
  if (!module) return { status: 'failed', reason: 'UNKNOWN_MODULE', error: `Unknown dice module: ${input.moduleId}.` };
  const die = (module.diceDefinitions ?? []).find(({ diceId }) => diceId === input.diceId);
  if (!die) return { status: 'failed', reason: 'UNKNOWN_DIE', error: `Unknown dice definition: ${input.moduleId}/${input.diceId}.` };
  const evaluation: DiceRollEvaluation = { schemaVersion: 1, input: structuredClone(input), face: Math.floor(input.randomValue * die.sides) + 1 };
  if (!DiceRollEvaluationSchema.safeParse(evaluation).success) return { status: 'failed', reason: 'INVALID_INPUT', error: 'Invalid dice evaluation.' };
  return { status: 'ready', evaluation };
}
