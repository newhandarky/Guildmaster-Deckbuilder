import type { CardDefinition, ContentPack, CpuActionFeature, GameCommand, PlayerView } from '@guildmaster/game-protocol';

export type CpuReasonCode =
  | 'KEEP_HIGHEST_BOND_VALUE' | 'ATTACK_BEST_NET_VALUE' | 'PLAY_FOR_PARTY_POWER'
  | 'EQUIP_FOR_COMBAT_GAIN' | 'USE_ITEM_FOR_IMMEDIATE_VALUE' | 'BUY_HIGHEST_UTILITY'
  | 'REFRESH_LOW_VALUE_MARKET' | 'DISCARD_LOWEST_UTILITY' | 'END_NO_POSITIVE_ACTION'
  | 'RESOLVE_HIGHEST_UTILITY_CHOICE' | 'RESPOND_REQUIRED_CONSENT' | 'BLOCKED_UNSUPPORTED_DECISION';

export type CpuScoringWeights = {
  honor: number; bondHonor: number; bossProgress: number; monsterDefeat: number;
  permanentPurchasePower: number; partyCombat: number; draw: number; removal: number;
  immediatePower: number; purchaseCost: number; partyCombatLoss: number; equipmentLoss: number; overflowLoss: number;
};
export type CpuProfile = {
  schemaVersion: 1; profileId: 'base:cpu-balanced'; version: '1.0.0';
  commandPriority: readonly GameCommand['type'][]; weights: CpuScoringWeights;
  maxActionsPerTurn: 128; maxAutonomousSteps: 512; repeatedVisibleStateLimit: 3;
};
export type CpuScoreTerm = { feature: keyof CpuScoringWeights; value: number; weight: number; contribution: number };
export type CpuDecisionContext = {
  view: PlayerView; legalCommands: readonly GameCommand[]; actionFeatures: readonly CpuActionFeature[];
  definitions: Readonly<Record<string, CardDefinition>>; bonds?: NonNullable<ContentPack['bonds']>;
  rulesetFingerprint: string; profile: CpuProfile;
};
export type CpuDecisionResult =
  | { status: 'ready'; command: GameCommand; reasonCode: CpuReasonCode; score: number; scoreBreakdown: readonly CpuScoreTerm[]; contextFingerprint: string }
  | { status: 'blocked'; reasonCode: 'UNSUPPORTED_DECISION_KIND' | 'NO_LEGAL_COMMAND' | 'MISSING_ACTION_FEATURE' | 'REPEATED_VISIBLE_STATE' | 'MAX_ACTIONS_EXCEEDED'; diagnostic: string };

export const baseBalancedCpuProfile: CpuProfile = Object.freeze<CpuProfile>({
  schemaVersion: 1, profileId: 'base:cpu-balanced', version: '1.0.0',
  commandPriority: ['SELECT_BONDS', 'RESOLVE_EFFECT_CHOICE', 'RESPOND_COUNTER_CONSENT', 'ATTACK_TARGET', 'PLAY_ADVENTURER', 'EQUIP_ITEM', 'USE_ITEM', 'BUY_CARD', 'REFRESH_MARKET', 'END_PHASE', 'CANCEL_COUNTER_CONSENT', 'EXPIRE_COUNTER_CONSENT'],
  weights: { honor: 100, bondHonor: 100, bossProgress: 80, monsterDefeat: 30, permanentPurchasePower: 18, partyCombat: 12, draw: 10, removal: 20, immediatePower: 8, purchaseCost: -6, partyCombatLoss: -12, equipmentLoss: -10, overflowLoss: -1 },
  maxActionsPerTurn: 128, maxAutonomousSteps: 512, repeatedVisibleStateLimit: 3,
});

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const canonicalCommand = (command: GameCommand): string => stable(command);
export function cpuContextFingerprint(context: CpuDecisionContext): string {
  return stable({ view: context.view, legalCommands: context.legalCommands, actionFeatures: context.actionFeatures, rulesetFingerprint: context.rulesetFingerprint, profile: { id: context.profile.profileId, version: context.profile.version } });
}

function reason(command: GameCommand): CpuReasonCode {
  if (command.type === 'SELECT_BONDS') return 'KEEP_HIGHEST_BOND_VALUE';
  if (command.type === 'ATTACK_TARGET') return 'ATTACK_BEST_NET_VALUE';
  if (command.type === 'PLAY_ADVENTURER') return 'PLAY_FOR_PARTY_POWER';
  if (command.type === 'EQUIP_ITEM') return 'EQUIP_FOR_COMBAT_GAIN';
  if (command.type === 'USE_ITEM') return 'USE_ITEM_FOR_IMMEDIATE_VALUE';
  if (command.type === 'BUY_CARD') return 'BUY_HIGHEST_UTILITY';
  if (command.type === 'REFRESH_MARKET') return 'REFRESH_LOW_VALUE_MARKET';
  if (command.type === 'RESPOND_COUNTER_CONSENT' || command.type === 'CANCEL_COUNTER_CONSENT' || command.type === 'EXPIRE_COUNTER_CONSENT') return 'RESPOND_REQUIRED_CONSENT';
  if (command.type === 'RESOLVE_EFFECT_CHOICE') return 'RESOLVE_HIGHEST_UTILITY_CHOICE';
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
    ['equipmentLoss', feature.equipmentLoss], ['overflowLoss', feature.overflowLoss],
  ];
  const terms = raw.filter(([, value]) => value !== 0).map(([featureName, value]) => ({ feature: featureName, value, weight: weights[featureName], contribution: value * weights[featureName] }));
  return { score: terms.reduce((sum, term) => sum + term.contribution, 0), terms };
}

export function decideCpuAction(context: CpuDecisionContext): CpuDecisionResult {
  const fingerprint = cpuContextFingerprint(context);
  if (!context.legalCommands.length) return { status: 'blocked', reasonCode: 'NO_LEGAL_COMMAND', diagnostic: `No legal command at revision ${context.view.revision}.` };
  if (context.legalCommands.some(({ type }) => type === 'RESOLVE_EFFECT_CHOICE') && !context.view.decisionPrompt) return { status: 'blocked', reasonCode: 'UNSUPPORTED_DECISION_KIND', diagnostic: 'Effect choice has no typed PlayerDecisionPrompt; CPU stopped without guessing.' };
  const priority = new Map(context.profile.commandPriority.map((type, index) => [type, index]));
  const ranked = context.legalCommands.map((command) => {
    if (command.type === 'SELECT_BONDS') {
      const honor = command.bondIds.reduce((sum, id) => sum + (context.bonds?.find((bond) => bond.id === id)?.honor ?? 0), 0);
      return { command, score: honor * context.profile.weights.bondHonor + 1_000_000, terms: [{ feature: 'bondHonor' as const, value: honor, weight: context.profile.weights.bondHonor, contribution: honor * context.profile.weights.bondHonor }] };
    }
    if (command.type === 'RESPOND_COUNTER_CONSENT') return { command, score: command.response === 'accept' ? 1_000_000 : 999_999, terms: [] as CpuScoreTerm[] };
    if (command.type === 'RESOLVE_EFFECT_CHOICE') {
      const prompt = context.view.decisionPrompt;
      const option = prompt?.options.find(({ id }) => id === command.optionId);
      const targetCardId = option?.cardId ?? context.view.enemyTargets[option?.id ?? '']?.cardInstanceId;
      const utility = definitionUtility(targetCardId ? context.definitions[context.view.cards[targetCardId]?.definitionId ?? option?.definitionId ?? ''] : undefined);
      const losesCard = prompt?.decisionKind === 'discard-card' || prompt?.decisionKind === 'remove-card' || prompt?.decisionKind === 'choose-party-member' || prompt?.decisionKind === 'transfer-card';
      return { command, score: 1_000_000 + (losesCard ? -utility : utility), terms: [] as CpuScoreTerm[] };
    }
    const feature = context.actionFeatures.find((candidate) => canonicalCommand(candidate.command) === canonicalCommand(command));
    if (!feature) return { command, score: command.type === 'END_PHASE' ? 0 : Number.NEGATIVE_INFINITY, terms: [] as CpuScoreTerm[] };
    const scored = scoreFeature(feature, context.profile.weights);
    if (command.type === 'REFRESH_MARKET') scored.score = -1;
    return { command, score: scored.score, terms: scored.terms };
  }).sort((left, right) => right.score - left.score || (priority.get(left.command.type) ?? 999) - (priority.get(right.command.type) ?? 999) || canonicalCommand(left.command).localeCompare(canonicalCommand(right.command)));
  let best = ranked[0]!;
  if (best.score <= 0) best = ranked.find(({ command }) => command.type === 'END_PHASE') ?? best;
  if (!Number.isFinite(best.score) && best.command.type !== 'END_PHASE') return { status: 'blocked', reasonCode: 'MISSING_ACTION_FEATURE', diagnostic: `Missing public action feature for ${best.command.type}.` };
  return { status: 'ready', command: structuredClone(best.command), reasonCode: reason(best.command), score: best.command.type === 'END_PHASE' ? 0 : best.score, scoreBreakdown: best.terms, contextFingerprint: fingerprint };
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
    const visibleKey = cpuContextFingerprint(context);
    const repeats = (this.visibleStates.get(visibleKey) ?? 0) + 1;
    if (repeats > this.profile.repeatedVisibleStateLimit) return { status: 'blocked', reasonCode: 'REPEATED_VISIBLE_STATE', diagnostic: `Visible state repeated more than ${this.profile.repeatedVisibleStateLimit} times.` };
    this.visibleStates.set(visibleKey, repeats);
    const decision = decideCpuAction(context);
    if (decision.status === 'ready') { this.autonomousSteps += 1; this.turnActions.set(turnKey, turnCount + 1); }
    return decision;
  }
  reset(): void { this.autonomousSteps = 0; this.turnActions.clear(); this.visibleStates.clear(); }
  snapshot(): { autonomousSteps: number; turnActions: [string, number][]; visibleStates: [string, number][] } { return { autonomousSteps: this.autonomousSteps, turnActions: [...this.turnActions], visibleStates: [...this.visibleStates] }; }
  restore(snapshot: ReturnType<CpuTurnRunner['snapshot']>): void { this.autonomousSteps = snapshot.autonomousSteps; this.turnActions.clear(); this.visibleStates.clear(); for (const entry of snapshot.turnActions) this.turnActions.set(...entry); for (const entry of snapshot.visibleStates) this.visibleStates.set(...entry); }
}
