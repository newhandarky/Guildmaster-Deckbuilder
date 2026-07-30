import { z } from 'zod';
import { isFiniteJsonValue } from './encounter.js';

export type DiceDefinition = { schemaVersion: 1; moduleId: string; diceId: string; sides: number };
export type DiceRegistryFingerprint = { rulesetVersion: string; modules: readonly { id: string; version: string }[] };
export type DiceRollInput = { schemaVersion: 1; moduleId: string; diceId: string; randomValue: number; registry: DiceRegistryFingerprint };
export type DiceRollEvaluation = { schemaVersion: 1; input: DiceRollInput; face: number };
export type DiceRollEventPayload = { schemaVersion: 1; kind: 'dice-roll'; evaluation: DiceRollEvaluation };

const nonEmpty = z.string().trim().min(1);
export const DiceDefinitionSchema: z.ZodType<DiceDefinition> = z.object({ schemaVersion: z.literal(1), moduleId: nonEmpty, diceId: nonEmpty, sides: z.number().finite().int().min(2) }).strict();
export const DiceRollEvaluationSchema: z.ZodType<DiceRollEvaluation> = z.object({ schemaVersion: z.literal(1), input: z.object({ schemaVersion: z.literal(1), moduleId: nonEmpty, diceId: nonEmpty, randomValue: z.number().finite().min(0).lt(1), registry: z.object({ rulesetVersion: nonEmpty, modules: z.array(z.object({ id: nonEmpty, version: nonEmpty }).strict()) }).strict() }).strict(), face: z.number().finite().int().positive() }).strict();
export const DiceRollEventPayloadSchema: z.ZodType<DiceRollEventPayload> = z.object({ schemaVersion: z.literal(1), kind: z.literal('dice-roll'), evaluation: DiceRollEvaluationSchema }).strict();

export function validateDiceDefinition(definition: DiceDefinition, moduleId: string): string[] {
  if (!isFiniteJsonValue(definition)) return ['Dice definition must contain finite, acyclic, plain JSON data only.'];
  const parsed = DiceDefinitionSchema.safeParse(definition);
  if (!parsed.success) return parsed.error.issues.map((issue) => `Dice definition invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  return parsed.data.moduleId === moduleId ? [] : [`Dice definition ${parsed.data.diceId} must belong to module ${moduleId}.`];
}
