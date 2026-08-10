import { z } from 'zod';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), {
  message: 'Team capacity enforcement identifiers must not contain surrounding whitespace.',
});

/** JSON-only policy used when a rules change lowers an existing party's capacity. */
export type TeamCapacityEnforcementPolicy = {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly moduleId: string;
  readonly priority: number;
  readonly playerScope: 'all-players';
  readonly mode: 'discard-newest';
  readonly reasonCode: string;
};

export type TeamCapacityEnforcementEvaluation = {
  readonly schemaVersion: 1;
  readonly policy: {
    readonly moduleId: string;
    readonly policyId: string;
    readonly mode: TeamCapacityEnforcementPolicy['mode'];
    readonly reasonCode: string;
  };
  readonly players: readonly {
    readonly playerId: string;
    readonly capacity: number;
    readonly overflowCount: number;
    readonly candidateIds: readonly string[];
  }[];
  readonly registry: {
    readonly rulesetVersion: string;
    readonly modules: readonly { readonly id: string; readonly version: string }[];
  };
};

export const TeamCapacityEnforcementPolicySchema: z.ZodType<TeamCapacityEnforcementPolicy> = z.object({
  schemaVersion: z.literal(1),
  policyId: canonicalId,
  moduleId: canonicalId,
  priority: z.number().finite().int().safe(),
  playerScope: z.literal('all-players'),
  mode: z.literal('discard-newest'),
  reasonCode: canonicalId,
}).strict();

export function validateTeamCapacityEnforcementPolicy(
  value: TeamCapacityEnforcementPolicy,
  moduleId: string,
): string[] {
  const parsed = TeamCapacityEnforcementPolicySchema.safeParse(value);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((issue) =>
      `Team capacity enforcement policy invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`);
  if (parsed.success && parsed.data.moduleId !== moduleId) {
    errors.push(`Team capacity enforcement policy ${parsed.data.policyId} must belong to module ${moduleId}.`);
  }
  return errors;
}
