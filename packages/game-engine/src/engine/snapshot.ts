import { DomainEventSchema, GameStateSchema, SnapshotEnvelopeSchema, isFiniteJsonValue, type GameState, type VersionedSnapshot } from '@guildmaster/game-protocol';
import { baseZoneIds } from '../model/zones.js';
import { validatePostCommandContinuationState, validateTransactionEventSequence } from './post-command-pipeline.js';
import type { Ruleset } from '../rules/ruleset.js';
import { assertGameStateInvariants, assertRulesetGameStateInvariants } from './state-invariants.js';
import { validateEncounterStateAgainstRuleset } from '../rules/encounter-resolution-evaluator.js';
import { validatePendingCounterConsentState } from '../rules/counter-consent-evaluator.js';
import { validatePendingChoiceAgainstEffect, validatePendingCounterConsentAgainstEffect } from '../effects/executor.js';
import { dispatch } from './dispatch.js';
import { validateSupplyContinuityState } from '../rules/supply-continuity-evaluator.js';
import { validatePendingCombatRewardContinuation } from './combat-reward-pipeline.js';
import { validatePendingCardUseContinuation } from './card-use-effect-pipeline.js';
import { validatePendingDynamicCardChoice } from './pending-dynamic-choice-validation.js';
import { rulesModuleRegistryIdentity } from '../rules/rules-module-composition.js';
import { createGame } from './create-game.js';
function firstDifference(left: unknown, right: unknown, path = '$'): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return path;
  if (Array.isArray(left) !== Array.isArray(right)) return path;
  const leftRecord = left as Record<string, unknown>; const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
  for (const key of keys) {
    if (!(key in leftRecord) || !(key in rightRecord)) return `${path}.${key}`;
    const difference = firstDifference(leftRecord[key], rightRecord[key], Array.isArray(left) ? `${path}[${key}]` : `${path}.${key}`);
    if (difference) return difference;
  }
  return undefined;
}
export function serializeSnapshot(state: GameState): VersionedSnapshot { if (!isFiniteJsonValue(state)) throw new Error('Game state is not finite, acyclic plain JSON.'); GameStateSchema.parse(state); assertGameStateInvariants(state); return { schemaVersion: 2, engineVersion: state.engineVersion, rulesetVersion: state.rulesetVersion, contentPacks: structuredClone(state.contentPacks), rulesModules: structuredClone(state.rulesModules), state: structuredClone(state) }; }
function migrateV1(snapshot: Record<string, unknown>): unknown {
  const state = snapshot.state as Record<string, unknown>; const shared = state.sharedZones as Record<string, string[]>;
  if (!state || !shared) throw new Error('Unsupported snapshot schema.');
  const zoneMap: Record<string, string> = { adventurerDeck: baseZoneIds.adventurerDeck, adventurerRow: baseZoneIds.adventurerRow, itemDeck: baseZoneIds.itemDeck, itemRow: baseZoneIds.itemRow, monsterDeck: baseZoneIds.monsterDeck, monsterRow: baseZoneIds.monsterRow, bossDeck: baseZoneIds.bossDeck, bossRow: baseZoneIds.bossRow };
  const zones = Object.fromEntries(Object.entries(zoneMap).map(([legacy, zoneId]) => [zoneId, { zoneId, kind: legacy.endsWith('Deck') ? 'orderedDeck' : legacy === 'bossRow' ? 'singleSlot' : 'faceUpRow', cardIds: shared[legacy] ?? [], visibility: 'public', rulesModuleId: 'base:rules' }]));
  const players = ((state.players as Record<string, unknown>[]) ?? []).map((player) => ({ ...player, counters: [], moduleState: {}, turnMarketRefreshed: false }));
  const enemyTargets = Object.fromEntries(Object.entries((state.enemyTargets as Record<string, Record<string, unknown>>) ?? {}).map(([id, target]) => [id, { ...target, parentEncounterId: 'base:enemies', zoneId: target.kind === 'boss' ? baseZoneIds.bossRow : baseZoneIds.monsterRow, attachments: [], moduleState: {} }]));
  const enemyEncounters = ((state.enemyEncounters as Record<string, unknown>[]) ?? []).map((encounter) => ({ ...encounter, status: 'active', rulesModuleId: 'base:rules', state: {} }));
  const activePlayerId = state.activePlayerId as string;
  const migratedState: Record<string, unknown> = { ...state, schemaVersion: 2, engineVersion: '0.2.0', rulesetVersion: '0.2.0', players, zones, enemyTargets, enemyEncounters, turnFacts: { schemaVersion: 1, playerId: activePlayerId, adventurersRecruited: 0, adventurersAddedToParty: 0, itemsBought: 0, equipmentBought: 0, purchasePowerSpent: 0, extraCardsDrawn: 0, itemsUsed: 0, bossesDefeated: 0, monstersDefeated: 0, marketRefreshed: false, combatResolved: false, combatSkipped: false } }; delete migratedState.sharedZones;
  return { schemaVersion: 2, engineVersion: migratedState.engineVersion, rulesetVersion: migratedState.rulesetVersion, contentPacks: migratedState.contentPacks, rulesModules: migratedState.rulesModules, state: migratedState };
}
export function restoreSnapshot(snapshot: unknown, ruleset?: Ruleset): GameState {
  if (!isFiniteJsonValue(snapshot)) throw new Error('Snapshot must contain finite, acyclic plain JSON data.');
  const raw = snapshot as Record<string, unknown>; const migrated = raw.schemaVersion === 1 ? migrateV1(raw) : structuredClone(raw);
  if ((migrated as Record<string, unknown>).schemaVersion === 2) {
    const legacyState = (migrated as { state?: Record<string, unknown> }).state;
    if (legacyState) {
      for (const player of (legacyState.players as Record<string, unknown>[] | undefined) ?? []) player.turnMarketRefreshed ??= false;
      legacyState.turnFacts ??= { schemaVersion: 1, playerId: legacyState.activePlayerId, adventurersRecruited: 0, adventurersAddedToParty: 0, itemsBought: 0, equipmentBought: 0, purchasePowerSpent: 0, extraCardsDrawn: 0, itemsUsed: 0, bossesDefeated: 0, monstersDefeated: 0, marketRefreshed: false, combatResolved: false, combatSkipped: false };
    }
  }
  const envelope = SnapshotEnvelopeSchema.parse(migrated);
  if (envelope.engineVersion !== envelope.state.engineVersion || envelope.rulesetVersion !== envelope.state.rulesetVersion) throw new Error('Snapshot engine or ruleset version mismatch.');
  if (JSON.stringify(envelope.contentPacks) !== JSON.stringify(envelope.state.contentPacks)) throw new Error('Snapshot content manifest mismatch.');
  if (JSON.stringify(envelope.rulesModules) !== JSON.stringify(envelope.state.rulesModules)) throw new Error('Snapshot Rules Module manifest mismatch.');
  if (ruleset) {
    const packs = ruleset.registry.packs.map(({ id, version, hash }) => ({ id, version, hash }));
    const modules = ruleset.modules.map(rulesModuleRegistryIdentity);
    if (JSON.stringify(envelope.contentPacks) !== JSON.stringify(packs) || JSON.stringify(envelope.rulesModules) !== JSON.stringify(modules)) throw new Error('Snapshot registry fingerprint does not match the active ruleset.');
  }
  const state = structuredClone(envelope.state) as GameState; state.effectState ??= {};
  assertGameStateInvariants(state);
  if (!ruleset && Object.values(state.zones).some(({ visibility }) => visibility === 'hidden')) throw new Error('Snapshot with hidden Rules Module zones requires the active ruleset for canonical restore.');
  if (ruleset) {
    assertRulesetGameStateInvariants(state, ruleset);
    if (ruleset.modules.some((module) => (module.setupContributions?.length ?? 0) > 0)) {
      const canonical = createGame({
        gameId: state.gameId,
        seed: state.seed,
        players: state.players.map(({ id, name, kind }) => ({ id, name, kind })),
        startingPlayerId: state.startingPlayerId,
      }, ruleset);
      const setupDifference = firstDifference(canonical.setupSelections, state.setupSelections, '$.setupSelections');
      if (setupDifference) throw new Error(`Snapshot setup selection does not match canonical seed replay at ${setupDifference}.`);
    }
    if (state.bondSetup) {
      const canonical = createGame({ gameId: state.gameId, seed: state.seed, players: state.players.map(({ id, name, kind }) => ({ id, name, kind })), startingPlayerId: state.startingPlayerId }, ruleset);
      const offerDifference = firstDifference(canonical.bondSetup?.offers, state.bondSetup.offers, '$.bondSetup.offers');
      if (!canonical.bondSetup || canonical.bondSetup.offerId !== state.bondSetup.offerId || offerDifference) throw new Error(`Snapshot bond setup does not match canonical seed replay${offerDifference ? ` at ${offerDifference}` : ''}.`);
    }
    const encounterError = validateEncounterStateAgainstRuleset(state, ruleset);
    if (encounterError) throw new Error(`Snapshot encounter registry mismatch: ${encounterError}`);
    const consentError = validatePendingCounterConsentState(state, ruleset);
    if (consentError) throw new Error(`Snapshot counter consent registry mismatch: ${consentError}`);
    const continuityErrors = validateSupplyContinuityState(state, ruleset);
    if (continuityErrors.length) throw new Error(`Snapshot supply continuity mismatch: ${continuityErrors.join(' ')}`);
  }
  if (state.effectState.pendingChoice?.source) {
    if (!ruleset) throw new Error('Pending dynamic card choice Snapshot requires the active ruleset for canonical restore.');
    const choiceError = validatePendingDynamicCardChoice(state, ruleset);
    if (choiceError) throw new Error(choiceError);
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
          ? validatePendingChoiceAgainstEffect(state.effectState.pendingChoice, hook.effect, state, ruleset)
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
    if (command.kind === 'card-use-effect') {
      const rollbackState = GameStateSchema.parse(command.rollbackState) as GameState; assertGameStateInvariants(rollbackState); const registry = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) };
      const rollbackEffects = rollbackState.effectState;
      if (Boolean(choice) === Boolean(consent) || pending || state.effectState.pendingPostCommand || command.envelope.command.type !== 'USE_ITEM' || command.continuationId !== `card-use-effect:${command.envelope.commandId}` || command.envelope.gameId !== state.gameId || command.envelope.actorId !== state.activePlayerId || command.envelope.expectedRevision !== state.revision || JSON.stringify(command.registry) !== JSON.stringify(registry) || rollbackEffects.pendingChoice || rollbackEffects.pendingCounterConsent || rollbackEffects.pendingLifecycle || rollbackEffects.pendingCommand || rollbackEffects.pendingPostCommand) throw new Error('Invalid card-use continuation.');
      const eventError = validateTransactionEventSequence(command.events, state, command.registry, command.envelope.commandId, ruleset);
      if (eventError) throw new Error(eventError);
      command.rollbackState = structuredClone(rollbackState);
      if (!ruleset) throw new Error('Pending card-use Snapshot requires the active ruleset for canonical restore.');
      const continuationError = validatePendingCardUseContinuation(state, ruleset);
      if (continuationError) throw new Error(continuationError);
      let canonical = dispatch(structuredClone(rollbackState), ruleset, structuredClone(command.envelope));
      if (canonical.error) throw new Error(`Card-use canonical replay failed at the root command: ${canonical.error.message}`);
      for (const resolutionEnvelope of command.resolutionEnvelopes) {
        canonical = dispatch(canonical.state, ruleset, structuredClone(resolutionEnvelope));
        if (canonical.error) throw new Error(`Card-use canonical replay failed at a resolution command: ${canonical.error.message}`);
      }
      if (canonical.state.effectState.pendingCommand?.kind !== 'card-use-effect') throw new Error('Card-use canonical replay did not suspend at the expected effect boundary.');
      const difference = firstDifference(canonical.state, state);
      if (difference) throw new Error(`Card-use suspended state does not match canonical replay at ${difference}.`);
      return state;
    }
    if (command.kind === 'combat-reward') {
      const rollbackState = GameStateSchema.parse(command.rollbackState) as GameState; assertGameStateInvariants(rollbackState); const registry = { rulesetVersion: state.rulesetVersion, modules: state.rulesModules.map(({ id, version }) => ({ id, version })) }; const evaluation = command.evaluation;
      if (Boolean(choice) === Boolean(consent) || pending || state.effectState.pendingPostCommand || command.continuationId !== `combat-reward:${command.envelope.commandId}` || command.envelope.command.type !== 'ATTACK_TARGET' || command.envelope.gameId !== state.gameId || command.envelope.actorId !== state.activePlayerId || command.envelope.expectedRevision !== state.revision || JSON.stringify(command.registry) !== JSON.stringify(registry) || JSON.stringify(evaluation.registry) !== JSON.stringify(registry) || evaluation.input.playerId !== command.envelope.actorId || evaluation.input.targetId !== command.envelope.command.targetId || command.policyIndex >= evaluation.matchedPolicies.length || rollbackState.effectState.pendingChoice || rollbackState.effectState.pendingCounterConsent || rollbackState.effectState.pendingLifecycle || rollbackState.effectState.pendingCommand || rollbackState.effectState.pendingPostCommand || new Set(command.events.map(({ eventId }) => eventId)).size !== command.events.length) throw new Error('Invalid combat reward continuation.');
      if (ruleset) { const rewardError = validatePendingCombatRewardContinuation(state, ruleset); if (rewardError) throw new Error(rewardError); }
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
    if (!ruleset) throw new Error('Pending post-command Snapshot requires the active ruleset for canonical restore.');
    if (ruleset) {
      let replayed = dispatch(structuredClone(outer.rollbackState), ruleset, structuredClone(outer.envelope));
      if (replayed.error) throw new Error(`Post-command canonical replay failed at the root command: ${replayed.error.message}`);
      for (const resolutionEnvelope of outer.resolutionEnvelopes ?? []) {
        replayed = dispatch(replayed.state, ruleset, structuredClone(resolutionEnvelope));
        if (replayed.error) throw new Error(`Post-command canonical replay failed at a resolution command: ${replayed.error.message}`);
      }
      const canonicalFacts = replayed.state.effectState.pendingPostCommand?.facts;
      if (!canonicalFacts) throw new Error('Post-command canonical replay did not suspend at the expected fact boundary.');
      const normalizedCanonical = canonicalFacts.map((fact) => DomainEventSchema.parse(fact));
      const normalizedPersisted = outer.facts.map((fact) => DomainEventSchema.parse(fact));
      if (JSON.stringify(normalizedCanonical) !== JSON.stringify(normalizedPersisted)) throw new Error('Post-command facts must equal the complete ordered reducer fact segment.');
      const difference = firstDifference(replayed.state, state);
      if (difference) throw new Error(`Post-command suspended state does not match canonical replay at ${difference}.`);
    }
  }
  if (pending && Boolean(state.effectState.pendingChoice) === Boolean(state.effectState.pendingCounterConsent)) throw new Error('Pending lifecycle dispatch must have exactly one matching suspension.');
  if (!pending && (command || outer)) throw new Error('Outer continuation has no matching lifecycle dispatch.');
  return state;
}
