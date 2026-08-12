import type { GameCommand } from './commands.js';

export type CpuActionFeature = {
  schemaVersion: 1;
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
  overflowLoss: number;
};
