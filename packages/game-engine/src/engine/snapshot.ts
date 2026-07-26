import { SnapshotEnvelopeSchema, type GameState, type VersionedSnapshot } from '@guildmaster/game-protocol';

export function serializeSnapshot(state: GameState): VersionedSnapshot {
  return { schemaVersion: 1, engineVersion: state.engineVersion, rulesetVersion: state.rulesetVersion, state: structuredClone(state) };
}

export function restoreSnapshot(snapshot: VersionedSnapshot): GameState {
  const envelope = SnapshotEnvelopeSchema.parse(snapshot);
  if (envelope.schemaVersion !== 1) throw new Error('Unsupported snapshot schema.');
  return structuredClone(snapshot.state);
}
