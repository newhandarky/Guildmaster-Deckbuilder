import { CpuTurnRunner, canonicalCommand, cpuDifficultyForProfile, cpuProfileForDifficulty } from '@guildmaster/game-ai';
import { createGame, dispatch, getCpuActionFeatures, getLegalCommands, projectPlayerView, replayRegistryFingerprint, type Ruleset } from '@guildmaster/game-engine';
import { ReplayBundleSchema, stableJsonDigest, stableJsonFingerprint, type ReplayBundle } from '@guildmaster/game-protocol';
import { webContentModeFromPackIds } from '../../app/content-mode.js';

export type CpuReplayAuditResult =
  | { status: 'verified' }
  | { status: 'legacy-non-auditable'; diagnostic: string }
  | { status: 'failed'; commandId?: string; diagnostic: string };

/** Recomputes every CPU input and decision; Replay command execution remains Engine-owned. */
export function auditCpuReplay(bundle: ReplayBundle | unknown, ruleset: Ruleset): CpuReplayAuditResult {
  const parsed = ReplayBundleSchema.safeParse(bundle);
  if (!parsed.success) return { status: 'failed', diagnostic: parsed.error.issues[0]?.message ?? 'Malformed Replay.' };
  if (parsed.data.schemaVersion === 1) return { status: 'legacy-non-auditable', diagnostic: 'Replay v1 has no verifiable CPU decision context.' };
  const profileDifficulty = cpuDifficultyForProfile(parsed.data.automation.profileId, parsed.data.automation.profileVersion);
  if (!profileDifficulty) return { status: 'failed', diagnostic: 'CPU profile identity mismatch.' };
  if (parsed.data.schemaVersion === 3 && parsed.data.sessionConfig.cpuDifficulty !== profileDifficulty) return { status: 'failed', diagnostic: 'Replay session CPU difficulty does not match automation profile.' };
  if (parsed.data.schemaVersion === 3) {
    const mode = webContentModeFromPackIds(ruleset.registry.packs.map(({ id }) => id));
    const moduleBossCount = ruleset.modules.find(({ id }) => id === 'web:custom-boss-setup')?.config?.bossDeckSize;
    const expectedBossCount = mode === 'custom-adventurers-full' ? Number(moduleBossCount ?? 6) : undefined;
    if (parsed.data.sessionConfig.bossDeckSize !== expectedBossCount) return { status: 'failed', diagnostic: 'Replay boss count does not match the active Rules Module configuration.' };
  }
  const profile = cpuProfileForDifficulty(profileDifficulty);
  const runner = new CpuTurnRunner(profile);
  let state;
  try { state = createGame(structuredClone(parsed.data.initialConfig), ruleset); }
  catch (error) { return { status: 'failed', diagnostic: error instanceof Error ? error.message : 'Unable to create Replay game.' }; }
  let decisionIndex = 0;
  const registryFingerprint = JSON.stringify(replayRegistryFingerprint(ruleset));
  for (const envelope of parsed.data.commands) {
    const player = state.players.find((candidate) => candidate.id === envelope.actorId);
    if (!player) return { status: 'failed', commandId: envelope.commandId, diagnostic: 'Replay actor does not exist.' };
    if (player.kind === 'human') runner.reset();
    else {
      const stored = parsed.data.automation.decisions[decisionIndex++];
      const view = projectPlayerView(state, ruleset, player.id);
      const legalCommands = getLegalCommands(state, ruleset, player.id);
      const actionFeatures = getCpuActionFeatures(state, ruleset, player.id);
      const decision = runner.step({ view, legalCommands, actionFeatures, definitions: ruleset.registry.definitions, bonds: ruleset.registry.bonds, rulesetFingerprint: registryFingerprint, profile });
      if (!stored || decision.status !== 'ready') return { status: 'failed', commandId: envelope.commandId, diagnostic: decision.status === 'blocked' ? `${decision.reasonCode}: ${decision.diagnostic}` : 'Missing CPU decision.' };
      const expected = { commandId: envelope.commandId, revision: view.revision, actorId: player.id, command: decision.command, reasonCode: decision.reasonCode, score: decision.score, scoreBreakdown: decision.scoreBreakdown, contextFingerprint: decision.contextFingerprint, legalCommandsFingerprint: stableJsonDigest(legalCommands), actionFeaturesFingerprint: stableJsonDigest(actionFeatures) };
      if (stableJsonFingerprint(stored) !== stableJsonFingerprint(expected) || canonicalCommand(envelope.command) !== canonicalCommand(decision.command)) return { status: 'failed', commandId: envelope.commandId, diagnostic: 'Stored CPU decision does not match canonical recomputation.' };
    }
    const result = dispatch(state, ruleset, structuredClone(envelope));
    if (result.error) return { status: 'failed', commandId: envelope.commandId, diagnostic: result.error.message };
    state = result.state;
  }
  if (decisionIndex !== parsed.data.automation.decisions.length) return { status: 'failed', diagnostic: 'Replay contains unmatched CPU decisions.' };
  if (stableJsonFingerprint(runner.snapshot()) !== stableJsonFingerprint(parsed.data.automation.runner)) return { status: 'failed', diagnostic: 'Stored CPU runner state does not match canonical recomputation.' };
  return { status: 'verified' };
}
