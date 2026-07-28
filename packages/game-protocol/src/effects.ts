/** Versioned, JSON-only effect language. It carries no card presentation data. */
export type EffectPlayerRef = { kind: 'controller' } | { kind: 'context-player'; key: string } | { kind: 'player-id'; playerId: string };
export type EffectCardRef = { kind: 'context-card'; key: string } | { kind: 'card-instance'; cardInstanceId: string };
export type PlayerZoneName = 'drawPile' | 'hand' | 'discardPile' | 'playArea';
export type EffectCardLocation = { kind: 'player-zone'; player: EffectPlayerRef; zone: PlayerZoneName } | { kind: 'party'; player: EffectPlayerRef; position: number } | { kind: 'equipment'; player: EffectPlayerRef; partyPosition: number } | { kind: 'shared-zone'; zoneId: string } | { kind: 'removed' };
export type EffectCondition = { kind: 'always'; value: boolean } | { kind: 'has-card-at'; card: EffectCardRef; location: EffectCardLocation };
export type EffectValueTarget = { kind: 'turn-purchase-bonus'; player: EffectPlayerRef } | { kind: 'turn-combat-bonus'; player: EffectPlayerRef } | { kind: 'player-counter'; player: EffectPlayerRef; resourceId: string };
export type EffectNode =
  | { kind: 'sequence'; effects: readonly EffectNode[] }
  | { kind: 'conditional'; condition: EffectCondition; whenTrue: EffectNode; whenFalse?: EffectNode }
  | { kind: 'choice'; choiceId: string; actor: EffectPlayerRef; options: readonly { id: string; effect: EffectNode }[] }
  | { kind: 'random'; randomId: string; outcomes: readonly { id: string; effect: EffectNode }[] }
  | { kind: 'move-card'; card: EffectCardRef; from: EffectCardLocation; to: EffectCardLocation; position?: 'top' | 'bottom' | number; permission?: 'controller-only' | 'system'; transferOwnership?: boolean }
  | { kind: 'draw'; player: EffectPlayerRef; count: number }
  | { kind: 'discard-card'; card: EffectCardRef; from: EffectCardLocation; permission?: 'controller-only' | 'system' }
  | { kind: 'remove-from-game'; card: EffectCardRef; from: EffectCardLocation; permission?: 'controller-only' | 'system' }
  | { kind: 'modify-value'; target: EffectValueTarget; amount: number };
export type EffectDefinition = { schemaVersion: 1; effectId: string; body: EffectNode };
export type EffectContext = { controllerId: string; cardRefs?: Readonly<Record<string, string>>; playerRefs?: Readonly<Record<string, string>> };
export type PendingEffectChoice = { schemaVersion: 1; executionId: string; choiceId: string; actorId: string; options: readonly { id: string; effect: EffectNode }[]; remaining: readonly EffectNode[]; context: EffectContext };
export type EffectExecutionState = { pendingChoice?: PendingEffectChoice };
/** Registry skeleton: card content is not registered in this PR. */
export type EffectTrigger = { schemaVersion: 1; triggerId: string; eventType: string; effect: EffectDefinition; priority?: number };
export type ContinuousEffect = { schemaVersion: 1; continuousId: string; source: EffectCardRef; duration: 'while-source-present' | 'until-rest' | 'this-turn' | 'this-combat'; effect: EffectDefinition };
export type ReplacementEffect = { schemaVersion: 1; replacementId: string; eventType: string; effect: EffectDefinition; priority?: number };
export type EffectRegistry = { triggers: readonly EffectTrigger[]; continuous: readonly ContinuousEffect[]; replacements: readonly ReplacementEffect[]; orderingPolicy?: 'explicit-priority' };

export function validateEffectDefinition(effect: EffectDefinition): string[] {
  const errors: string[] = []; const seen = new Set<EffectNode>();
  const location = (value: EffectCardLocation, path: string) => { if ((value.kind === 'party' && value.position < 0) || (value.kind === 'equipment' && value.partyPosition < 0)) errors.push(`${path} has a negative party position.`); if (value.kind === 'shared-zone' && !value.zoneId.trim()) errors.push(`${path} requires a zone ID.`); };
  const walk = (node: EffectNode, path: string): void => {
    if (seen.has(node)) { errors.push(`${path} must not contain cyclic effect objects.`); return; } seen.add(node);
    if (node.kind === 'sequence') { if (!node.effects.length) errors.push(`${path} sequence requires effects.`); node.effects.forEach((child, index) => walk(child, `${path}.effects[${index}]`)); }
    if (node.kind === 'conditional') { walk(node.whenTrue, `${path}.whenTrue`); if (node.whenFalse) walk(node.whenFalse, `${path}.whenFalse`); }
    if (node.kind === 'choice' || node.kind === 'random') { const options = node.kind === 'choice' ? node.options : node.outcomes; if (!options.length) errors.push(`${path} requires outcomes/options.`); const ids = new Set<string>(); options.forEach((option, index) => { if (!option.id.trim() || ids.has(option.id)) errors.push(`${path} has duplicate or empty option IDs.`); ids.add(option.id); walk(option.effect, `${path}.options[${index}]`); }); }
    if (node.kind === 'move-card') { location(node.from, `${path}.from`); location(node.to, `${path}.to`); }
    if (node.kind === 'discard-card' || node.kind === 'remove-from-game') location(node.from, `${path}.from`);
    if (node.kind === 'draw' && (!Number.isInteger(node.count) || node.count < 0)) errors.push(`${path} draw count must be a non-negative integer.`); seen.delete(node);
  };
  if (effect.schemaVersion !== 1 || !effect.effectId.trim()) errors.push('Effect definition requires schema version 1 and an effect ID.'); walk(effect.body, 'body'); return errors;
}
