import { GameStateSchema, SnapshotEnvelopeSchema, type GameState, type VersionedSnapshot } from '@guildmaster/game-protocol';
import { baseZoneIds } from '../model/zones.js';
import { validatePostCommandContinuationState } from './post-command-pipeline.js';
export function serializeSnapshot(state: GameState): VersionedSnapshot { return { schemaVersion: 2, engineVersion: state.engineVersion, rulesetVersion: state.rulesetVersion, contentPacks: structuredClone(state.contentPacks), rulesModules: structuredClone(state.rulesModules), state: structuredClone(state) }; }
function migrateV1(snapshot: Record<string, unknown>): unknown {
  const state = snapshot.state as Record<string, unknown>; const shared = state.sharedZones as Record<string, string[]>;
  if (!state || !shared) throw new Error('Unsupported snapshot schema.');
  const zoneMap: Record<string, string> = { adventurerDeck: baseZoneIds.adventurerDeck, adventurerRow: baseZoneIds.adventurerRow, itemDeck: baseZoneIds.itemDeck, itemRow: baseZoneIds.itemRow, monsterDeck: baseZoneIds.monsterDeck, monsterRow: baseZoneIds.monsterRow, bossDeck: baseZoneIds.bossDeck, bossRow: baseZoneIds.bossRow };
  const zones = Object.fromEntries(Object.entries(zoneMap).map(([legacy, zoneId]) => [zoneId, { zoneId, kind: legacy.endsWith('Deck') ? 'orderedDeck' : legacy === 'bossRow' ? 'singleSlot' : 'faceUpRow', cardIds: shared[legacy] ?? [], visibility: 'public', rulesModuleId: 'base:rules' }]));
  const players = ((state.players as Record<string, unknown>[]) ?? []).map((player) => ({ ...player, counters: [], moduleState: {} }));
  const enemyTargets = Object.fromEntries(Object.entries((state.enemyTargets as Record<string, Record<string, unknown>>) ?? {}).map(([id, target]) => [id, { ...target, parentEncounterId: 'base:enemies', zoneId: target.kind === 'boss' ? baseZoneIds.bossRow : baseZoneIds.monsterRow, attachments: [], moduleState: {} }]));
  const enemyEncounters = ((state.enemyEncounters as Record<string, unknown>[]) ?? []).map((encounter) => ({ ...encounter, status: 'active', rulesModuleId: 'base:rules', state: {} }));
  const migratedState: Record<string, unknown> = { ...state, schemaVersion: 2, engineVersion: '0.2.0', rulesetVersion: '0.2.0', players, zones, enemyTargets, enemyEncounters }; delete migratedState.sharedZones;
  return { schemaVersion: 2, engineVersion: migratedState.engineVersion, rulesetVersion: migratedState.rulesetVersion, contentPacks: migratedState.contentPacks, rulesModules: migratedState.rulesModules, state: migratedState };
}
export function restoreSnapshot(snapshot: unknown): GameState {
  const raw = snapshot as Record<string, unknown>; const migrated = raw.schemaVersion === 1 ? migrateV1(raw) : raw; const envelope = SnapshotEnvelopeSchema.parse(migrated);
  if (envelope.engineVersion !== envelope.state.engineVersion || envelope.rulesetVersion !== envelope.state.rulesetVersion) throw new Error('Snapshot engine or ruleset version mismatch.');
  if (JSON.stringify(envelope.contentPacks) !== JSON.stringify(envelope.state.contentPacks)) throw new Error('Snapshot content manifest mismatch.');
  if (JSON.stringify(envelope.rulesModules) !== JSON.stringify(envelope.state.rulesModules)) throw new Error('Snapshot Rules Module manifest mismatch.');
  const state = structuredClone(envelope.state) as GameState; state.effectState ??= {};
  const pending = state.effectState.pendingLifecycle;
  if (pending) {
    const rollbackState = GameStateSchema.parse(pending.rollbackState) as GameState;
    const rollbackEffects = rollbackState.effectState;
    const stateRegistry = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
    if (rollbackState.gameId !== state.gameId || JSON.stringify(pending.registry) !== JSON.stringify(stateRegistry) || rollbackState.engineVersion !== state.engineVersion || JSON.stringify(rollbackState.contentPacks) !== JSON.stringify(state.contentPacks) || JSON.stringify(rollbackState.rulesModules) !== JSON.stringify(state.rulesModules) || rollbackEffects.pendingChoice || rollbackEffects.pendingLifecycle || rollbackEffects.pendingCommand || rollbackEffects.pendingPostCommand) throw new Error('Invalid lifecycle rollback checkpoint.');
    pending.rollbackState = structuredClone(rollbackState);
  }
  const command = state.effectState.pendingCommand;
  if (command) {
    const choice = state.effectState.pendingChoice;
    const executionId = pending ? `${pending.dispatchId}:${pending.currentHook.moduleId}:${pending.currentHook.hookId}` : '';
    if (!pending || !choice || state.effectState.pendingPostCommand || command.envelope.gameId !== state.gameId || command.envelope.actorId !== state.activePlayerId || command.envelope.expectedRevision !== state.revision || pending.payload.point !== 'command-before' || pending.context.controllerId !== command.envelope.actorId || choice.actorId !== command.envelope.actorId || choice.executionId !== executionId || JSON.stringify(choice.context) !== JSON.stringify(pending.context)) throw new Error('Invalid command-before continuation.');
  }
  const outer = state.effectState.pendingPostCommand;
  if (outer) {
    outer.rollbackState = structuredClone(GameStateSchema.parse(outer.rollbackState) as GameState);
    const error = validatePostCommandContinuationState(state);
    if (error) throw new Error(error);
  }
  if (pending && !state.effectState.pendingChoice) throw new Error('Pending lifecycle dispatch has no matching choice.');
  if (!pending && (command || outer)) throw new Error('Outer continuation has no matching lifecycle dispatch.');
  return state;
}
