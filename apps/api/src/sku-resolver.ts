import { ExtractedLine } from './document-extractor';

export type SkuMaster = { id: string; code?: string; name?: string };
export type SkuIdentifier = { item_id: string; value: string; identifier_type?: string; channel_id?: string | null };

export type ResolvedLine = ExtractedLine & {
  itemId?: string;
  skuId?: string;
  resolution?: 'identifier' | 'sku_code' | 'name';
  resolvedSkuCode?: string;
  resolvedSkuName?: string;
};

const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const tokens = (value: unknown) => new Set(normalize(value).split(' ').filter(token => token.length > 1));

function similarity(left: unknown, right: unknown) {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0; for (const token of a) if (b.has(token)) common++;
  return common / Math.max(a.size, b.size);
}

export function resolveSkuLines(lines: ExtractedLine[], items: SkuMaster[], identifiers: SkuIdentifier[], channelId?: string): ResolvedLine[] {
  const byIdentifier = new Map<string, SkuMaster>();
  for (const identifier of identifiers) {
    if (identifier.channel_id && identifier.channel_id !== channelId) continue;
    const item = items.find(candidate => candidate.id === identifier.item_id);
    const key = normalize(identifier.value);
    if (item && key && !byIdentifier.has(key)) byIdentifier.set(key, item);
  }
  const byCode = new Map(items.map(item => [normalize(item.code), item]).filter(([key]) => Boolean(key)) as [string, SkuMaster][]);

  return lines.map(line => {
    const identifiersToTry = [line.channelItemCode, line.asin, line.ean].map(normalize).filter(Boolean);
    let item: SkuMaster | undefined;
    let resolution: ResolvedLine['resolution'];
    for (const key of identifiersToTry) {
      item = byIdentifier.get(key);
      if (item) { resolution = 'identifier'; break; }
    }
    if (!item && line.channelItemCode) {
      item = byCode.get(normalize(line.channelItemCode));
      if (item) resolution = 'sku_code';
    }
    if (!item && line.description) {
      const exact = items.filter(candidate => normalize(candidate.name) === normalize(line.description));
      if (exact.length === 1) { item = exact[0]; resolution = 'name'; }
      else {
        const close = items.filter(candidate => similarity(line.description, candidate.name) >= 0.8);
        if (close.length === 1) { item = close[0]; resolution = 'name'; }
      }
    }
    return item
      ? { ...line, itemId: item.id, skuId: item.id, resolution, resolvedSkuCode: item.code, resolvedSkuName: item.name }
      : { ...line };
  });
}
