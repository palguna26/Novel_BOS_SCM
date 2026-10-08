import { describe, expect, it } from 'vitest';
import { emptyPoFilters, filterPos, matchesPoSearch } from './po-search';

const pos = [
  { id: '1', externalId: 'PO-100', customer: 'Acme', destination: 'Bengaluru', status: 'ACCEPTED', platform: { id: 'amazon', name: 'Amazon' }, warehouse: { id: 'blr', name: 'Bengaluru DC' }, poDate: '2026-10-01', lines: [{ sku: { code: 'SKU-1', name: 'Keyboard' } }] },
  { id: '2', externalId: 'PO-200', customer: 'Beta', destination: 'Hyderabad', status: 'INVENTORY_SHORTAGE', platform: { id: 'flipkart', name: 'Flipkart' }, warehouse: { id: 'hyd', name: 'Hyderabad DC' }, poDate: '2026-09-20', shortage: 4, lines: [] },
];

describe('PO search and filters', () => {
  it('matches PO, customer, warehouse, and SKU fields case-insensitively', () => {
    expect(matchesPoSearch(pos[0], 'keyboard bengaluru')).toBe(true);
    expect(matchesPoSearch(pos[0], 'missing')).toBe(false);
  });

  it('combines filters with AND behavior', () => {
    expect(filterPos(pos, '', { ...emptyPoFilters(), status: 'ACCEPTED', warehouse: 'blr' })).toEqual([pos[0]]);
    expect(filterPos(pos, '', { ...emptyPoFilters(), status: 'ACCEPTED', warehouse: 'hyd' })).toEqual([]);
  });

  it('filters inclusive PO date ranges and shortage state', () => {
    expect(filterPos(pos, '', { ...emptyPoFilters(), from: '2026-09-20', to: '2026-09-20' })).toEqual([pos[1]]);
    expect(filterPos(pos, '', { ...emptyPoFilters(), exception: 'SHORTAGE' })).toEqual([pos[1]]);
    expect(filterPos(pos, '', { ...emptyPoFilters(), exception: 'NO_SHORTAGE' })).toEqual([pos[0]]);
  });
});
