import { z } from 'zod';

const canonicalId = z.string().min(1).refine((value) => value === value.trim(), 'Value must not have leading or trailing whitespace.');

/** JSON-only activation derived from one authoritative zone. */
export type CardPresenceActivation =
  | { kind: 'definition-in-zone'; zoneId: string; definitionId: string }
  | { kind: 'definition-in-player-party'; player: 'evaluated-player' | 'active-player'; definitionId: string };

export const CardPresenceActivationSchema: z.ZodType<CardPresenceActivation> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('definition-in-zone'), zoneId: canonicalId, definitionId: canonicalId }).strict(),
  z.object({ kind: z.literal('definition-in-player-party'), player: z.enum(['evaluated-player', 'active-player']), definitionId: canonicalId }).strict(),
]);
