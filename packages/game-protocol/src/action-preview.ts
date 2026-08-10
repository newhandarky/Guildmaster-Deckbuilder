import { z } from 'zod';
import type { GameCommand } from './commands.js';

type AttackCommand = Extract<GameCommand, { type: 'ATTACK_TARGET' }>;
type PurchaseCommand = Extract<GameCommand, { type: 'BUY_CARD' }>;

export type AttackPreviewOutcome =
  | { kind: 'defeat-target' | 'remove-target' }
  | {
      kind: 'damage-target';
      requestedDamage: number;
      actualDamage: number;
      healthBefore: number;
      healthAfter: number;
      lethal: boolean;
      lethalOutcome: 'defeated' | 'removed';
    };

export type ActionPreviewItem =
  | {
      kind: 'attack';
      status: 'ready';
      command: AttackCommand;
      targetId: string;
      requiredCombat: number;
      committedCombat: number;
      surplusCombat: number;
      partySlotCount: number;
      participantCardIds: readonly string[];
      outcome: AttackPreviewOutcome;
    }
  | {
      kind: 'attack';
      status: 'requires-lifecycle';
      command: AttackCommand;
      targetId: string;
    }
  | {
      kind: 'purchase';
      status: 'requires-lifecycle';
      command: PurchaseCommand;
      cardId: string;
    }
  | {
      kind: 'purchase';
      status: 'ready';
      command: PurchaseCommand;
      cardId: string;
      printedCost: number;
      effectiveCost: number;
      appliedModifiers: readonly { moduleId: string; ruleId: string; amount: number }[];
      availablePurchasePower: number;
      remainingPurchasePower: number;
    };

export type ActionPreviewSet = {
  schemaVersion: 2;
  gameId: string;
  revision: number;
  actorId: string;
  items: readonly ActionPreviewItem[];
};

const nonEmpty = z.string().trim().min(1);
const nonNegative = z.number().finite().nonnegative();
const attackCommandSchema: z.ZodType<AttackCommand> = z.object({ type: z.literal('ATTACK_TARGET'), targetId: nonEmpty }).strict();
const purchaseCommandSchema: z.ZodType<PurchaseCommand> = z.object({ type: z.literal('BUY_CARD'), cardId: nonEmpty }).strict();
const directOutcomeSchema = z.object({ kind: z.enum(['defeat-target', 'remove-target']) }).strict();
const damageOutcomeSchema = z.object({
  kind: z.literal('damage-target'),
  requestedDamage: z.number().finite().int().positive(),
  actualDamage: z.number().finite().int().nonnegative(),
  healthBefore: z.number().finite().int().nonnegative(),
  healthAfter: z.number().finite().int().nonnegative(),
  lethal: z.boolean(),
  lethalOutcome: z.enum(['defeated', 'removed']),
}).strict().superRefine((value, context) => {
  if (value.actualDamage > value.requestedDamage || value.actualDamage > value.healthBefore) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['actualDamage'], message: 'Damage preview exceeds the requested damage or current health.' });
  }
  if (value.healthAfter !== value.healthBefore - value.actualDamage) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['healthAfter'], message: 'Damage preview health delta is inconsistent.' });
  }
  if (value.lethal !== (value.healthAfter === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['lethal'], message: 'Damage preview lethal flag is inconsistent.' });
  }
});

const attackReadySchema = z.object({
  kind: z.literal('attack'),
  status: z.literal('ready'),
  command: attackCommandSchema,
  targetId: nonEmpty,
  requiredCombat: nonNegative,
  committedCombat: nonNegative,
  surplusCombat: nonNegative,
  partySlotCount: z.number().finite().int().nonnegative(),
  participantCardIds: z.array(nonEmpty),
  outcome: z.union([directOutcomeSchema, damageOutcomeSchema]),
}).strict().superRefine((value, context) => {
  if (value.command.targetId !== value.targetId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: 'Attack preview target must match its command.' });
  if (value.committedCombat - value.requiredCombat !== value.surplusCombat) context.addIssue({ code: z.ZodIssueCode.custom, path: ['surplusCombat'], message: 'Attack preview surplus is inconsistent.' });
  if (new Set(value.participantCardIds).size !== value.participantCardIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['participantCardIds'], message: 'Attack preview participant IDs must be unique.' });
  if (value.participantCardIds.length < value.partySlotCount || value.participantCardIds.length > value.partySlotCount * 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ['participantCardIds'], message: 'Attack preview participants must match the committed party-slot prefix.' });
});

const attackLifecycleSchema = z.object({
  kind: z.literal('attack'),
  status: z.literal('requires-lifecycle'),
  command: attackCommandSchema,
  targetId: nonEmpty,
}).strict().superRefine((value, context) => {
  if (value.command.targetId !== value.targetId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: 'Attack preview target must match its command.' });
});

const purchaseSchema = z.object({
  kind: z.literal('purchase'),
  status: z.literal('ready'),
  command: purchaseCommandSchema,
  cardId: nonEmpty,
  printedCost: nonNegative,
  effectiveCost: nonNegative,
  appliedModifiers: z.array(z.object({ moduleId: nonEmpty, ruleId: nonEmpty, amount: z.number().finite().int() }).strict()),
  availablePurchasePower: nonNegative,
  remainingPurchasePower: nonNegative,
}).strict().superRefine((value, context) => {
  if (value.command.cardId !== value.cardId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['cardId'], message: 'Purchase preview card must match its command.' });
  if (value.availablePurchasePower - value.effectiveCost !== value.remainingPurchasePower) context.addIssue({ code: z.ZodIssueCode.custom, path: ['remainingPurchasePower'], message: 'Purchase preview remaining power is inconsistent.' });
  if (Math.max(0, value.printedCost + value.appliedModifiers.reduce((sum, modifier) => sum + modifier.amount, 0)) !== value.effectiveCost) context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveCost'], message: 'Purchase preview modifiers do not produce the effective cost.' });
});

const purchaseLifecycleSchema = z.object({
  kind: z.literal('purchase'),
  status: z.literal('requires-lifecycle'),
  command: purchaseCommandSchema,
  cardId: nonEmpty,
}).strict().superRefine((value, context) => {
  if (value.command.cardId !== value.cardId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['cardId'], message: 'Purchase preview card must match its command.' });
});

export const ActionPreviewItemSchema: z.ZodType<ActionPreviewItem> = z.union([attackReadySchema, attackLifecycleSchema, purchaseSchema, purchaseLifecycleSchema]);
export const ActionPreviewSetSchema: z.ZodType<ActionPreviewSet> = z.object({
  schemaVersion: z.literal(2),
  gameId: nonEmpty,
  revision: z.number().finite().int().nonnegative(),
  actorId: nonEmpty,
  items: z.array(ActionPreviewItemSchema),
}).strict().superRefine((value, context) => {
  const commandKeys = value.items.map(({ command }) => JSON.stringify(command));
  if (new Set(commandKeys).size !== commandKeys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Action previews must contain unique commands.' });
});
