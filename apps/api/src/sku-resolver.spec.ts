import { describe, expect, it } from '@jest/globals';
import { resolveSkuLines } from './sku-resolver';

describe('SKU resolution', () => {
  const items = [
    { id: 'item-1', code: 'NOVEL-WIPES-6', name: "NOVEL Goat Milk Baby Wipes 72's Sheet Pack Of 6" },
    { id: 'item-2', code: 'NOVEL-WIPES-5', name: 'NOVEL Baby Wipes 80 Sheets pack of 5/with Lid' },
  ];

  it('resolves a channel identifier first', () => {
    const [line] = resolveSkuLines([{ lineNumber: 1, channelItemCode: 'WIP-CHANNEL-1', description: 'Different text' }], items, [{ item_id: 'item-1', value: 'WIP-CHANNEL-1', identifier_type: 'CHANNEL_SKU' }]);
    expect(line).toMatchObject({ itemId: 'item-1', skuId: 'item-1', resolution: 'identifier' });
  });

  it('does not use another platform mapping for the same external code', () => {
    const [line] = resolveSkuLines([{ lineNumber: 1, channelItemCode: 'SAME-CODE' }], items, [
      { item_id: 'item-1', value: 'SAME-CODE', channel_id: 'flipkart' },
      { item_id: 'item-2', value: 'SAME-CODE', channel_id: 'amazon' },
    ], 'amazon');
    expect(line.itemId).toBe('item-2');
  });

  it('resolves an exact product name when no mapping exists', () => {
    const [line] = resolveSkuLines([{ lineNumber: 1, description: 'NOVEL Baby Wipes 80 Sheets pack of 5/with Lid' }], items, []);
    expect(line).toMatchObject({ itemId: 'item-2', resolution: 'name' });
  });

  it('leaves ambiguous or unknown names unresolved', () => {
    const [line] = resolveSkuLines([{ lineNumber: 1, description: 'Baby Wipes' }], items, []);
    expect(line.itemId).toBeUndefined();
  });
});
