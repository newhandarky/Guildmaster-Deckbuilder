import { ReplayBundleSchema, isFiniteJsonValue, stableJsonFingerprint, type ReplayBundle, type ReplayDiagnostic, type ReplayDivergence, type ReplayRegistryFingerprint, type ReplayResult } from '@guildmaster/game-protocol';
import { createGame } from './create-game.js';
import { dispatch } from './dispatch.js';
import { restoreSnapshot, serializeSnapshot } from './snapshot.js';
import { rulesModuleCompositionFingerprint } from '../rules/rules-module-composition.js';
import type { Ruleset } from '../rules/ruleset.js';

const engineVersion = '0.2.0';
const rulesetVersion = '0.2.0';

export function replayRegistryFingerprint(ruleset: Ruleset): ReplayRegistryFingerprint {
  return {
    engineVersion,
    rulesetVersion,
    contentPacks: ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash })),
    rulesModules: ruleset.modules.map(({ id, version, config, composition }) => ({
      id,
      version,
      configFingerprint: stableJsonFingerprint(config ?? {}),
      ...(composition ? { compositionFingerprint: rulesModuleCompositionFingerprint(composition) } : {}),
    }))
  };
}

function diagnostic(reasonCode: ReplayDiagnostic['reasonCode'], message: string, extra: Omit<ReplayDiagnostic, 'reasonCode' | 'message'> = {}): ReplayDiagnostic {
  return { reasonCode, message, ...extra };
}

/** Returns the first deterministic JSON leaf that differs, never exposing a whole state blob. */
export function firstReplayDivergence(expected: unknown, actual: unknown, path = '$'): ReplayDivergence | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const difference = firstReplayDivergence(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return undefined;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    const keys = [...new Set([...Object.keys(expected as Record<string, unknown>), ...Object.keys(actual as Record<string, unknown>)])].sort();
    for (const key of keys) {
      const difference = firstReplayDivergence((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return undefined;
  }
  return { path, expected, actual };
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
    const previousEventLogCursor = state.eventLogCursor;
    const result = dispatch(state, ruleset, structuredClone(envelope));
    if (result.error) return { status: 'failed', diagnostic: diagnostic('COMMAND_REJECTED', result.error.message, { commandIndex, commandId: envelope.commandId, expectedRevision: envelope.expectedRevision, actualRevision: state.revision, engineErrorCode: result.error.code }) };
    state = result.state;
    const committedEventCount = state.eventLogCursor - previousEventLogCursor;
    if (committedEventCount > 0) events.push(...result.events.slice(-committedEventCount));
  }
  // Match the strict JSON schema normalization performed on imported expected snapshots.
  const finalSnapshot = serializeSnapshot(restoreSnapshot(serializeSnapshot(state), ruleset));
  if (replay.expectedEvents && JSON.stringify(replay.expectedEvents) !== JSON.stringify(events)) { const divergence = firstReplayDivergence(replay.expectedEvents, events, '$.expectedEvents'); return { status: 'failed', diagnostic: diagnostic('EXPECTED_EVENTS_MISMATCH', 'Replay events differ from the audit assertion.', { expected: replay.expectedEvents, actual: events, ...(divergence ? { divergence } : {}) }) }; }
  if (replay.expectedFinalSnapshot && JSON.stringify(replay.expectedFinalSnapshot) !== JSON.stringify(finalSnapshot)) { const divergence = firstReplayDivergence(replay.expectedFinalSnapshot, finalSnapshot, '$.expectedFinalSnapshot'); return { status: 'failed', diagnostic: diagnostic('EXPECTED_FINAL_SNAPSHOT_MISMATCH', 'Replay final snapshot differs from the audit assertion.', { expected: replay.expectedFinalSnapshot, actual: finalSnapshot, ...(divergence ? { divergence } : {}) }) }; }
  return { status: 'completed', finalSnapshot, events };
}
