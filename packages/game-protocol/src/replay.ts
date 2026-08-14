import { z } from 'zod';
import { CommandEnvelopeSchema, GameCommandSchema, type CommandEnvelope, type DomainEvent } from './commands.js';
import { DomainEventSchema, SnapshotEnvelopeSchema, type VersionedSnapshot } from './snapshot.js';
import type { PlayerKind } from './state.js';
import { isFiniteJsonValue } from './encounter.js';

export const replaySchemaVersion = 2;
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
type ReplayBundleBase = {
  protocolVersion: 1;
  registry: ReplayRegistryFingerprint;
  initialConfig: ReplayInitialConfig;
  commands: readonly CommandEnvelope[];
  expectedEvents?: readonly DomainEvent[] | undefined;
  expectedFinalSnapshot?: VersionedSnapshot | undefined;
};
export type ReplayAutomationDecision = { commandId: string; revision: number; actorId: string; command: CommandEnvelope['command']; reasonCode: string; score: number; scoreBreakdown: readonly { feature: string; value: number; weight: number; contribution: number }[]; contextFingerprint: string; legalCommandsFingerprint: string; actionFeaturesFingerprint: string };
export type ReplayAutomation = { profileId: string; profileVersion: string; runner: { autonomousSteps: number; turnActions: readonly [string, number][]; visibleStates: readonly [string, number][] }; decisions: readonly ReplayAutomationDecision[] };
export type ReplayBundle = ReplayBundleBase & (
  | { schemaVersion: 1; automation?: { profileId: string; profileVersion: string; decisions: readonly { revision: number; actorId: string; command: CommandEnvelope['command']; reasonCode: string; score: number }[] } | undefined }
  | { schemaVersion: 2; automation: ReplayAutomation }
);
export type ReplayResult =
  | { status: 'completed'; finalSnapshot: VersionedSnapshot; events: readonly DomainEvent[] }
  | { status: 'failed'; diagnostic: ReplayDiagnostic };

const legacyAutomation = z.object({ profileId: id, profileVersion: id, decisions: z.array(z.object({ revision: z.number().int().nonnegative(), actorId: id, command: GameCommandSchema, reasonCode: id, score: z.number().finite() }).strict()) }).strict();
const automationDecision = z.object({ commandId: id, revision: z.number().int().nonnegative(), actorId: id, command: GameCommandSchema, reasonCode: id, score: z.number().finite(), scoreBreakdown: z.array(z.object({ feature: id, value: z.number().finite(), weight: z.number().finite(), contribution: z.number().finite() }).strict()), contextFingerprint: id, legalCommandsFingerprint: id, actionFeaturesFingerprint: id }).strict();
const automation = z.object({ profileId: id, profileVersion: id, runner: z.object({ autonomousSteps: z.number().int().nonnegative(), turnActions: z.array(z.tuple([id, z.number().int().nonnegative()])), visibleStates: z.array(z.tuple([id, z.number().int().nonnegative()])) }).strict(), decisions: z.array(automationDecision) }).strict();
export const ReplayAutomationSchema = automation;
const replayBaseSchema = z.object({
  protocolVersion: z.literal(replayProtocolVersion),
  registry: z.object({ engineVersion: id, rulesetVersion: id, contentPacks: z.array(manifest), rulesModules: z.array(moduleFingerprint) }).strict(),
  initialConfig: z.object({ gameId: id, seed: z.number().finite().int().refine((value) => value !== 0), players: z.array(player).min(2), startingPlayerId: id }).strict(),
  commands: z.array(CommandEnvelopeSchema),
  expectedEvents: z.array(DomainEventSchema).optional(),
  expectedFinalSnapshot: SnapshotEnvelopeSchema.optional(),
}).strict();
export const ReplayBundleSchema = z.discriminatedUnion('schemaVersion', [
  replayBaseSchema.extend({ schemaVersion: z.literal(1), automation: legacyAutomation.optional() }).strict(),
  replayBaseSchema.extend({ schemaVersion: z.literal(replaySchemaVersion), automation }).strict(),
]).superRefine((value, context) => {
  if (new Set(value.commands.map((command) => command.commandId)).size !== value.commands.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['commands'], message: 'Replay command IDs must be unique.' });
  if (new Set(value.initialConfig.players.map((candidate) => candidate.id)).size !== value.initialConfig.players.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['initialConfig', 'players'], message: 'Replay players must have unique IDs.' });
  if (!value.initialConfig.players.some((candidate) => candidate.id === value.initialConfig.startingPlayerId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['initialConfig', 'startingPlayerId'], message: 'Replay starting player must be a listed player.' });
  if (new Set(value.registry.contentPacks.map((candidate) => candidate.id)).size !== value.registry.contentPacks.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['registry', 'contentPacks'], message: 'Replay content packs must have unique IDs.' });
  if (new Set(value.registry.rulesModules.map((candidate) => candidate.id)).size !== value.registry.rulesModules.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['registry', 'rulesModules'], message: 'Replay Rules Modules must have unique IDs.' });
  if (value.automation?.decisions.some((decision) => !value.initialConfig.players.some(({ id: playerId, kind }) => playerId === decision.actorId && kind === 'ai'))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['automation', 'decisions'], message: 'Automation decisions must belong to configured AI players.' });
  if (value.schemaVersion === 2) {
      const decisions = value.automation.decisions;
      if (new Set(decisions.map(({ commandId }) => commandId)).size !== decisions.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['automation', 'decisions'], message: 'Replay automation command IDs must be unique.' });
      const aiCommands = value.commands.filter((command) => value.initialConfig.players.some(({ id: playerId, kind }) => playerId === command.actorId && kind === 'ai'));
      if (aiCommands.length !== decisions.length || aiCommands.some((command, index) => {
        const decision = decisions[index];
        return !decision || decision.commandId !== command.commandId || decision.actorId !== command.actorId || decision.revision !== command.expectedRevision || stableJsonFingerprint(decision.command) !== stableJsonFingerprint(command.command);
      })) context.addIssue({ code: z.ZodIssueCode.custom, path: ['automation', 'decisions'], message: 'Replay v2 automation decisions must exactly bind the ordered AI command log.' });
      if (value.automation.runner.turnActions.some(([, count]) => count > 128) || value.automation.runner.autonomousSteps > 512) context.addIssue({ code: z.ZodIssueCode.custom, path: ['automation', 'runner'], message: 'Replay automation runner exceeds the supported guard limits.' });
      if (new Set(value.automation.runner.turnActions.map(([key]) => key)).size !== value.automation.runner.turnActions.length || new Set(value.automation.runner.visibleStates.map(([key]) => key)).size !== value.automation.runner.visibleStates.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['automation', 'runner'], message: 'Replay automation runner keys must be unique.' });
  }
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
