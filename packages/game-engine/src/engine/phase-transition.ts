import type { DomainEvent, EngineError, GameState, Phase, PlayerState } from '@guildmaster/game-protocol';
import { dispatchLifecycle } from '../effects/lifecycle-dispatcher.js';
import { nextSeat } from '../model/seats.js';
import type { Ruleset } from '../rules/ruleset.js';
import { createTurnFactLedger } from './create-game.js';
import { settleRest } from './rest-settlement.js';

type Callback = (state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string) => EngineError | undefined;
function boundary(state: GameState, ruleset: Ruleset, point: 'turn-start' | 'turn-end' | 'phase-start' | 'phase-end' | 'game-end-evaluation', actorId: string, events: DomainEvent[]): EngineError | undefined {
  const result = dispatchLifecycle(state, ruleset, { schemaVersion: 1, point, actorId, phase: state.phase }, { controllerId: actorId }); events.push(...result.events);
  return result.status === 'completed' ? undefined : { code: 'INVALID_COMMAND', message: `${point} lifecycle must complete within the current transition; ${result.error ?? result.reason ?? 'a suspension is not yet supported at this boundary'}.` };
}
export function applyPhaseTransition(state: GameState, ruleset: Ruleset, player: PlayerState, phase: Phase, events: DomainEvent[], commandId: string, completeBonds: Callback, checkEnd: Callback): EngineError | undefined {
  if (phase !== state.phase) return { code: 'INVALID_COMMAND', message: '指令階段與目前階段不一致。' };
  const phaseEndError = boundary(state, ruleset, 'phase-end', player.id, events); if (phaseEndError) return phaseEndError;
  if (state.phase !== 'rest') {
    const next: Record<Exclude<Phase, 'rest'>, Phase> = { action1: 'combat', combat: 'action2', action2: 'purchase', purchase: 'rest' };
    if (state.phase === 'combat' && !state.turnFacts?.combatResolved) state.turnFacts!.combatSkipped = true;
    state.phase = next[state.phase]; events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'PHASE_ENDED', message: `${player.name} 結束階段。`, causedByCommandId: commandId });
    return boundary(state, ruleset, 'phase-start', player.id, events);
  }
  settleRest(state, ruleset, player, events, commandId);
  const turnEndError = boundary(state, ruleset, 'turn-end', player.id, events); if (turnEndError) return turnEndError;
  const bondError = completeBonds(state, ruleset, player, events, commandId); if (bondError) return bondError;
  const endError = checkEnd(state, ruleset, player, events, commandId); if (endError) return endError;
  if (state.status === 'finalRound' && state.endState?.finalRoundEndPlayerId === player.id) {
    state.status = 'finished'; events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'GAME_FINISHED', message: '目前輪次已完成，遊戲結束。', causedByCommandId: commandId });
    return boundary(state, ruleset, 'game-end-evaluation', player.id, events);
  }
  const following = nextSeat(state.players, player.id); state.activePlayerId = following.id; state.phase = 'action1'; state.turnFacts = createTurnFactLedger(following.id);
  if (following.id === state.startingPlayerId) state.round += 1;
  const turnStartError = boundary(state, ruleset, 'turn-start', following.id, events); return turnStartError ?? boundary(state, ruleset, 'phase-start', following.id, events);
}
