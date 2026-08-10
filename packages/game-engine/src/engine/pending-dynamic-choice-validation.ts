import type { GameState } from '@guildmaster/game-protocol';
import { validatePendingChoiceAgainstEffect } from '../effects/executor.js';
import type { Ruleset } from '../rules/ruleset.js';
import { validatePendingCardUseContinuation } from './card-use-effect-pipeline.js';
import { validatePendingCombatRewardContinuation } from './combat-reward-pipeline.js';

/**
 * Validates a dynamic choose-card suspension against its registered effect.
 * Static choices have no source and remain valid without this extra lookup.
 */
export function validatePendingDynamicCardChoice(state: GameState, ruleset: Ruleset): string | undefined {
  const choice = state.effectState.pendingChoice;
  if (!choice?.source) return undefined;
  const lifecycle = state.effectState.pendingLifecycle;
  if (lifecycle) {
    const hook = ruleset.modules
      .find(({ id }) => id === lifecycle.currentHook.moduleId)
      ?.lifecycleHooks?.find(({ hookId }) => hookId === lifecycle.currentHook.hookId);
    return hook
      ? validatePendingChoiceAgainstEffect(choice, hook.effect, state, ruleset)
      : 'Pending dynamic card choice references an unknown lifecycle hook.';
  }
  const command = state.effectState.pendingCommand;
  if (command?.kind === 'card-use-effect') return validatePendingCardUseContinuation(state, ruleset);
  if (command?.kind === 'combat-reward') return validatePendingCombatRewardContinuation(state, ruleset);
  return 'Pending dynamic card choice has no registered continuation.';
}
