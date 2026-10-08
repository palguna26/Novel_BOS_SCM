export type PoFilters = {
  status: string;
  platform: string;
  warehouse: string;
  appointment: string;
  exception: string;
  from: string;
  to: string;
};

export const emptyPoFilters = (): PoFilters => ({
  status: '', platform: '', warehouse: '', appointment: '', exception: '', from: '', to: '',
});

const value = (input: unknown) => String(input ?? '').trim().toLowerCase();

export function poSearchText(po: any) {
  return [
    po.externalId, po.customer, po.destination, po.platform?.name,
    po.warehouse?.name, po.appointment?.appointment_id, po.appointment?.appointmentId,
    ...(po.lines || []).flatMap((line: any) => [line.sku?.code, line.sku?.name, line.sku_id]),
  ].map(value).join(' ');
}

export function matchesPoSearch(po: any, query: string) {
  const terms = value(query).split(/\s+/).filter(Boolean);
  const text = poSearchText(po);
  return terms.every(term => text.includes(term));
}

function dateOnly(input: unknown) {
  const date = new Date(String(input || ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function matchesPoFilters(po: any, filters: PoFilters) {
  if (filters.status && po.status !== filters.status) return false;
  if (filters.platform && po.platform?.id !== filters.platform) return false;
  if (filters.warehouse && po.warehouse?.id !== filters.warehouse) return false;
  if (filters.appointment === 'PENDING' && po.appointment) return false;
  if (filters.appointment === 'BOOKED' && !po.appointment) return false;
  if (filters.appointment === 'MISSING_DOCUMENT' && (!po.appointment || po.appointment.document_version_id)) return false;
  if (filters.exception === 'SHORTAGE' && Number(po.shortage || 0) <= 0) return false;
  if (filters.exception === 'NO_SHORTAGE' && Number(po.shortage || 0) > 0) return false;
  const poDate = dateOnly(po.poDate || po.po_date);
  if (filters.from && (!poDate || poDate < filters.from)) return false;
  if (filters.to && (!poDate || poDate > filters.to)) return false;
  return true;
}

export function filterPos(pos: any[], query: string, filters: PoFilters) {
  return pos.filter(po => matchesPoSearch(po, query) && matchesPoFilters(po, filters));
}
