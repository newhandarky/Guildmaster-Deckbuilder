import type { BondCompletionTiming, DomainEvent, EngineError, GameCommand, GameState, PlayerState } from '@guildmaster/game-protocol';
import { previousSeat } from '../model/seats.js';
import { bondCompletionTimingFor, evaluateBondCondition } from '../rules/bond-condition-evaluator.js';
import { getEndConditions, type Ruleset } from '../rules/ruleset.js';

function event(state: GameState, events: DomainEvent[], type: string, message: string, commandId: string): void {
  events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type, message, causedByCommandId: commandId });
}

export function checkEndConditions(state: GameState, ruleset: Ruleset, events: DomainEvent[], commandId: string): void {
  if (state.status !== 'playing' && state.status !== 'finalRound') return;
  const conditionIds = getEndConditions(ruleset, state);
  if (!conditionIds.length) return;
  if (state.status === 'finalRound' && state.endState) {
    state.endState.conditionIds = [...new Set([...(state.endState.conditionIds ?? [state.endState.conditionId]), ...conditionIds])];
    return;
  }
  const conditionId = conditionIds[0]!;
  const finalRoundEndPlayerId = previousSeat(state.players, state.startingPlayerId).id;
  state.status = 'finalRound';
  state.endState = { conditionId, conditionIds, finalRoundEndPlayerId, triggeredAtRevision: state.revision + 1 };
  event(state, events, 'FINAL_ROUND_TRIGGERED', '已觸發遊戲結束，將完成目前輪次。', commandId);
}

export function applyBondCompletion(state: GameState, player: PlayerState, ruleset: Ruleset, command: Extract<GameCommand, { type: 'COMPLETE_BONDS' }>, events: DomainEvent[], commandId: string): EngineError | undefined {
  if (new Set(command.bondIds).size !== command.bondIds.length) return { code: 'INVALID_COMMAND', message: '羈絆完成清單不可重複。' };
  const resolved = command.bondIds.map((bondId) => {
    const owned = player.bonds.find((bond) => bond.bondId === bondId);
    const definition = ruleset.registry.bonds.find((bond) => bond.id === bondId);
    if (!owned || !definition || owned.completed) return { error: `羈絆 ${bondId} 不可完成。` } as const;
    const timing = bondCompletionTimingFor(ruleset, bondId);
    if (timing !== 'state' && (state.pendingBondCompletion?.playerId !== player.id || state.pendingBondCompletion.timing !== timing || !state.pendingBondCompletion.bondIds.includes(bondId))) return { error: `羈絆 ${bondId} 的完成時機已過。` } as const;
    const evaluation = evaluateBondCondition(state, ruleset, player.id, bondId);
    if (evaluation.status !== 'ready') return { error: evaluation.error } as const;
    if (!evaluation.evaluation.satisfied) return { error: `羈絆 ${bondId} 的條件目前未成立。` } as const;
    return { owned, definition } as const;
  });
  const invalid = resolved.find((candidate) => 'error' in candidate);
  if (invalid && 'error' in invalid) return { code: 'INVALID_COMMAND', message: invalid.error };
  delete state.pendingBondCompletion;
  for (const candidate of resolved) {
    if ('error' in candidate) continue;
    candidate.owned.completed = true;
    event(state, events, 'BOND_COMPLETED', `${player.name} 完成羈絆：${candidate.definition.name}。`, commandId);
  }
  checkEndConditions(state, ruleset, events, commandId);
  return undefined;
}

export function openBondCompletionOpportunity(state: GameState, ruleset: Ruleset, playerId: string, timing: Exclude<BondCompletionTiming, 'state'>, opportunityId: string): void {
  const player = state.players.find(({ id }) => id === playerId);
  if (!player) throw new Error(`Unknown bond completion opportunity player: ${playerId}.`);
  const bondIds = player.bonds.filter(({ completed, bondId }) => {
    if (completed || bondCompletionTimingFor(ruleset, bondId) !== timing) return false;
    const evaluation = evaluateBondCondition(state, ruleset, playerId, bondId);
    return evaluation.status === 'ready' && evaluation.evaluation.satisfied;
  }).map(({ bondId }) => bondId);
  if (!bondIds.length) return;
  state.pendingBondCompletion = { schemaVersion: 1, opportunityId, playerId, timing, bondIds };
}
