import type { CommandEnvelope, DomainEvent, EngineResult, GameState } from '@guildmaster/game-protocol';
import { getPlayer } from '../model/factories.js';
import { nextSeat } from '../model/seats.js';
import type { Ruleset } from '../rules/ruleset.js';
import { dispatchLifecycle } from '../effects/lifecycle-dispatcher.js';
import { createTurnFactLedger } from './create-game.js';

export function dispatchBondSetup(state: GameState, ruleset: Ruleset, envelope: CommandEnvelope): EngineResult {
  const fail = (code: 'INVALID_COMMAND' | 'NOT_AUTHORIZED', message: string): EngineResult => ({ state, events: [], error: { code, message } });
  if (envelope.command.type !== 'SELECT_BONDS') return fail('INVALID_COMMAND', '必須先完成羈絆保留選擇。');
  const setup = state.bondSetup;
  if (!setup || setup.currentActorId !== envelope.actorId || state.activePlayerId !== envelope.actorId) return fail('NOT_AUTHORIZED', '目前不是此玩家的羈絆選擇。');
  const command = envelope.command; const offer = setup.offers[envelope.actorId] ?? [];
  if (command.offerId !== setup.offerId || command.bondIds.length !== 5 || new Set(command.bondIds).size !== 5 || command.bondIds.some((bondId) => !offer.includes(bondId) || !ruleset.registry.bonds.some(({ id }) => id === bondId))) return fail('INVALID_COMMAND', '羈絆選擇必須是本玩家 offer 中不重複的五張。');
  const nextState = structuredClone(state); const nextSetup = nextState.bondSetup!; const player = getPlayer(nextState, envelope.actorId);
  player.bonds = command.bondIds.map((bondId) => ({ bondId, completed: false })); nextSetup.completedPlayerIds.push(player.id);
  const events: DomainEvent[] = [{ eventId: `event-${state.revision + 1}-1`, revision: state.revision + 1, type: 'BONDS_SELECTED', message: `${player.name} 已保留五張羈絆。`, causedByCommandId: envelope.commandId }];
  if (nextSetup.completedPlayerIds.length === nextState.players.length) {
    nextState.status = 'playing'; nextState.activePlayerId = nextState.startingPlayerId; nextState.turnFacts = createTurnFactLedger(nextState.activePlayerId); delete nextState.bondSetup;
    events.push({ eventId: `event-${state.revision + 1}-2`, revision: state.revision + 1, type: 'BOND_SETUP_FINISHED', message: '所有玩家已完成羈絆設置。', causedByCommandId: envelope.commandId });
    const startIndex = nextState.players.findIndex(({ id }) => id === nextState.startingPlayerId);
    const seatOrder = Array.from(
      { length: nextState.players.length },
      (_, offset) => nextState.players[(startIndex + offset) % nextState.players.length]!.id,
    );
    const lifecycle = dispatchLifecycle(
      nextState,
      ruleset,
      { schemaVersion: 1, point: 'game-start', actorId: nextState.startingPlayerId, phase: nextState.phase },
      {
        controllerId: nextState.startingPlayerId,
        playerRefs: Object.fromEntries(
          Array.from({ length: 4 }, (_, index) => [`draftPlayer${index}`, seatOrder[index] ?? seatOrder.at(-1)!]),
        ),
      },
    );
    if (lifecycle.status === 'failed' || lifecycle.status === 'unsupported') {
      return fail('INVALID_COMMAND', `Game-start lifecycle failed: ${lifecycle.error ?? lifecycle.reason ?? 'unknown lifecycle failure'}.`);
    }
    events.push(...lifecycle.events);
  } else {
    const next = nextSeat(nextState.players, player.id); nextSetup.currentActorId = next.id; nextState.activePlayerId = next.id; nextState.turnFacts = createTurnFactLedger(next.id);
  }
  nextState.revision += 1; nextState.eventLogCursor += events.length;
  return { state: nextState, events };
}
