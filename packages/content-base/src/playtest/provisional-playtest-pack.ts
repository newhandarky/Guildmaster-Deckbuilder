import type { CardDefinition, ContentPack } from '@guildmaster/game-protocol';
import { validateProvisionalBaseContentCatalog, type ProvisionalBaseContentCatalog, type ProvisionalCardCandidate, type ProvisionalField, type ProvisionalFieldName } from '../provisional/schema.js';

export type ProvisionalPlaytestRequest = { definitionIds: readonly string[]; packId?: string; version?: string; hash?: string };
export type ProvisionalPlaytestAssemblyFailure = { definitionId: string; field: ProvisionalFieldName; reason: string };
export type ProvisionalPlaytestAssemblyResult = { ok: true; pack: ContentPack } | { ok: false; failures: readonly ProvisionalPlaytestAssemblyFailure[] };

const definitionTypes = new Set(['starter', 'adventurer', 'item', 'equipment', 'monster', 'boss', 'bond']);
const supportedFields = new Set<ProvisionalFieldName>(['sourceName', 'cardType', 'profession', 'copies', 'cost', 'combat', 'purchasePower', 'honor', 'setup']);
const requiredByCategory: Readonly<Record<ProvisionalCardCandidate['category'], readonly ProvisionalFieldName[]>> = {
  starter: ['cardType', 'copies', 'setup'], adventurer: ['cardType', 'copies', 'cost', 'combat', 'honor'], resource: ['cardType', 'copies', 'cost'], monster: ['cardType', 'copies', 'combat', 'purchasePower', 'honor'], boss: ['cardType', 'copies', 'combat', 'purchasePower', 'honor'], bond: ['cardType', 'copies', 'honor', 'effect'], helper: ['cardType', 'copies', 'effect']
};

function isRelevant(field: ProvisionalField): boolean { return field.candidateValue !== undefined || field.status === 'exception'; }
function placeholderName(definitionId: string): string { return `placeholder:${definitionId}`; }

/**
 * Builds a non-production pack only when every supplied mechanics field is
 * provisional/verified. Source names intentionally never become display names.
 */
export function assembleProvisionalPlaytestPack(catalog: ProvisionalBaseContentCatalog, request: ProvisionalPlaytestRequest): ProvisionalPlaytestAssemblyResult {
  const candidateById = new Map(catalog.candidates.map((candidate) => [candidate.definitionId, candidate]));
  const failures: ProvisionalPlaytestAssemblyFailure[] = [];
  for (const error of validateProvisionalBaseContentCatalog(catalog)) failures.push({ definitionId: '<catalog>', field: 'cardType', reason: error });
  const selected = request.definitionIds.map((definitionId) => {
    const candidate = candidateById.get(definitionId);
    if (!candidate) failures.push({ definitionId, field: 'cardType', reason: 'Unknown provisional candidate.' });
    return candidate;
  }).filter((candidate): candidate is ProvisionalCardCandidate => candidate !== undefined);
  if (new Set(request.definitionIds).size !== request.definitionIds.length) failures.push({ definitionId: '<request>', field: 'cardType', reason: 'Duplicate definition ID in playtest request.' });
  for (const candidate of selected) for (const field of candidate.fields) {
    if (field.status === 'exception') failures.push({ definitionId: candidate.definitionId, field: field.field, reason: field.exceptionReason ?? 'Unresolved exception.' });
    if (field.status === 'disabled') failures.push({ definitionId: candidate.definitionId, field: field.field, reason: 'Disabled fields cannot be assembled.' });
    if (!supportedFields.has(field.field) && field.candidateValue !== undefined) failures.push({ definitionId: candidate.definitionId, field: field.field, reason: 'Unsupported mechanics: the current playtest adapter cannot silently discard this field.' });
    if (field.field === 'cardType' && field.candidateValue !== undefined && (typeof field.candidateValue !== 'string' || (candidate.category === 'starter' ? !['adventurer', 'starter-resource', 'equipment'].includes(field.candidateValue) : !definitionTypes.has(field.candidateValue)))) failures.push({ definitionId: candidate.definitionId, field: field.field, reason: 'Card type must be a supported string value.' });
    if (['copies', 'cost', 'combat', 'purchasePower', 'honor'].includes(field.field) && field.candidateValue !== undefined && (typeof field.candidateValue !== 'number' || !Number.isFinite(field.candidateValue) || !Number.isInteger(field.candidateValue) || field.candidateValue < 0 || (field.field === 'copies' && field.candidateValue < 1))) failures.push({ definitionId: candidate.definitionId, field: field.field, reason: 'Numeric mechanics must be finite non-negative integers; copies must be positive.' });
  }
  for (const candidate of selected) for (const fieldName of requiredByCategory[candidate.category]) {
    const matching = candidate.fields.find((field) => field.field === fieldName);
    if (!matching || matching.candidateValue === undefined) failures.push({ definitionId: candidate.definitionId, field: fieldName, reason: 'Missing required mechanics field.' });
  }
  if (failures.length > 0) return { ok: false, failures };
  const definitions: CardDefinition[] = selected.map((candidate) => {
    const fields = Object.fromEntries(candidate.fields.filter(isRelevant).map((field) => [field.field, field.candidateValue]));
    const type = candidate.category === 'starter' ? (fields.cardType === 'equipment' ? 'equipment' : 'starter') : fields.cardType;
    if (typeof type !== 'string' || !definitionTypes.has(type)) return undefined;
    const tags = [...(candidate.mechanicsTags ?? []), ...(typeof fields.profession === 'string' ? [`profession:${fields.profession}`] : [])];
    const definition: CardDefinition = { id: candidate.definitionId, name: placeholderName(candidate.definitionId), type, copies: typeof fields.copies === 'number' ? fields.copies : 0, source: 'provisional-playtest', ...(tags.length ? { tags: [...new Set(tags)] } : {}) };
    for (const numericField of ['cost', 'combat', 'purchasePower', 'honor'] as const) if (typeof fields[numericField] === 'number') definition[numericField] = fields[numericField];
    return definition;
  }).filter((definition): definition is CardDefinition => definition !== undefined);
  const starter = {
    partyDefinitionIds: ['base:starter/adventurer-01', 'base:starter/adventurer-02', 'base:starter/adventurer-03', 'base:starter/adventurer-04', 'base:starter/adventurer-05'],
    summonStoneDefinitionId: 'base:starter/summoning-stone',
    crystalDefinitionId: 'base:starter/spirit-crystal'
  };
  if (![...starter.partyDefinitionIds, starter.summonStoneDefinitionId, starter.crystalDefinitionId].every((id) => definitions.some((definition) => definition.id === id))) return { ok: false, failures: [{ definitionId: '<starter>', field: 'setup', reason: 'A provisional base playtest requires all five distinct party starters and both hand starters.' }] };
  return { ok: true, pack: { manifest: { id: request.packId ?? 'base:provisional-playtest', version: request.version ?? '0.0.0', hash: request.hash ?? 'unpublished', role: 'base', contentStatus: 'provisional-playtest' }, definitions, starter, bonds: [], rulesModuleIds: ['base:rules'] } };
}
