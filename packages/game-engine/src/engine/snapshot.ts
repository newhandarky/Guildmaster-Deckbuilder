import { GameStateSchema, SnapshotEnvelopeSchema, isFiniteJsonValue, type GameState, type VersionedSnapshot } from '@guildmaster/game-protocol';
import { baseZoneIds } from '../model/zones.js';
import { validatePostCommandContinuationState, validateTransactionEventSequence } from './post-command-pipeline.js';
import type { Ruleset } from '../rules/ruleset.js';
import { assertGameStateInvariants } from './state-invariants.js';
import { validateEncounterStateAgainstRuleset } from '../rules/encounter-resolution-evaluator.js';
import { validatePendingCounterConsentState } from '../rules/counter-consent-evaluator.js';
import { validatePendingChoiceAgainstEffect, validatePendingCounterConsentAgainstEffect } from '../effects/executor.js';
import { dispatch } from './dispatch.js';
export function serializeSnapshot(state: GameState): VersionedSnapshot { if (!isFiniteJsonValue(state)) throw new Error('Game state is not finite, acyclic plain JSON.'); GameStateSchema.parse(state); assertGameStateInvariants(state); return { schemaVersion: 2, engineVersion: state.engineVersion, rulesetVersion: state.rulesetVersion, contentPacks: structuredClone(state.contentPacks), rulesModules: structuredClone(state.rulesModules), state: structuredClone(state) }; }
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
export function restoreSnapshot(snapshot: unknown, ruleset?: Ruleset): GameState {
  if (!isFiniteJsonValue(snapshot)) throw new Error('Snapshot must contain finite, acyclic plain JSON data.');
  const raw = snapshot as Record<string, unknown>; const migrated = raw.schemaVersion === 1 ? migrateV1(raw) : raw; const envelope = SnapshotEnvelopeSchema.parse(migrated);
  if (envelope.engineVersion !== envelope.state.engineVersion || envelope.rulesetVersion !== envelope.state.rulesetVersion) throw new Error('Snapshot engine or ruleset version mismatch.');
  if (JSON.stringify(envelope.contentPacks) !== JSON.stringify(envelope.state.contentPacks)) throw new Error('Snapshot content manifest mismatch.');
  if (JSON.stringify(envelope.rulesModules) !== JSON.stringify(envelope.state.rulesModules)) throw new Error('Snapshot Rules Module manifest mismatch.');
  if (ruleset) {
    const packs = ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash }));
    const modules = ruleset.modules.map(({ id, version, config }) => ({ id, version, ...(config ? { config } : {}) }));
    if (JSON.stringify(envelope.contentPacks) !== JSON.stringify(packs) || JSON.stringify(envelope.rulesModules) !== JSON.stringify(modules)) throw new Error('Snapshot registry fingerprint does not match the active ruleset.');
  }
  const state = structuredClone(envelope.state) as GameState; state.effectState ??= {};
  assertGameStateInvariants(state);
  if (ruleset) {
    const encounterError = validateEncounterStateAgainstRuleset(state, ruleset);
    if (encounterError) throw new Error(`Snapshot encounter registry mismatch: ${encounterError}`);
    const consentError = validatePendingCounterConsentState(state, ruleset);
    if (consentError) throw new Error(`Snapshot counter consent registry mismatch: ${consentError}`);
  }
  const pending = state.effectState.pendingLifecycle;
  if (pending) {
    const rollbackState = GameStateSchema.parse(pending.rollbackState) as GameState; assertGameStateInvariants(rollbackState);
    const rollbackEffects = rollbackState.effectState;
    const stateRegistry = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
    if (rollbackState.gameId !== state.gameId || JSON.stringify(pending.registry) !== JSON.stringify(stateRegistry) || rollbackState.engineVersion !== state.engineVersion || JSON.stringify(rollbackState.contentPacks) !== JSON.stringify(state.contentPacks) || JSON.stringify(rollbackState.rulesModules) !== JSON.stringify(state.rulesModules) || rollbackEffects.pendingChoice || rollbackEffects.pendingCounterConsent || rollbackEffects.pendingLifecycle || rollbackEffects.pendingCommand || rollbackEffects.pendingPostCommand) throw new Error('Invalid lifecycle rollback checkpoint.');
    pending.rollbackState = structuredClone(rollbackState);
    if (ruleset) {
      const hook = ruleset.modules.find(({ id }) => id === pending.currentHook.moduleId)?.lifecycleHooks?.find(({ hookId }) => hookId === pending.currentHook.hookId);
      const suspension = state.effectState.pendingChoice ?? state.effectState.pendingCounterConsent;
      const programError = !hook || !suspension
        ? 'Pending lifecycle hook or suspension is missing.'
        : state.effectState.pendingChoice
          ? validatePendingChoiceAgainstEffect(state.effectState.pendingChoice, hook.effect)
          : validatePendingCounterConsentAgainstEffect(state.effectState.pendingCounterConsent!, hook.effect);
      if (programError) throw new Error(programError);
    }
  }
  const command = state.effectState.pendingCommand;
  if (command) {
    const choice = state.effectState.pendingChoice; const consent = state.effectState.pendingCounterConsent;
    if (command.kind === 'team-overflow') {
      const rollbackState = GameStateSchema.parse(command.rollbackState) as GameState; assertGameStateInvariants(rollbackState); const registry = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
      const optionSets = Object.values(command.optionCandidates);
      if (!choice || consent || pending || state.effectState.pendingPostCommand || command.envelope.command.type !== 'PLAY_ADVENTURER' || command.envelope.gameId !== state.gameId || command.envelope.actorId !== state.activePlayerId || command.envelope.expectedRevision !== state.revision || choice.executionId !== `team-overflow:${command.envelope.commandId}` || choice.choiceId !== `team-overflow:${command.policy.policyId}` || JSON.stringify(command.registry) !== JSON.stringify(registry) || rollbackState.effectState.pendingChoice || rollbackState.effectState.pendingCounterConsent || rollbackState.effectState.pendingLifecycle || rollbackState.effectState.pendingCommand || rollbackState.effectState.pendingPostCommand || new Set(command.candidateIds).size !== command.candidateIds.length || !command.candidateIds.every((id) => rollbackState.players.find(({ id: playerId }) => playerId === command.envelope.actorId)?.party.some((slot) => slot.adventurerId === id)) || !optionSets.every((set) => set.length === command.requiredSelectionCount && new Set(set).size === set.length && set.every((id) => command.candidateIds.includes(id))) || !choice.options.every((option) => command.optionCandidates[option.id])) throw new Error('Invalid team overflow continuation.');
      command.rollbackState = structuredClone(rollbackState); return state;
    }
    if (command.kind === 'combat-reward') {
      const rollbackState = GameStateSchema.parse(command.rollbackState) as GameState; assertGameStateInvariants(rollbackState); const registry = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) }; const evaluation = command.evaluation;
      if (Boolean(choice) === Boolean(consent) || pending || state.effectState.pendingPostCommand || command.continuationId !== `combat-reward:${command.envelope.commandId}` || command.envelope.command.type !== 'ATTACK_TARGET' || command.envelope.gameId !== state.gameId || command.envelope.actorId !== state.activePlayerId || command.envelope.expectedRevision !== state.revision || JSON.stringify(command.registry) !== JSON.stringify(registry) || JSON.stringify(evaluation.registry) !== JSON.stringify(registry) || evaluation.input.playerId !== command.envelope.actorId || evaluation.input.targetId !== command.envelope.command.targetId || command.policyIndex >= evaluation.matchedPolicies.length || rollbackState.effectState.pendingChoice || rollbackState.effectState.pendingCounterConsent || rollbackState.effectState.pendingLifecycle || rollbackState.effectState.pendingCommand || rollbackState.effectState.pendingPostCommand || new Set(command.events.map(({ eventId }) => eventId)).size !== command.events.length) throw new Error('Invalid combat reward continuation.');
      command.rollbackState = structuredClone(rollbackState); return state;
    }
    const executionId = pending ? `${pending.dispatchId}:${pending.currentHook.moduleId}:${pending.currentHook.hookId}` : '';
    const suspension = choice ?? consent;
    if (!pending || Boolean(choice) === Boolean(consent) || state.effectState.pendingPostCommand || command.envelope.gameId !== state.gameId || command.envelope.actorId !== state.activePlayerId || command.envelope.expectedRevision !== state.revision || pending.payload.point !== 'command-before' || pending.context.controllerId !== command.envelope.actorId || (choice && choice.actorId !== command.envelope.actorId) || (consent && consent.requesterId !== command.envelope.actorId) || suspension!.executionId !== executionId || JSON.stringify(suspension!.context) !== JSON.stringify(pending.context)) throw new Error('Invalid command-before continuation.');
    const eventError = validateTransactionEventSequence(command.events, state, pending.registry, command.envelope.commandId, ruleset);
    if (eventError) throw new Error(eventError);
  }
  const outer = state.effectState.pendingPostCommand;
  if (outer) {
    outer.rollbackState = structuredClone(GameStateSchema.parse(outer.rollbackState) as GameState); assertGameStateInvariants(outer.rollbackState);
    const error = validatePostCommandContinuationState(state, ruleset);
    if (error) throw new Error(error);
    if (ruleset) {
      const replayed = dispatch(structuredClone(outer.rollbackState), ruleset, structuredClone(outer.envelope));
      const canonicalFacts = replayed.state.effectState.pendingPostCommand?.facts;
      if (replayed.error || !canonicalFacts || JSON.stringify(canonicalFacts) !== JSON.stringify(outer.facts)) throw new Error('Post-command facts must equal the complete ordered reducer fact segment.');
    }
  }
  if (pending && Boolean(state.effectState.pendingChoice) === Boolean(state.effectState.pendingCounterConsent)) throw new Error('Pending lifecycle dispatch must have exactly one matching suspension.');
  if (!pending && (command || outer)) throw new Error('Outer continuation has no matching lifecycle dispatch.');
  return state;
}
