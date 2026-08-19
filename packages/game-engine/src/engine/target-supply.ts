import type { GameState } from '@guildmaster/game-protocol';
import { baseZoneIds } from '../model/zones.js';
import { applyEnemyEntryAttachment } from '../rules/enemy-attachment-evaluator.js';
import type { Ruleset } from '../rules/ruleset.js';

/** Synchronizes public enemy-row cards with their authoritative target records. */
export function attachTargets(state: GameState, ruleset?: Ruleset): void {
  const encounter = state.enemyEncounters.find(({ encounterId }) => encounterId === 'base:enemies');
  if (!encounter) throw new Error('Missing base enemy encounter.');
  const rows: [string, string, string][] = [
    ...state.zones[baseZoneIds.monsterRow]!.cardIds.map((id) => [id, 'monster', baseZoneIds.monsterRow] as [string, string, string]),
    ...state.zones[baseZoneIds.bossRow]!.cardIds.map((id) => [id, 'boss', baseZoneIds.bossRow] as [string, string, string]),
  ];
  for (const [cardInstanceId, kind, zoneId] of rows) {
    if (Object.values(state.enemyTargets).some((target) => target.cardInstanceId === cardInstanceId && target.status !== 'defeated' && target.status !== 'removed')) continue;
    let sequence = Object.keys(state.enemyTargets).length + 1;
    while (state.enemyTargets[`base:target-${sequence}`]) sequence += 1;
    const targetId = `base:target-${sequence}`;
    const target = state.enemyTargets[targetId] = { targetId, cardInstanceId, kind, status: 'available', parentEncounterId: encounter.encounterId, zoneId, attachments: [], moduleState: {} };
    if (ruleset) applyEnemyEntryAttachment(state, ruleset, target);
    encounter.targetIds.push(targetId);
  }
}
