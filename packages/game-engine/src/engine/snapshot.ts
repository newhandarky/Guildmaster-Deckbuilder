import { GameStateSchema, SnapshotEnvelopeSchema, type GameState, type VersionedSnapshot } from '@guildmaster/game-protocol';
import { baseZoneIds } from '../model/zones.js';
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
  if (envelope.contentPacks.some((pack, index) => pack.hash !== envelope.state.contentPacks[index]?.hash)) throw new Error('Snapshot content manifest mismatch.');
  const state = structuredClone(envelope.state) as GameState; state.effectState ??= {};
  const pending = state.effectState.pendingLifecycle;
  if (pending) {
    const rollbackState = GameStateSchema.parse(pending.rollbackState) as GameState;
    if (rollbackState.gameId !== state.gameId || rollbackState.rulesetVersion !== pending.registry.rulesetVersion || rollbackState.effectState.pendingChoice || rollbackState.effectState.pendingLifecycle) throw new Error('Invalid lifecycle rollback checkpoint.');
    pending.rollbackState = structuredClone(rollbackState);
  }
  return state;
}
