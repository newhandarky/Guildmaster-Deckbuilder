import { describe, expect, it } from 'vitest';
import { officialBaseSourceManifest, validateOfficialBaseSourceManifest } from '../src/index.js';

describe('official base source manifest', () => {
  it('is auditable without using image extraction or inferred values', () => {
    expect(validateOfficialBaseSourceManifest(officialBaseSourceManifest)).toEqual([]);
    expect(officialBaseSourceManifest.sources.every((source) => source.extractionPolicy === 'text-only')).toBe(true);
    expect(officialBaseSourceManifest.sources.some((source) => source.availability === 'image-only')).toBe(true);
  });
  it('keeps unavailable roster and numeric data as documented TODOs', () => {
    const starter = officialBaseSourceManifest.records.find((record) => record.recordId === 'base:starter/roster');
    const monsterRoster = officialBaseSourceManifest.records.find((record) => record.recordId === 'base:monster/roster');
    expect(starter?.fields.every((field) => field.status === 'todo' && field.gapReason)).toBe(true);
    expect(monsterRoster?.fields.every((field) => field.status === 'todo' && field.gapReason)).toBe(true);
    expect(officialBaseSourceManifest.records.flatMap((record) => record.fields).filter((field) => field.field === 'copies' || field.field === 'cost' || field.field === 'combat' || field.field === 'honor').every((field) => field.status === 'todo')).toBe(true);
  });
  it('rejects a verified claim without its required official source', () => {
    const broken = { ...officialBaseSourceManifest, records: officialBaseSourceManifest.records.map((record) => record.recordId === 'base:official/kagura' ? { ...record, fields: record.fields.map((field) => field.field === 'name' ? { ...field, sourceIds: [] } : field) } : record) };
    expect(validateOfficialBaseSourceManifest(broken)).toContain('Verified field base:official/kagura.name requires a value and source.');
  });
});
