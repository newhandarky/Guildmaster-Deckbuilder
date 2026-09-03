import { stableJsonDigest, type CardDefinition, type ContentPack, type CpuActionFeature, type CpuDifficulty, type GameCommand, type PlayerView } from '@guildmaster/game-protocol';

export type CpuReasonCode =
  | 'KEEP_HIGHEST_BOND_VALUE' | 'ATTACK_BEST_NET_VALUE' | 'PLAY_FOR_PARTY_POWER'
  | 'EQUIP_FOR_COMBAT_GAIN' | 'USE_ITEM_FOR_IMMEDIATE_VALUE' | 'BUY_HIGHEST_UTILITY'
  | 'ACTIVATE_CARD_EFFECT_FOR_COMBAT_PROGRESS' | 'ATTACK_WITH_COMBAT_ASSIST'
  | 'REFRESH_LOW_VALUE_MARKET' | 'DISCARD_LOWEST_UTILITY' | 'END_NO_POSITIVE_ACTION'
  | 'RESOLVE_HIGHEST_UTILITY_CHOICE' | 'RESPOND_REQUIRED_CONSENT' | 'COMPLETE_ELIGIBLE_BONDS'
  | 'BLOCKED_UNSUPPORTED_DECISION' | 'ADVANCE_BOSS_COMBAT';

export type CpuScoringWeights = {
  honor: number; bondHonor: number; bossProgress: number; monsterDefeat: number;
  permanentPurchasePower: number; partyCombat: number; draw: number; removal: number;
  immediatePower: number; purchaseCost: number; partyCombatLoss: number; equipmentLoss: number; equipmentRemoval: number; overflowLoss: number;
};
export type CpuProfile = {
  schemaVersion: 1; profileId: string; version: string;
  commandPriority: readonly GameCommand['type'][]; weights: CpuScoringWeights;
  strategy: {
    bossReserveAfterMonsterDefeats: number | null;
    bossLookahead: 'none' | 'unlock-only' | 'full';
    bossPurchase: 'none' | 'unlock-only' | 'combat-gain';
    marketRefresh: 'simple' | 'balanced' | 'boss-adaptive';
    alternateEvery: number;
    alternateMinRatio: number;
  };
  maxActionsPerTurn: 128; maxAutonomousSteps: 512; repeatedVisibleStateLimit: 3;
};
export type CpuScoreTerm = { feature: keyof CpuScoringWeights; value: number; weight: number; contribution: number };
export type CpuDecisionContext = {
  view: PlayerView; legalCommands: readonly GameCommand[]; actionFeatures: readonly CpuActionFeature[];
  definitions: Readonly<Record<string, CardDefinition>>; bonds?: NonNullable<ContentPack['bonds']>;
  rulesetFingerprint: string; profile: CpuProfile; decisionOrdinal?: number;
};
export type CpuDecisionResult =
  | { status: 'ready'; command: GameCommand; reasonCode: CpuReasonCode; score: number; scoreBreakdown: readonly CpuScoreTerm[]; contextFingerprint: string }
  | { status: 'blocked'; reasonCode: 'UNSUPPORTED_DECISION_KIND' | 'NO_LEGAL_COMMAND' | 'MISSING_ACTION_FEATURE' | 'REPEATED_VISIBLE_STATE' | 'MAX_ACTIONS_EXCEEDED'; diagnostic: string };

export const baseBalancedCpuProfile: CpuProfile = Object.freeze<CpuProfile>({
  schemaVersion: 1, profileId: 'base:cpu-balanced', version: '1.6.0',
  commandPriority: ['SELECT_BONDS', 'RESOLVE_EFFECT_CHOICE', 'RESOLVE_EFFECT_ORDER', 'RESPOND_COUNTER_CONSENT', 'COMPLETE_BONDS', 'ATTACK_TARGET', 'ACTIVATE_CARD_EFFECT', 'PLAY_ADVENTURER', 'EQUIP_ITEM', 'ATTACH_CARD', 'USE_ITEM', 'BUY_CARD', 'REFRESH_MARKET', 'END_PHASE', 'CANCEL_COUNTER_CONSENT', 'EXPIRE_COUNTER_CONSENT'],
  weights: { honor: 100, bondHonor: 100, bossProgress: 80, monsterDefeat: 30, permanentPurchasePower: 18, partyCombat: 12, draw: 10, removal: 20, immediatePower: 8, purchaseCost: -6, partyCombatLoss: -12, equipmentLoss: -10, equipmentRemoval: -8, overflowLoss: -1 },
  strategy: { bossReserveAfterMonsterDefeats: 5, bossLookahead: 'full', bossPurchase: 'combat-gain', marketRefresh: 'boss-adaptive', alternateEvery: 0, alternateMinRatio: 1 },
  maxActionsPerTurn: 128, maxAutonomousSteps: 512, repeatedVisibleStateLimit: 3,
});

export const standardCpuProfile: CpuProfile = Object.freeze<CpuProfile>({
  ...baseBalancedCpuProfile,
  profileId: 'web:cpu-standard', version: '1.0.0',
  weights: { honor: 90, bondHonor: 100, bossProgress: 60, monsterDefeat: 30, permanentPurchasePower: 18, partyCombat: 12, draw: 10, removal: 18, immediatePower: 8, purchaseCost: -6, partyCombatLoss: -10, equipmentLoss: -8, equipmentRemoval: -8, overflowLoss: -1 },
  strategy: { bossReserveAfterMonsterDefeats: 7, bossLookahead: 'unlock-only', bossPurchase: 'unlock-only', marketRefresh: 'balanced', alternateEvery: 0, alternateMinRatio: 1 },
});

export const beginnerCpuProfile: CpuProfile = Object.freeze<CpuProfile>({
  ...baseBalancedCpuProfile,
  profileId: 'web:cpu-beginner', version: '1.0.0',
  weights: { honor: 70, bondHonor: 100, bossProgress: 35, monsterDefeat: 28, permanentPurchasePower: 22, partyCombat: 10, draw: 14, removal: 12, immediatePower: 12, purchaseCost: -3, partyCombatLoss: -6, equipmentLoss: -5, equipmentRemoval: -4, overflowLoss: 0 },
  strategy: { bossReserveAfterMonsterDefeats: null, bossLookahead: 'none', bossPurchase: 'none', marketRefresh: 'simple', alternateEvery: 3, alternateMinRatio: 0.65 },
});

export const cpuProfileForDifficulty = (difficulty: CpuDifficulty): CpuProfile => difficulty === 'beginner'
  ? beginnerCpuProfile
  : difficulty === 'standard' ? standardCpuProfile : baseBalancedCpuProfile;

export function cpuDifficultyForProfile(profileId: string, profileVersion: string): CpuDifficulty | undefined {
  if (profileId === beginnerCpuProfile.profileId && profileVersion === beginnerCpuProfile.version) return 'beginner';
  if (profileId === standardCpuProfile.profileId && profileVersion === standardCpuProfile.version) return 'standard';
  if (profileId === baseBalancedCpuProfile.profileId && profileVersion === baseBalancedCpuProfile.version) return 'challenge';
  return undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const canonicalCommand = (command: GameCommand): string => stable(command);
export function cpuContextFingerprint(context: CpuDecisionContext): string {
  return stableJsonDigest({
    view: context.view,
    legalCommands: context.legalCommands,
    actionFeatures: context.actionFeatures,
    rulesetFingerprint: context.rulesetFingerprint,
    profile: { id: context.profile.profileId, version: context.profile.version },
    ...(context.profile.strategy.alternateEvery > 0 ? { decisionOrdinal: context.decisionOrdinal ?? 0 } : {}),
  });
}

function reason(command: GameCommand): CpuReasonCode {
  if (command.type === 'SELECT_BONDS') return 'KEEP_HIGHEST_BOND_VALUE';
  if (command.type === 'COMPLETE_BONDS') return 'COMPLETE_ELIGIBLE_BONDS';
  if (command.type === 'ATTACK_TARGET') return command.combatAssistCardId ? 'ATTACK_WITH_COMBAT_ASSIST' : 'ATTACK_BEST_NET_VALUE';
  if (command.type === 'ACTIVATE_CARD_EFFECT') return 'ACTIVATE_CARD_EFFECT_FOR_COMBAT_PROGRESS';
  if (command.type === 'PLAY_ADVENTURER') return 'PLAY_FOR_PARTY_POWER';
  if (command.type === 'EQUIP_ITEM' || command.type === 'ATTACH_CARD') return 'EQUIP_FOR_COMBAT_GAIN';
  if (command.type === 'USE_ITEM') return 'USE_ITEM_FOR_IMMEDIATE_VALUE';
  if (command.type === 'BUY_CARD') return 'BUY_HIGHEST_UTILITY';
  if (command.type === 'REFRESH_MARKET') return 'REFRESH_LOW_VALUE_MARKET';
  if (command.type === 'RESPOND_COUNTER_CONSENT' || command.type === 'CANCEL_COUNTER_CONSENT' || command.type === 'EXPIRE_COUNTER_CONSENT') return 'RESPOND_REQUIRED_CONSENT';
  if (command.type === 'RESOLVE_EFFECT_CHOICE' || command.type === 'RESOLVE_EFFECT_ORDER') return 'RESOLVE_HIGHEST_UTILITY_CHOICE';
  return 'END_NO_POSITIVE_ACTION';
}

function definitionUtility(definition: CardDefinition | undefined): number {
  return (definition?.honor ?? 0) * 100 + (definition?.purchasePower ?? 0) * 18 + (definition?.combat ?? 0) * 12 + (definition?.cost ?? 0);
}

function scoreFeature(feature: CpuActionFeature, weights: CpuScoringWeights): { score: number; terms: CpuScoreTerm[] } {
  const raw: [keyof CpuScoringWeights, number][] = [
    ['honor', feature.honorGain], ['bondHonor', feature.bondHonorGain], ['bossProgress', feature.bossProgress], ['monsterDefeat', feature.monsterDefeat],
    ['permanentPurchasePower', feature.permanentPurchasePower], ['partyCombat', feature.partyCombatGain], ['draw', feature.cardsDrawn], ['removal', feature.removalValue],
    ['immediatePower', feature.immediatePurchasePower + feature.immediateCombatPower], ['purchaseCost', feature.purchaseCost], ['partyCombatLoss', feature.partyCombatLoss],
    ['equipmentLoss', feature.equipmentLoss], ['equipmentRemoval', feature.equipmentRemoval], ['overflowLoss', feature.overflowLoss],
  ];
  const terms = raw.filter(([, value]) => value !== 0).map(([featureName, value]) => ({ feature: featureName, value, weight: weights[featureName], contribution: value * weights[featureName] }));
  return { score: terms.reduce((sum, term) => sum + term.contribution, 0), terms };
}

export function decideCpuAction(context: CpuDecisionContext): CpuDecisionResult {
  if (!context.legalCommands.length) return { status: 'blocked', reasonCode: 'NO_LEGAL_COMMAND', diagnostic: `No legal command at revision ${context.view.revision}.` };
  if (context.actionFeatures.some((feature) => feature.schemaVersion !== 2 || !Array.isArray(feature.targetCombatProgress))) return { status: 'blocked', reasonCode: 'MISSING_ACTION_FEATURE', diagnostic: 'CPU action features require schemaVersion 2 targetCombatProgress.' };
  const fingerprint = cpuContextFingerprint(context);
  if (context.legalCommands.some(({ type }) => type === 'RESOLVE_EFFECT_CHOICE' || type === 'RESOLVE_EFFECT_ORDER') && !context.view.decisionPrompt) return { status: 'blocked', reasonCode: 'UNSUPPORTED_DECISION_KIND', diagnostic: 'Effect decision has no typed PlayerDecisionPrompt; CPU stopped without guessing.' };
  const availableBoss = Object.values(context.view.enemyTargets ?? {}).some(({ kind, status }) => kind === 'boss' && status === 'available');
  const legalBossAttack = context.legalCommands.some((command) => command.type === 'ATTACK_TARGET' && context.view.enemyTargets[command.targetId]?.kind === 'boss');
  const bossCombatReady = context.actionFeatures.some((feature) => feature.targetCombatProgress.some(({ targetId, attackReadyBefore }) => attackReadyBefore && context.view.enemyTargets[targetId]?.kind === 'boss'));
  const needsBossPower = availableBoss && !legalBossAttack && !bossCombatReady;
  const reserveThreshold = context.profile.strategy.bossReserveAfterMonsterDefeats;
  const reservePartyForBoss = needsBossPower && reserveThreshold !== null && (context.view.self?.history?.defeatedMonsters ?? 0) >= reserveThreshold;
  const strategicCommands = (reservePartyForBoss && !legalBossAttack
    ? context.legalCommands.filter((command) => command.type !== 'ATTACK_TARGET')
    : context.legalCommands).filter((command) => !(command.type === 'ATTACK_TARGET' && command.combatAssistCardId && context.legalCommands.some((candidate) => candidate.type === 'ATTACK_TARGET' && candidate.targetId === command.targetId && !candidate.combatAssistCardId)));
  const priority = new Map(context.profile.commandPriority.map((type, index) => [type, index]));
  const ranked = strategicCommands.map((command) => {
    if (command.type === 'SELECT_BONDS') {
      const honor = command.bondIds.reduce((sum, id) => sum + (context.bonds?.find((bond) => bond.id === id)?.honor ?? 0), 0);
      return { command, score: honor * context.profile.weights.bondHonor + 1_000_000, terms: [{ feature: 'bondHonor' as const, value: honor, weight: context.profile.weights.bondHonor, contribution: honor * context.profile.weights.bondHonor }] };
    }
    if (command.type === 'RESPOND_COUNTER_CONSENT') return { command, score: command.response === 'accept' ? 1_000_000 : 999_999, terms: [] as CpuScoreTerm[] };
    if (command.type === 'RESOLVE_EFFECT_CHOICE') {
      const prompt = context.view.decisionPrompt;
      if (prompt?.choiceId === 'combat-departure:optional-replacements') {
        const selectedCountRank = Number(command.optionId.slice(command.optionId.lastIndexOf('-') + 1));
        return { command, score: 1_000_000 + (Number.isFinite(selectedCountRank) ? selectedCountRank : 0), terms: [] as CpuScoreTerm[] };
      }
      const option = prompt?.options.find(({ id }) => id === command.optionId);
      const targetCardId = option?.cardId ?? context.view.enemyTargets[option?.id ?? '']?.cardInstanceId;
      const utility = definitionUtility(targetCardId ? context.definitions[context.view.cards[targetCardId]?.definitionId ?? option?.definitionId ?? ''] : undefined);
      const losesCard = prompt?.decisionKind === 'discard-card' || prompt?.decisionKind === 'remove-card' || prompt?.decisionKind === 'choose-party-member' || prompt?.decisionKind === 'transfer-card';
      return { command, score: 1_000_000 + (losesCard ? -utility : utility), terms: [] as CpuScoreTerm[] };
    }
    if (command.type === 'RESOLVE_EFFECT_ORDER') {
      const removed = command.removeCardId ? context.definitions[context.view.cards[command.removeCardId]?.definitionId ?? ''] : undefined;
      return { command, score: 1_000_000 - definitionUtility(removed), terms: [] as CpuScoreTerm[] };
    }
    const feature = context.actionFeatures.find((candidate) => canonicalCommand(candidate.command) === canonicalCommand(command));
    if (!feature) return { command, score: command.type === 'END_PHASE' ? 0 : Number.NEGATIVE_INFINITY, terms: [] as CpuScoreTerm[] };
    const scored = scoreFeature(feature, context.profile.weights);
    if (command.type === 'REFRESH_MARKET') scored.score = -1;
    return { command, score: scored.score, terms: scored.terms };
  }).sort((left, right) => right.score - left.score || (priority.get(left.command.type) ?? 999) - (priority.get(right.command.type) ?? 999) || canonicalCommand(left.command).localeCompare(canonicalCommand(right.command)));
  let best = ranked[0]!;
  let strategicRotation = false;
  let advancesBossCombat = false;
  if (needsBossPower && context.profile.strategy.bossLookahead !== 'none') {
    const progress = ranked.map((entry) => {
      const feature = context.actionFeatures.find((candidate) => canonicalCommand(candidate.command) === canonicalCommand(entry.command));
      const bosses = feature?.targetCombatProgress.filter(({ targetId }) => context.view.enemyTargets[targetId]?.kind === 'boss') ?? [];
      return {
        entry,
        unlocks: bosses.some(({ attackReadyBefore, attackReadyAfter }) => !attackReadyBefore && attackReadyAfter),
        reduction: bosses.reduce((largest, target) => Math.max(largest, target.shortfallBefore - target.shortfallAfter), 0),
      };
    });
    const immediate = progress.filter(({ unlocks, reduction }) => unlocks || (context.profile.strategy.bossLookahead === 'full' && reduction > 0)).sort((left, right) => Number(right.unlocks) - Number(left.unlocks) || right.reduction - left.reduction || right.entry.score - left.entry.score || canonicalCommand(left.entry.command).localeCompare(canonicalCommand(right.entry.command)))[0];
    if (immediate) { best = immediate.entry; strategicRotation = true; advancesBossCombat = true; }
  }
  if (!advancesBossCombat && needsBossPower && context.view.phase === 'purchase' && context.profile.strategy.bossPurchase !== 'none') {
    const combatBuy = ranked.filter(({ command }) => command.type === 'BUY_CARD').map((entry) => ({
      entry,
      combat: context.actionFeatures.find((feature) => canonicalCommand(feature.command) === canonicalCommand(entry.command))?.partyCombatGain ?? 0,
      unlocksBoss: context.actionFeatures.find((feature) => canonicalCommand(feature.command) === canonicalCommand(entry.command))?.targetCombatProgress.some(({ targetId, attackReadyBefore, attackReadyAfter }) => context.view.enemyTargets[targetId]?.kind === 'boss' && !attackReadyBefore && attackReadyAfter) ?? false,
    })).filter(({ combat, unlocksBoss }) => combat > 0 && (context.profile.strategy.bossPurchase !== 'unlock-only' || unlocksBoss)).sort((left, right) => right.combat - left.combat || canonicalCommand(left.entry.command).localeCompare(canonicalCommand(right.entry.command)))[0];
    if (combatBuy) best = combatBuy.entry;
    else {
      const lateGame = context.profile.strategy.marketRefresh === 'boss-adaptive' && (context.view.self?.history?.defeatedMonsters ?? 0) >= 10;
      const preferredRefreshRow = lateGame || context.view.round % 2 === 0 ? 'item' : 'adventurer';
      const refresh = ranked.find(({ command }) => command.type === 'REFRESH_MARKET' && command.row === preferredRefreshRow)
        ?? ranked.find(({ command }) => command.type === 'REFRESH_MARKET');
      best = refresh ?? ranked.find(({ command }) => command.type === 'END_PHASE') ?? best;
      strategicRotation = Boolean(refresh);
    }
  }
  const alternateEvery = context.profile.strategy.alternateEvery;
  if (!strategicRotation && alternateEvery > 0 && (context.decisionOrdinal ?? 0) > 0 && (context.decisionOrdinal ?? 0) % alternateEvery === 0 && best.score > 0) {
    const mandatory = new Set<GameCommand['type']>(['SELECT_BONDS', 'COMPLETE_BONDS', 'RESOLVE_EFFECT_CHOICE', 'RESOLVE_EFFECT_ORDER', 'RESPOND_COUNTER_CONSENT', 'CANCEL_COUNTER_CONSENT', 'EXPIRE_COUNTER_CONSENT']);
    const discretionary = ranked.filter(({ command, score }) => command.type !== 'END_PHASE' && !mandatory.has(command.type) && Number.isFinite(score) && score > 0).slice(0, 3);
    const alternate = discretionary[1];
    if (alternate && alternate.score >= best.score * context.profile.strategy.alternateMinRatio) best = alternate;
  }
  if (best.score <= 0 && !strategicRotation) best = ranked.find(({ command }) => command.type === 'END_PHASE') ?? best;
  if (!Number.isFinite(best.score) && best.command.type !== 'END_PHASE') return { status: 'blocked', reasonCode: 'MISSING_ACTION_FEATURE', diagnostic: `Missing public action feature for ${best.command.type}.` };
  return { status: 'ready', command: structuredClone(best.command), reasonCode: advancesBossCombat ? 'ADVANCE_BOSS_COMBAT' : reason(best.command), score: best.command.type === 'END_PHASE' ? 0 : best.score, scoreBreakdown: best.terms, contextFingerprint: fingerprint };
}

export class CpuTurnRunner {
  private autonomousSteps = 0;
  private readonly turnActions = new Map<string, number>();
  private readonly visibleStates = new Map<string, number>();
  constructor(readonly profile: CpuProfile = baseBalancedCpuProfile) {}
  step(context: CpuDecisionContext): CpuDecisionResult {
    if (this.autonomousSteps >= this.profile.maxAutonomousSteps) return { status: 'blocked', reasonCode: 'MAX_ACTIONS_EXCEEDED', diagnostic: `Autonomous step limit ${this.profile.maxAutonomousSteps} reached.` };
    const turnKey = `${context.view.round}:${context.view.activePlayerId}`;
    const turnCount = this.turnActions.get(turnKey) ?? 0;
    if (turnCount >= this.profile.maxActionsPerTurn) return { status: 'blocked', reasonCode: 'MAX_ACTIONS_EXCEEDED', diagnostic: `Turn action limit ${this.profile.maxActionsPerTurn} reached for ${turnKey}.` };
    if (context.actionFeatures.some((feature) => feature.schemaVersion !== 2 || !Array.isArray(feature.targetCombatProgress))) return { status: 'blocked', reasonCode: 'MISSING_ACTION_FEATURE', diagnostic: 'CPU action features require schemaVersion 2 targetCombatProgress.' };
    const visibleKey = cpuContextFingerprint(context);
    const repeats = (this.visibleStates.get(visibleKey) ?? 0) + 1;
    if (repeats > this.profile.repeatedVisibleStateLimit) return { status: 'blocked', reasonCode: 'REPEATED_VISIBLE_STATE', diagnostic: `Visible state repeated more than ${this.profile.repeatedVisibleStateLimit} times.` };
    this.visibleStates.set(visibleKey, repeats);
    const decision = decideCpuAction({ ...context, decisionOrdinal: this.autonomousSteps + 1 });
    if (decision.status === 'ready') { this.autonomousSteps += 1; this.turnActions.set(turnKey, turnCount + 1); }
    return decision;
  }
  reset(): void { this.autonomousSteps = 0; this.turnActions.clear(); this.visibleStates.clear(); }
  snapshot(): { autonomousSteps: number; turnActions: [string, number][]; visibleStates: [string, number][] } { return { autonomousSteps: this.autonomousSteps, turnActions: [...this.turnActions], visibleStates: [...this.visibleStates] }; }
  restore(snapshot: ReturnType<CpuTurnRunner['snapshot']>): void { this.autonomousSteps = snapshot.autonomousSteps; this.turnActions.clear(); this.visibleStates.clear(); for (const entry of snapshot.turnActions) this.turnActions.set(...entry); for (const entry of snapshot.visibleStates) this.visibleStates.set(...entry); }
}
