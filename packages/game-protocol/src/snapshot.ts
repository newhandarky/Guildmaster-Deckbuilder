import { z } from 'zod';
import type { GameState } from './state.js';

export type VersionedSnapshot = { schemaVersion: 1; engineVersion: string; rulesetVersion: string; state: GameState };

export const SnapshotEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  engineVersion: z.string(),
  rulesetVersion: z.string(),
  state: z.unknown()
});
