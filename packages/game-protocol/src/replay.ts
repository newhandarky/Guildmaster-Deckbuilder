import { z } from 'zod';
import { CommandEnvelopeSchema, type CommandEnvelope, type DomainEvent } from './commands.js';
import { DomainEventSchema, SnapshotEnvelopeSchema, type VersionedSnapshot } from './snapshot.js';
import type { PlayerKind } from './state.js';
import { isFiniteJsonValue } from './encounter.js';

export const replaySchemaVersion = 1;
export const replayProtocolVersion = 1;

const id = z.string().trim().min(1);
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]));
const player = z.object({ id, name: id, kind: z.enum(['human', 'ai']) }).strict();
const manifest = z.object({ id, version: id, hash: id }).strict();
const moduleFingerprint = z.object({ id, version: id, configFingerprint: z.string(), compositionFingerprint: z.string().optional() }).strict();

export type ReplayRulesModuleFingerprint = { id: string; version: string; configFingerprint: string; compositionFingerprint?: string };
export type ReplayRegistryFingerprint = { engineVersion: string; rulesetVersion: string; contentPacks: readonly { id: string; version: string; hash: string }[]; rulesModules: readonly ReplayRulesModuleFingerprint[] };
export type ReplayInitialConfig = { gameId: string; seed: number; players: readonly { id: string; name: string; kind: PlayerKind }[]; startingPlayerId: string };
export type ReplayDivergence = { path: string; expected: unknown; actual: unknown };
export type ReplayDiagnostic = {
  reasonCode: 'MALFORMED_BUNDLE' | 'UNKNOWN_REPLAY_VERSION' | 'REGISTRY_MISMATCH' | 'CREATE_GAME_FAILED' | 'COMMAND_REJECTED' | 'EXPECTED_EVENTS_MISMATCH' | 'EXPECTED_FINAL_SNAPSHOT_MISMATCH';
  message: string;
  commandIndex?: number;
  commandId?: string;
  expectedRevision?: number;
  actualRevision?: number;
  expected?: unknown;
  actual?: unknown;
  engineErrorCode?: string;
  divergence?: ReplayDivergence;
};
export type ReplayBundle = {
  schemaVersion: 1;
  protocolVersion: 1;
  registry: ReplayRegistryFingerprint;
  initialConfig: ReplayInitialConfig;
  commands: readonly CommandEnvelope[];
  expectedEvents?: readonly DomainEvent[] | undefined;
  expectedFinalSnapshot?: VersionedSnapshot | undefined;
};
export type ReplayResult =
  | { status: 'completed'; finalSnapshot: VersionedSnapshot; events: readonly DomainEvent[] }
  | { status: 'failed'; diagnostic: ReplayDiagnostic };

export const ReplayBundleSchema = z.object({
  schemaVersion: z.literal(replaySchemaVersion),
  protocolVersion: z.literal(replayProtocolVersion),
  registry: z.object({ engineVersion: id, rulesetVersion: id, contentPacks: z.array(manifest), rulesModules: z.array(moduleFingerprint) }).strict(),
  initialConfig: z.object({ gameId: id, seed: z.number().finite().int().refine((value) => value !== 0), players: z.array(player).min(2), startingPlayerId: id }).strict(),
  commands: z.array(CommandEnvelopeSchema),
  expectedEvents: z.array(DomainEventSchema).optional(),
  expectedFinalSnapshot: SnapshotEnvelopeSchema.optional()
}).strict().superRefine((value, context) => {
  if (new Set(value.commands.map((command) => command.commandId)).size !== value.commands.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['commands'], message: 'Replay command IDs must be unique.' });
  if (new Set(value.initialConfig.players.map((candidate) => candidate.id)).size !== value.initialConfig.players.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['initialConfig', 'players'], message: 'Replay players must have unique IDs.' });
  if (!value.initialConfig.players.some((candidate) => candidate.id === value.initialConfig.startingPlayerId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['initialConfig', 'startingPlayerId'], message: 'Replay starting player must be a listed player.' });
  if (new Set(value.registry.contentPacks.map((candidate) => candidate.id)).size !== value.registry.contentPacks.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['registry', 'contentPacks'], message: 'Replay content packs must have unique IDs.' });
  if (new Set(value.registry.rulesModules.map((candidate) => candidate.id)).size !== value.registry.rulesModules.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['registry', 'rulesModules'], message: 'Replay Rules Modules must have unique IDs.' });
});

/** A stable JSON-only representation used for Rules Module config fingerprints. */
export function stableJsonFingerprint(value: unknown): string {
  const visit = (entry: unknown): string => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) throw new Error('Replay fingerprints require finite JSON values.'); return JSON.stringify(entry); }
    if (Array.isArray(entry)) return `[${entry.map(visit).join(',')}]`;
    if (!entry || typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) throw new Error('Replay fingerprints require plain JSON values.');
    return `{${Object.keys(entry as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${visit((entry as Record<string, unknown>)[key])}`).join(',')}}`;
  };
  if (!isFiniteJsonValue(value)) throw new Error('Replay fingerprints require finite, acyclic plain JSON data.');
  jsonValue.parse(value);
  return visit(value);
}
