import { z } from 'zod';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), {
  message: 'Setup contribution identifiers must not contain surrounding whitespace.',
});

/** JSON-only declaration for adding a deterministic card pool during setup. */
export type SetupCardPoolContribution = {
  readonly schemaVersion: 1;
  readonly contributionId: string;
  readonly moduleId: string;
  readonly priority: number;
  readonly selector: { readonly kind: 'definition-type'; readonly value: string };
  readonly count: { readonly kind: 'zone-card-count'; readonly zoneIds: readonly string[] };
  readonly destinationZoneId: string;
  readonly order: 'deterministic-shuffle';
};

export const SetupCardPoolContributionSchema: z.ZodType<SetupCardPoolContribution> = z.object({
  schemaVersion: z.literal(1),
  contributionId: canonicalId,
  moduleId: canonicalId,
  priority: z.number().finite().int().safe(),
  selector: z.object({ kind: z.literal('definition-type'), value: canonicalId }).strict(),
  count: z.object({
    kind: z.literal('zone-card-count'),
    zoneIds: z.array(canonicalId).min(1).refine(
      (zoneIds) => new Set(zoneIds).size === zoneIds.length,
      'Setup contribution count zones must be unique.',
    ),
  }).strict(),
  destinationZoneId: canonicalId,
  order: z.literal('deterministic-shuffle'),
}).strict();

export function validateSetupCardPoolContribution(
  value: SetupCardPoolContribution,
  moduleId: string,
): string[] {
  const parsed = SetupCardPoolContributionSchema.safeParse(value);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((issue) =>
      `Setup contribution invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) {
    errors.push(`Setup contribution ${parsed.data.contributionId} must belong to module ${moduleId}.`);
  }
  return errors;
}
