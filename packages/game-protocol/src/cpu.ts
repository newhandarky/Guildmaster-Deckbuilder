import type { GameCommand } from './commands.js';

export type CpuTargetCombatProgress = {
  targetId: string;
  targetKind: string;
  requiredCombat: number;
  effectiveCombatBefore: number;
  effectiveCombatAfter: number;
  shortfallBefore: number;
  shortfallAfter: number;
  attackReadyBefore: boolean;
  attackReadyAfter: boolean;
};

export type CpuActionFeature = {
  schemaVersion: 2;
  command: GameCommand;
  honorGain: number;
  bondHonorGain: number;
  bossProgress: number;
  monsterDefeat: number;
  permanentPurchasePower: number;
  partyCombatGain: number;
  cardsDrawn: number;
  removalValue: number;
  immediatePurchasePower: number;
  immediateCombatPower: number;
  purchaseCost: number;
  partyCombatLoss: number;
  equipmentLoss: number;
  equipmentRemoval: number;
  overflowLoss: number;
  targetCombatProgress: readonly CpuTargetCombatProgress[];
};
