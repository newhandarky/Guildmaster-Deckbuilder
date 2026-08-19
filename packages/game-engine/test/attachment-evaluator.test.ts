import { describe, expect, it } from 'vitest';
import type { AttachmentPolicy } from '@guildmaster/game-protocol';
import { attachedCardIds, baseRulesModule, createGame, createRuleset, dispatch, envelope, evaluateAttachment, evaluatePartyCombat, getLegalCommands, restoreSnapshot, serializeSnapshot, type RulesModule } from '../src/index.js';
import { testPack } from './fixtures.js';

const policies: AttachmentPolicy[] = [
  { schemaVersion: 1, moduleId: 'test:attachments', policyId: 'three-equipment', priority: 10, sourceDefinitionTypes: ['equipment'], wearerDefinitionIds: ['test:starter/adventurer'], capacity: 3, combatContribution: 'printed-combat', reasonCode: 'THREE_EQUIPMENT' },
  { schemaVersion: 1, moduleId: 'test:attachments', policyId: 'adventurer-as-attachment', priority: 20, sourceDefinitionIds: ['test:adventurer/a'], wearerDefinitionIds: ['test:starter/adventurer'], capacity: 3, combatContribution: 'fixed', fixedCombat: 2, reasonCode: 'ADVENTURER_AS_ATTACHMENT' },
];
const module: RulesModule = { id: 'test:attachments', version: '1', attachmentPolicies: policies, getPartyLimit: (_state, _player, limit) => limit, onSupplyDepleted: () => 'handled' };
const ruleset = () => createRuleset([testPack], [baseRulesModule, module]);

function removeEverywhere(state: ReturnType<typeof createGame>, cardId: string): void {
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== cardId);
  for (const player of state.players) {
    player.hand = player.hand.filter((id) => id !== cardId); player.drawPile = player.drawPile.filter((id) => id !== cardId);
    player.discardPile = player.discardPile.filter((id) => id !== cardId); player.playArea = player.playArea.filter((id) => id !== cardId);
    player.party = player.party.filter(({ adventurerId }) => adventurerId !== cardId);
  }
}

describe('generic attachment and equipment-capacity evaluator', () => {
  it('adds three ordered attachments, survives Snapshot, and requires an explicit full-slot replacement', () => {
    const activeRuleset = ruleset();
    let state = createGame({ gameId: 'attachment-capacity', seed: 71, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }], startingPlayerId: 'p1' }, activeRuleset);
    const player = state.players[0]!; const wearerId = player.party[0]!.adventurerId;
    const equipmentIds = Object.values(state.cards).filter(({ definitionId }) => definitionId === 'test:item/spear').map(({ id }) => id);
    const adventurerId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:adventurer/a')!.id;
    for (const cardId of [...equipmentIds, adventurerId]) { removeEverywhere(state, cardId); state.cards[cardId]!.ownerId = player.id; player.hand.push(cardId); }
    for (const [index, cardId] of equipmentIds.entries()) {
      const evaluation = evaluateAttachment(state, activeRuleset, { schemaVersion: 1, playerId: player.id, cardId, adventurerId: wearerId });
      expect(evaluation).toMatchObject({ status: 'ready', evaluation: { eligible: true, capacity: 3, requiresReplacement: false } });
      const command = getLegalCommands(state, activeRuleset, player.id).find((candidate) => candidate.type === 'ATTACH_CARD' && candidate.cardId === cardId);
      expect(command).toEqual({ type: 'ATTACH_CARD', cardId, adventurerId: wearerId });
      const result = dispatch(state, activeRuleset, envelope(state, player.id, command!)); expect(result.error).toBeUndefined(); state = result.state;
      if (index === 1) state = restoreSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(state))), activeRuleset);
    }
    expect(attachedCardIds(state.players[0]!.party[0]!)).toEqual(equipmentIds);
    const threeAttachedCombat = evaluatePartyCombat(state, activeRuleset, { schemaVersion: 1, playerId: player.id });
    expect(threeAttachedCombat.status === 'ready' ? threeAttachedCombat.evaluation.members[0]?.equipmentCombat : undefined).toBe(3);
    const replacements = getLegalCommands(state, activeRuleset, player.id).filter((candidate) => candidate.type === 'ATTACH_CARD' && candidate.cardId === adventurerId && candidate.adventurerId === wearerId);
    expect(replacements).toHaveLength(3);
    expect(new Set(replacements.map((command) => command.type === 'ATTACH_CARD' ? command.replaceCardId : undefined))).toEqual(new Set(equipmentIds));
    const forged = { type: 'ATTACH_CARD' as const, cardId: adventurerId, adventurerId: wearerId, replaceCardId: 'missing' };
    const before = structuredClone(state); const rejected = dispatch(state, activeRuleset, envelope(state, player.id, forged));
    expect(rejected.error?.code).toBe('INVALID_COMMAND'); expect(rejected.state).toEqual(before); expect(rejected.events).toEqual([]);
    const accepted = dispatch(state, activeRuleset, envelope(state, player.id, replacements[1]!));
    expect(accepted.error).toBeUndefined(); expect(attachedCardIds(accepted.state.players[0]!.party[0]!)).toEqual([equipmentIds[0], adventurerId, equipmentIds[2]]);
    expect(accepted.state.players[0]!.discardPile).toContain(equipmentIds[1]);
    const replacedCombat = evaluatePartyCombat(accepted.state, activeRuleset, { schemaVersion: 1, playerId: player.id });
    expect(replacedCombat.status === 'ready' ? replacedCombat.evaluation.members[0]?.equipmentCombat : undefined).toBe(4);
  });

  it('fails closed for unknown selectors and ambiguous matching priority', () => {
    expect(() => createRuleset([testPack], [baseRulesModule, { ...module, attachmentPolicies: [{ ...policies[0]!, sourceDefinitionIds: ['missing'] }] }])).toThrow('unknown definition');
    const ambiguous: RulesModule = { ...module, attachmentPolicies: [policies[0]!, { ...policies[0]!, policyId: 'same-priority' }] };
    const activeRuleset = createRuleset([testPack], [baseRulesModule, ambiguous]); const state = createGame({ gameId: 'ambiguous-attachment', seed: 73, players: [{ id: 'p1', name: 'P1', kind: 'human' }, { id: 'p2', name: 'P2', kind: 'ai' }] }, activeRuleset);
    const player = state.players[0]!; const cardId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'test:item/spear')!.id; removeEverywhere(state, cardId); player.hand.push(cardId);
    expect(evaluateAttachment(state, activeRuleset, { schemaVersion: 1, playerId: player.id, cardId, adventurerId: player.party[0]!.adventurerId })).toMatchObject({ status: 'unsupported', reason: 'ORDER_POLICY_REQUIRED' });
  });
});
