import type { CommandEnvelope, DomainEvent, EngineError, GameState, Phase, PlayerState } from '@guildmaster/game-protocol';
import { dispatchLifecycle } from '../effects/lifecycle-dispatcher.js';
import { nextSeat } from '../model/seats.js';
import type { Ruleset } from '../rules/ruleset.js';
import { createTurnFactLedger } from './create-game.js';
import { settleRest } from './rest-settlement.js';

type Callback = (state: GameState, ruleset: Ruleset, player: PlayerState, events: DomainEvent[], commandId: string) => EngineError | undefined;
export type PhaseTransitionCursor = 'after-phase-end' | 'complete-nonrest' | 'after-turn-end' | 'complete-game-end' | 'after-turn-start' | 'complete-turn-start';
type BoundaryResult = { status: 'completed' } | { status: 'suspended' } | { status: 'failed'; error: EngineError };
function boundary(state: GameState, ruleset: Ruleset, point: 'turn-start' | 'turn-end' | 'phase-start' | 'phase-end' | 'game-end-evaluation', actorId: string, events: DomainEvent[]): BoundaryResult {
  const result = dispatchLifecycle(state, ruleset, { schemaVersion: 1, point, actorId, phase: state.phase }, { controllerId: actorId }); events.push(...result.events);
  if (result.status === 'completed') return { status: 'completed' };
  if (result.status === 'suspended') return { status: 'suspended' };
  return { status: 'failed', error: { code: 'INVALID_COMMAND', message: `${point} lifecycle failed: ${result.error ?? result.reason ?? 'unknown lifecycle failure'}.` } };
}
function suspend(state: GameState, envelope: CommandEnvelope, rollbackState: GameState, resolutionEnvelopes: readonly CommandEnvelope[], events: DomainEvent[], factStart: number, cursor: PhaseTransitionCursor): void {
  if (envelope.command.type !== 'END_PHASE') throw new Error('Phase transition continuation requires END_PHASE.');
  state.effectState.pendingCommand = { schemaVersion: 1, kind: 'phase-transition', envelope: structuredClone(envelope) as CommandEnvelope & { command: Extract<CommandEnvelope['command'], { type: 'END_PHASE' }> }, resolutionEnvelopes: structuredClone(resolutionEnvelopes), events: structuredClone(events), rollbackState: structuredClone(rollbackState), factStart, cursor };
}
export function applyPhaseTransition(state: GameState, ruleset: Ruleset, player: PlayerState, phase: Phase, events: DomainEvent[], envelope: CommandEnvelope, rollbackState: GameState, factStart: number, completeBonds: Callback, checkEnd: Callback, start: 'phase-end' | PhaseTransitionCursor = 'phase-end', resolutionEnvelopes: readonly CommandEnvelope[] = []): EngineError | undefined {
  if (start === 'phase-end' && phase !== state.phase) return { code: 'INVALID_COMMAND', message: '指令階段與目前階段不一致。' };
  const commandId = envelope.commandId;
  let cursor = start;
  while (true) {
    if (cursor === 'phase-end') {
      const result = boundary(state, ruleset, 'phase-end', player.id, events);
      if (result.status === 'failed') return result.error;
      if (result.status === 'suspended') { suspend(state, envelope, rollbackState, resolutionEnvelopes, events, factStart, 'after-phase-end'); return undefined; }
      cursor = 'after-phase-end';
    }
    if (cursor === 'after-phase-end') {
      if (state.phase !== 'rest') {
        const next: Record<Exclude<Phase, 'rest'>, Phase> = { action1: 'combat', combat: 'action2', action2: 'purchase', purchase: 'rest' };
        if (state.phase === 'combat' && !state.turnFacts?.combatResolved) state.turnFacts!.combatSkipped = true;
        state.phase = next[state.phase]; events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'PHASE_ENDED', message: `${player.name} 結束階段。`, causedByCommandId: commandId });
        const result = boundary(state, ruleset, 'phase-start', player.id, events);
        if (result.status === 'failed') return result.error;
        if (result.status === 'suspended') suspend(state, envelope, rollbackState, resolutionEnvelopes, events, factStart, 'complete-nonrest');
        return undefined;
      }
      const restError = settleRest(state, ruleset, player, events, commandId);
      if (restError) return restError;
      const result = boundary(state, ruleset, 'turn-end', player.id, events);
      if (result.status === 'failed') return result.error;
      if (result.status === 'suspended') { suspend(state, envelope, rollbackState, resolutionEnvelopes, events, factStart, 'after-turn-end'); return undefined; }
      cursor = 'after-turn-end';
    }
    if (cursor === 'after-turn-end') {
      const bondError = completeBonds(state, ruleset, player, events, commandId); if (bondError) return bondError;
      const endError = checkEnd(state, ruleset, player, events, commandId); if (endError) return endError;
      if (state.status === 'finalRound' && state.endState?.finalRoundEndPlayerId === player.id) {
        const result = boundary(state, ruleset, 'game-end-evaluation', player.id, events);
        if (result.status === 'failed') return result.error;
        if (result.status === 'suspended') { suspend(state, envelope, rollbackState, resolutionEnvelopes, events, factStart, 'complete-game-end'); return undefined; }
        cursor = 'complete-game-end';
      } else {
        const following = nextSeat(state.players, player.id); state.activePlayerId = following.id; state.phase = 'action1'; state.turnFacts = createTurnFactLedger(following.id);
        if (following.id === state.startingPlayerId) state.round += 1;
        const result = boundary(state, ruleset, 'turn-start', following.id, events);
        if (result.status === 'failed') return result.error;
        if (result.status === 'suspended') { suspend(state, envelope, rollbackState, resolutionEnvelopes, events, factStart, 'after-turn-start'); return undefined; }
        cursor = 'after-turn-start';
      }
    }
    if (cursor === 'after-turn-start') {
      const following = state.players.find(({ id }) => id === state.activePlayerId)!;
      const result = boundary(state, ruleset, 'phase-start', following.id, events);
      if (result.status === 'failed') return result.error;
      if (result.status === 'suspended') suspend(state, envelope, rollbackState, resolutionEnvelopes, events, factStart, 'complete-turn-start');
      return undefined;
    }
    if (cursor === 'complete-game-end') {
      state.status = 'finished'; events.push({ eventId: `event-${state.revision + 1}-${events.length + 1}`, revision: state.revision + 1, type: 'GAME_FINISHED', message: '目前輪次已完成，遊戲結束。', causedByCommandId: commandId });
      return undefined;
    }
    if (cursor === 'complete-nonrest' || cursor === 'complete-turn-start') return undefined;
  }
}
