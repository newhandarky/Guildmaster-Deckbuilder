import { z } from 'zod';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');

/** JSON-only activation derived from one authoritative zone. */
export type CardPresenceActivation = {
  kind: 'definition-in-zone';
  zoneId: string;
  definitionId: string;
};

export const CardPresenceActivationSchema: z.ZodType<CardPresenceActivation> = z.object({
  kind: z.literal('definition-in-zone'),
  zoneId: canonicalId,
  definitionId: canonicalId,
}).strict();
