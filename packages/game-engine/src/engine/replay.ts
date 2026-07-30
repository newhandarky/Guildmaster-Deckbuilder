import { ReplayBundleSchema, isFiniteJsonValue, stableJsonFingerprint, type ReplayBundle, type ReplayDiagnostic, type ReplayRegistryFingerprint, type ReplayResult } from '@guildmaster/game-protocol';
import { createGame } from './create-game.js';
import { dispatch } from './dispatch.js';
import { serializeSnapshot } from './snapshot.js';
import type { Ruleset } from '../rules/ruleset.js';

const engineVersion = '0.2.0';
const rulesetVersion = '0.2.0';

export function replayRegistryFingerprint(ruleset: Ruleset): ReplayRegistryFingerprint {
  return {
    engineVersion,
    rulesetVersion,
    contentPacks: ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash })),
    rulesModules: ruleset.modules.map(({ id, version, config }) => ({ id, version, configFingerprint: stableJsonFingerprint(config ?? {}) }))
  };
}

function diagnostic(reasonCode: ReplayDiagnostic['reasonCode'], message: string, extra: Omit<ReplayDiagnostic, 'reasonCode' | 'message'> = {}): ReplayDiagnostic {
  return { reasonCode, message, ...extra };
}

export function validateReplayBundleAgainstRuleset(bundle: unknown, ruleset: Ruleset): { bundle?: ReplayBundle; diagnostic?: ReplayDiagnostic } {
  if (!isFiniteJsonValue(bundle)) return { diagnostic: diagnostic('MALFORMED_BUNDLE', 'Replay bundle must contain finite, acyclic plain JSON data only.') };
  const parsed = ReplayBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    const unknownVersion = typeof bundle === 'object' && bundle !== null && ('schemaVersion' in bundle || 'protocolVersion' in bundle)
      && ((bundle as Record<string, unknown>).schemaVersion !== 1 || (bundle as Record<string, unknown>).protocolVersion !== 1);
    return { diagnostic: diagnostic(unknownVersion ? 'UNKNOWN_REPLAY_VERSION' : 'MALFORMED_BUNDLE', parsed.error.issues[0]?.message ?? 'Replay bundle is malformed.') };
  }
  const expected = replayRegistryFingerprint(ruleset);
  if (JSON.stringify(parsed.data.registry) !== JSON.stringify(expected)) return { diagnostic: diagnostic('REGISTRY_MISMATCH', 'Replay registry fingerprint does not match the active ruleset.', { expected: parsed.data.registry, actual: expected }) };
  return { bundle: structuredClone(parsed.data) as ReplayBundle };
}

/** Rebuilds state exclusively through createGame and the authoritative dispatch path. */
export function replayGame(bundle: unknown, ruleset: Ruleset): ReplayResult {
  const validated = validateReplayBundleAgainstRuleset(bundle, ruleset);
  if (!validated.bundle) return { status: 'failed', diagnostic: validated.diagnostic! };
  const replay = validated.bundle;
  let state;
  try { state = createGame(structuredClone(replay.initialConfig), ruleset); }
  catch (error) { return { status: 'failed', diagnostic: diagnostic('CREATE_GAME_FAILED', error instanceof Error ? error.message : 'Replay initial configuration could not create a game.') }; }
  const events = [] as import('@guildmaster/game-protocol').DomainEvent[];
  for (const [commandIndex, envelope] of replay.commands.entries()) {
    const result = dispatch(state, ruleset, structuredClone(envelope));
    if (result.error) return { status: 'failed', diagnostic: diagnostic('COMMAND_REJECTED', result.error.message, { commandIndex, commandId: envelope.commandId, expectedRevision: envelope.expectedRevision, actualRevision: state.revision, engineErrorCode: result.error.code }) };
    state = result.state;
    events.push(...result.events);
  }
  const finalSnapshot = serializeSnapshot(state);
  if (replay.expectedEvents && JSON.stringify(replay.expectedEvents) !== JSON.stringify(events)) return { status: 'failed', diagnostic: diagnostic('EXPECTED_EVENTS_MISMATCH', 'Replay events differ from the audit assertion.', { expected: replay.expectedEvents, actual: events }) };
  if (replay.expectedFinalSnapshot && JSON.stringify(replay.expectedFinalSnapshot) !== JSON.stringify(finalSnapshot)) return { status: 'failed', diagnostic: diagnostic('EXPECTED_FINAL_SNAPSHOT_MISMATCH', 'Replay final snapshot differs from the audit assertion.', { expected: replay.expectedFinalSnapshot, actual: finalSnapshot }) };
  return { status: 'completed', finalSnapshot, events };
}
