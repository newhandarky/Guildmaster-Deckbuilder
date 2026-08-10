import { z } from 'zod';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), {
  message: 'Rules Module composition identifiers must not contain surrounding whitespace.',
});

export type RulesModuleDependency = {
  readonly moduleId: string;
  readonly version: string;
};

/**
 * Schema v1 applies only to explicitly selected optional modules. Core modules
 * retain their caller-defined order; optional modules form a later tier ordered
 * by distinct ascending priority.
 */
export type OptionalRulesModuleComposition = {
  readonly schemaVersion: 1;
  readonly kind: 'optional';
  readonly priority: number;
  readonly dependencies?: readonly RulesModuleDependency[] | undefined;
  readonly conflicts?: readonly string[] | undefined;
};

export const OptionalRulesModuleCompositionSchema: z.ZodType<OptionalRulesModuleComposition> = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('optional'),
  priority: z.number().finite().int().safe(),
  dependencies: z.array(z.object({
    moduleId: canonicalId,
    version: canonicalId,
  }).strict()).optional(),
  conflicts: z.array(canonicalId).optional(),
}).strict().superRefine((composition, context) => {
  const dependencyIds = composition.dependencies?.map(({ moduleId }) => moduleId) ?? [];
  if (new Set(dependencyIds).size !== dependencyIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dependencies'],
      message: 'Rules Module composition dependencies must have unique module IDs.',
    });
  }
  const conflicts = composition.conflicts ?? [];
  if (new Set(conflicts).size !== conflicts.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['conflicts'],
      message: 'Rules Module composition conflicts must have unique module IDs.',
    });
  }
  for (const moduleId of dependencyIds) {
    if (conflicts.includes(moduleId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conflicts'],
        message: `Rules Module ${moduleId} cannot be both a dependency and a conflict.`,
      });
    }
  }
});

export function validateOptionalRulesModuleComposition(value: unknown): string[] {
  const result = OptionalRulesModuleCompositionSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.') || 'composition'}: ${issue.message}`);
}

export function canonicalOptionalRulesModuleComposition(
  composition: OptionalRulesModuleComposition,
): OptionalRulesModuleComposition {
  const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  return {
    schemaVersion: 1,
    kind: 'optional',
    priority: composition.priority,
    ...(composition.dependencies?.length
      ? { dependencies: [...composition.dependencies].sort((left, right) =>
        compare(left.moduleId, right.moduleId) || compare(left.version, right.version)) }
      : {}),
    ...(composition.conflicts?.length
      ? { conflicts: [...composition.conflicts].sort(compare) }
      : {}),
  };
}
