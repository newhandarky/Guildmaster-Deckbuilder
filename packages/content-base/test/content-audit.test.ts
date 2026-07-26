import { describe, expect, it } from 'vitest';
import type { ContentAuditCatalog } from '../src/audit/schema.js';
import { validateContentAudit } from '../src/audit/schema.js';
import { baseDemoAudit, baseDemoContentPack } from '../src/index.js';
import { demoCards } from '../src/cards/demo-cards.js';

describe('base Content Pack audit', () => {
  it('keeps every MVP demo definition audited but disabled', () => {
    expect(validateContentAudit(baseDemoAudit, demoCards)).toEqual([]);
    expect(baseDemoAudit.cards).toHaveLength(demoCards.length);
    expect(baseDemoAudit.cards.every((entry) => entry.activation === 'disabled' && entry.status === 'todo')).toBe(true);
    expect(baseDemoContentPack.manifest.contentStatus).toBe('demo');
  });

  it('rejects an enabled definition with TODO fields or missing sources', () => {
    const invalid: ContentAuditCatalog = { ...baseDemoAudit, cards: [{ definitionId: demoCards[0]!.id, status: 'verified', activation: 'enabled', sourceIds: [], fieldAudits: [{ field: 'combat', status: 'todo', sourceIds: [] }] }] };
    expect(validateContentAudit(invalid, [demoCards[0]!])).toContain(`Enabled definition ${demoCards[0]!.id} has unverified fields.`);
    const bypassAttempt: ContentAuditCatalog = { ...baseDemoAudit, cards: [{ definitionId: demoCards[0]!.id, status: 'verified', activation: 'enabled', sourceIds: [], fieldAudits: [] }] };
    const errors = validateContentAudit(bypassAttempt, [demoCards[0]!]);
    expect(errors).toContain(`Audit entry ${demoCards[0]!.id} requires at least one official source.`);
    expect(errors).toContain(`Enabled definition ${demoCards[0]!.id} requires field audits.`);
  });

  it('rejects missing audit entries and unknown source references', () => {
    const invalid: ContentAuditCatalog = { ...baseDemoAudit, cards: [{ ...baseDemoAudit.cards[0]!, sourceIds: ['missing-source'] }] };
    const errors = validateContentAudit(invalid, demoCards);
    expect(errors.some((error) => error.startsWith('Missing audit entry'))).toBe(true);
    expect(errors).toContain(`Unknown source missing-source on ${demoCards[0]!.id}.`);
  });
});
